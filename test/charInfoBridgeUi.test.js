import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseBridgeQuery, createCharInfoBridge } from '../frontend-dist/account/charinfo-bridge.js';
import { onRequestGet as discordLogin } from '../functions/api/auth/discord/index.js';
import { buildCookie, getCookie, sanitizeReturnTo } from '../functions/utils/auth/discordIdentity.js';

const source = readFileSync(new URL('../frontend-dist/account/account.js', import.meta.url), 'utf8');
const callbackSource = readFileSync(new URL('../functions/api/auth/discord/callback.js', import.meta.url), 'utf8');
const albumId = '12345678-1234-4234-8234-123456789abc';
const nonce = '0123456789abcdef0123456789abcdef';
const stOrigin = 'http://192.168.1.41:8000';
const entry = `https://imgbed.example/account/?view=albums&bridge=charinfo&bridge_version=1&bridge_nonce=${nonce}&opener_origin=${encodeURIComponent(stOrigin)}&album=${albumId}`;

function workspace(url = entry, { authenticated = true, albums = true, storage = new Map() } = {}) {
  const location = new URL(url);
  const redirects = [], messages = [], listeners = new Map();
  location.replace = value => redirects.push(value);
  const main = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {} };
  const popup = {
    location, scrollY: 0, scrollTo() {},
    opener: { closed: false, postMessage: (message, target) => messages.push({ message, target }) },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
    setTimeout: () => 1, clearTimeout() {},
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
  };
  const history = { replaceState(_state, _title, value) { location.href = new URL(value, location).href; }, pushState(_state, _title, value) { location.href = new URL(value, location).href; } };
  const album = { id: albumId, owner_id: 'current-user', name: '测试图库', slug: 'test', charInfoCharacterName: '测试角色', items: [] };
  const app = runInNewContext(`${source.replace(/^import .*;\r?\n/gm, '').replace(/\ninit\(\);\s*$/, '')}\nsyncWorkspaceWallpaper = async () => {}; ({ state, init, syncNavigation, navigateWorkspace, buildWorkspaceUrl, workspaceTargetFromUrl, albumDetailMarkup, albumRow, bridgeMarkup, charInfoBridge })`, {
    location, window: popup, history, URL, URLSearchParams, Headers, FormData,
    parseBridgeQuery, createCharInfoBridge, mountLegacyShell() {}, setSitePageTitle() {}, requestAnimationFrame() {},
    IntersectionObserver: class { observe() {} },
    document: { querySelector: selector => ['#mainContent', '#dialogRoot'].includes(selector) ? main : null, querySelectorAll: () => [], addEventListener() {}, documentElement: {} },
    fetch: async path => {
      if (!authenticated) return Response.json({ error: 'Sign in required' }, { status: 401 });
      if (path === '/api/user/me') return Response.json({ user: { id: 'current-user', role: 'member' } });
      if (path.startsWith('/api/user/files?')) return Response.json({ files: [], usedBytes: 0 });
      if (path === '/api/user/albums') return Response.json({ albums: albums ? [album] : [] });
      if (path === `/api/user/albums/${albumId}`) return Response.json({ album, items: [] });
      if (path === `/api/public/album-gallery/${albumId}`) return Response.json({ format: 'char-info-gallery-pack', version: 1, packId: albumId, profileId: albumId, characterName: '测试角色', gallery: [] });
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  return { ...app, location, redirects, messages, listeners, popup, main, album, storage };
}

describe('CharInfo bridge account and login integration', () => {
  it('keeps the complete local return path through login, OAuth callback, init, navigation and selection', async () => {
    const first = workspace(entry, { authenticated: false });
    await first.init();
    const login = new URL(first.redirects[0], first.location);
    assert.equal(login.pathname, '/login');
    const localReturn = login.searchParams.get('returnTo');
    assert.equal(localReturn, new URL(entry).pathname + new URL(entry).search);
    const oauth = await discordLogin({ request: new Request(`https://imgbed.example/api/auth/discord?${new URLSearchParams({ returnTo: localReturn })}`), env: { DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-only' } });
    const cookie = oauth.headers.get('set-cookie');
    const oauthState = new URL(oauth.headers.get('location')).searchParams.get('state');
    const returnCookie = cookie.match(/discord_oauth_return_to=([^;]+)/)[1];
    assert.equal(decodeURIComponent(returnCookie), localReturn);
    const callback = runInNewContext(`${callbackSource.replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function')}\nonRequestGet`, {
      URL, Headers, Response, buildCookie, getCookie, sanitizeReturnTo,
      isDiscordAuthConfigured: () => true, exchangeDiscordCode: async () => ({ access_token: 'test-only' }),
      fetchEligibleDiscordUser: async () => ({ user: {} }), upsertDiscordUser: async () => ({ id: 'current-user' }),
      createDiscordSession: async () => ({ cookie: 'test_session=mock; HttpOnly' }),
    });
    const returned = await callback({ request: new Request(`https://imgbed.example/api/auth/discord/callback?state=${oauthState}&code=mock`, { headers: { Cookie: `discord_oauth_state=${oauthState}; discord_oauth_return_to=${returnCookie}` } }), env: {} });
    assert.equal(returned.status, 302);
    assert.equal(returned.headers.get('location'), localReturn);
    const app = workspace(new URL(returned.headers.get('location'), first.location).href, { storage: first.storage });
    await app.init();
    assert.match(app.main.innerHTML, /使用此图库 \/ 返回 ST/);
    assert.equal(app.location.searchParams.get('bridge_nonce'), nonce);
    await app.navigateWorkspace({ view: 'files' });
    assert.equal(app.location.searchParams.get('bridge_nonce'), nonce);
    await app.navigateWorkspace({ view: 'albums', albumId });
    assert.equal(app.location.searchParams.get('album'), albumId);
    app.listeners.get('message')({ source: app.popup.opener, origin: stOrigin, data: { protocol: 'charinfo-imgbed-bridge', version: 1, type: 'bridge.hello', nonce } });
    assert.equal(app.messages[0].message.type, 'bridge.ready');
    await app.charInfoBridge.select(albumId);
    assert.equal(app.messages[1].message.remoteGalleryUrl, `https://imgbed.example/api/public/album-gallery/${albumId}`);
    assert.equal(app.location.searchParams.has('bridge_nonce'), false);
    assert.equal(app.location.searchParams.get('album'), albumId);
  });

  it('keeps a handshaken popup URL on reload, requires a new hello and rejects completed reloads', async () => {
    const app = workspace();
    await app.init();
    const hello = target => target.listeners.get('message')({ source: target.popup.opener, origin: stOrigin, data: { protocol: 'charinfo-imgbed-bridge', version: 1, type: 'bridge.hello', nonce } });
    hello(app);
    const beforeReload = app.location.href;
    app.listeners.get('pagehide')();
    assert.equal(app.location.href, beforeReload);
    const resumed = workspace(beforeReload, { storage: app.storage });
    await resumed.init();
    assert.equal(resumed.charInfoBridge.status, 'waiting');
    await assert.rejects(resumed.charInfoBridge.select(albumId));
    hello(resumed);
    await resumed.charInfoBridge.select(albumId);
    assert.equal(resumed.messages[1].target, stOrigin);
    const replay = workspace(beforeReload, { storage: app.storage });
    await replay.init();
    assert.equal(replay.charInfoBridge.status, 'expired');
    assert.equal(replay.location.searchParams.has('bridge'), false);
    assert.equal(replay.messages.length, 0);
  });

  it('shows an unavailable requested album while preserving the existing create/choose flow', async () => {
    const app = workspace(entry, { albums: false });
    await app.init();
    assert.match(app.main.innerHTML, /该图库不可用或不属于当前账号/);
    assert.match(app.main.innerHTML, /新建第一个图库/);
    assert.equal(app.messages.length, 0);
    app.charInfoBridge.dispose();
  });

  it('does not add bridge actions or parameters in ordinary account mode', async () => {
    const app = workspace(`https://imgbed.example/account/?view=albums&album=${albumId}`);
    await app.init();
    assert.equal(app.charInfoBridge, null);
    assert.doesNotMatch(app.main.innerHTML, /data-bridge-|选择要连接到 CharInfo/);
    assert.equal(app.location.searchParams.has('bridge'), false);
    assert.equal(app.workspaceTargetFromUrl('https://evil.example/account/?bridge=charinfo'), null);
  });

  it('removes cancelled session parameters on the next navigation and never revives them', async () => {
    const app = workspace();
    await app.init();
    app.charInfoBridge.cancel();
    assert.equal(app.location.searchParams.has('bridge'), false);
    await app.navigateWorkspace({ view: 'files' });
    await app.navigateWorkspace(app.workspaceTargetFromUrl(entry));
    assert.equal(app.location.searchParams.has('bridge'), false);
    assert.equal(app.listeners.has('message'), false);
  });
});
