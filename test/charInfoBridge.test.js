import assert from 'node:assert/strict';
import { createCharInfoBridge, isValidStOrigin, parseBridgeQuery } from '../frontend-dist/account/charinfo-bridge.js';

const albumId = '12345678-1234-4234-8234-123456789abc';
const nonce = '0123456789abcdef0123456789abcdef';
const stOrigin = 'http://localhost:8000';
const origin = 'https://imgbed.example';
const path = `/api/public/album-gallery/${albumId}`;
function entry(changes = {}) {
  const url = new URL('/account/', origin);
  const params = { view: 'albums', bridge: 'charinfo', bridge_version: '1', bridge_nonce: nonce, opener_origin: stOrigin, ...changes };
  Object.entries(params).forEach(([key, value]) => value === null ? url.searchParams.delete(key) : url.searchParams.set(key, value));
  return url;
}
function fixture({ openerMissing = false, session = parseBridgeQuery(entry()), response, storage = new Map(), initialTime = 0 } = {}) {
  const sent = [];
  const listeners = new Map();
  const timers = new Map();
  const calls = [];
  let time = initialTime;
  let changes = 0;
  let nextTimer = 1;
  const opener = { closed: false, postMessage: (data, target) => sent.push({ data, target }) };
  const popup = {
    opener: openerMissing ? null : opener,
    location: { origin },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type); },
    setTimeout: (handler, delay) => { const id = nextTimer++; timers.set(id, { handler, due: time + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const album = { id: albumId, owner_id: 'a', charInfoCharacterName: '旅行者' };
  const pack = { format: 'char-info-gallery-pack', version: 1, packId: albumId, profileId: albumId, characterName: '旅行者', gallery: [] };
  const api = async (url, options) => {
    calls.push({ url, options });
    if (response) return response(url, { album, pack, calls });
    if (url === '/api/user/me') return { user: { id: 'a' } };
    if (url === `/api/user/albums/${albumId}`) return { album };
    if (url === path) return pack;
    throw new Error(`Unexpected URL: ${url}`);
  };
  const bridge = createCharInfoBridge({ window: popup, session, api, now: () => time, onChange: () => changes++ });
  const hello = (fields = {}, event = {}) => listeners.get('message')?.({ source: opener, origin: stOrigin, data: {
    protocol: 'charinfo-imgbed-bridge', version: 1, type: 'bridge.hello', nonce, ...fields,
  }, ...event });
  const advance = milliseconds => {
    time += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.due <= time) { timers.delete(id); timer.handler(); }
  };
  return { bridge, popup, opener, sent, listeners, timers, calls, hello, advance, album, pack, storage, changes: () => changes };
}

describe('CharInfo popup bridge v1', () => {
  describe('entry and origin policy', () => {
    it('parses valid sessions, optional lowercase UUID and no ordinary account session', () => {
      assert.deepEqual(parseBridgeQuery(entry({ album: albumId })), { nonce, openerOrigin: stOrigin, albumId });
      assert.equal(parseBridgeQuery(`${origin}/account/?view=albums`), null);
      assert.equal(parseBridgeQuery(entry()).albumId, null);
    });
    it('rejects malformed, duplicate and unsupported-version query fields', () => {
      for (const changes of [
        { bridge: 'other' }, { bridge_version: '2' }, { bridge_version: '01' },
        { bridge_nonce: 'short' }, { bridge_nonce: 'x'.repeat(129) }, { bridge_nonce: '0123456789abcd+/' },
        { opener_origin: 'null' }, { opener_origin: 'javascript:alert(1)' }, { opener_origin: 'http://localhost:8000/' },
        { opener_origin: 'https://user:password@example.test' }, { opener_origin: 'https://example.test/?x=1' },
        { album: '../other' }, { album: albumId.toUpperCase() }, { album: '' }, { opener_origin: null },
      ]) assert.ok(parseBridgeQuery(entry(changes)).error, JSON.stringify(changes));
      const duplicate = entry(); duplicate.searchParams.append('bridge_nonce', nonce);
      assert.ok(parseBridgeQuery(duplicate).error);
      const wrongPath = entry(); wrongPath.pathname = '/login';
      assert.ok(parseBridgeQuery(wrongPath).error);
      const tooLong = entry({ unused: 'x'.repeat(500) });
      assert.ok(parseBridgeQuery(tooLong).error, 'OAuth return path must fit the existing 500-character sanitizer');
    });
    it('accepts canonical HTTP and HTTPS origins without host registration', () => {
      for (const value of ['http://localhost', 'http://localhost:8000', 'http://127.0.0.1:8787', 'https://localhost:8000', 'http://192.168.1.41:8000', 'http://10.0.0.5:3000', 'http://100.75.12.3:8000', 'https://st.example.org', 'http://[::1]:8000']) {
        assert.ok(isValidStOrigin(value), value);
        assert.equal(parseBridgeQuery(entry({ opener_origin: value })).openerOrigin, value);
      }
    });
    it('rejects opaque, encoded, noncanonical and non-origin values', () => {
      for (const value of ['null', 'file:///x', 'data:text/html,x', 'javascript:alert(1)', 'http://127.1:8000', 'http://2130706433:8000', 'https://%65xample.org', 'https://EXAMPLE.org', 'https://example.org:443', 'https://example.org/', 'https://a@example.org', 'https://example.org?x=1', 'https://example.org#x', ' https://example.org', 'https://example.org\\evil', 'https://例子.中国']) {
        assert.equal(isValidStOrigin(value), false, value);
        assert.ok(parseBridgeQuery(entry({ opener_origin: value })).error, value);
      }
    });
    it('preserves bridge fields only in the same account session without trusting returnTo', () => {
      const { bridge } = fixture();
      const switched = bridge.appendToUrl(`${origin}/account/?view=files`);
      assert.equal(switched.searchParams.get('bridge_nonce'), nonce);
      assert.equal(switched.searchParams.get('view'), 'files');
      assert.equal(bridge.appendToUrl(`${origin}/account/?view=albums&album=${albumId}`).searchParams.get('album'), albumId);
      assert.equal(bridge.appendToUrl('https://evil.test/account/').search, '');
      assert.equal(bridge.appendToUrl(`${origin}/charinfo/`).search, '');
      bridge.cancel();
      assert.equal(bridge.appendToUrl(entry()).searchParams.has('bridge'), false);
    });
  });

  describe('handshake and lifecycle', () => {
    it('starts only after authentication and sends exactly one ready to the verified origin', () => {
      const f = fixture();
      f.hello(); assert.equal(f.sent.length, 0);
      f.bridge.start('a');
      f.hello(); f.hello();
      assert.deepEqual(f.sent, [{ target: stOrigin, data: { protocol: 'charinfo-imgbed-bridge', version: 1, type: 'bridge.ready', nonce } }]);
      assert.equal(f.bridge.status, 'ready');
      assert.equal(f.listeners.has('message'), false);
    });
    it('ignores wrong origin, source, nonce, envelope, event type and unsolicited messages', () => {
      const f = fixture(); f.bridge.start('a');
      for (const fields of [{ nonce: 'another_nonce_value' }, { version: '1' }, { version: 2 }, { protocol: 'other' }, { type: 'album.selected' }, { type: 'bridge.ready' }, { type: 'bridge.cancelled' }, { private: 'data' }]) f.hello(fields);
      f.hello({}, { origin: 'http://localhost:8001' });
      f.hello({}, { origin: 'https://evil.test' });
      f.hello({}, { source: {} });
      f.hello({}, { data: null }); f.hello({}, { data: [] }); f.hello({}, { data: 'bridge.hello' });
      assert.equal(f.sent.length, 0);
      f.hello(); assert.equal(f.sent.length, 1);
    });
    it('binds dynamic private-network and custom origins only to the genuine opener message', async () => {
      for (const custom of ['http://192.168.1.41:8000', 'http://100.75.12.3:8000', 'https://st.example.org']) {
        const session = parseBridgeQuery(entry({ opener_origin: custom }));
        const f = fixture({ session });
        f.bridge.start('a');
        f.hello({}, { origin: custom, source: {} });
        f.hello({}, { origin: stOrigin });
        assert.equal(f.sent.length, 0);
        f.hello({}, { origin: custom });
        assert.equal(f.bridge.status, 'ready'); assert.equal(f.sent[0].target, custom);
        session.openerOrigin = 'https://spoofed.example';
        await f.bridge.select(albumId);
        assert.equal(f.sent[1].target, custom, 'selection targets the verified browser origin, not a later claim');
      }
      const f = fixture(); f.bridge.start('a'); f.popup.opener = {};
      f.hello(); assert.equal(f.sent.length, 0);
    });
    it('uses manual fallback for absent opener or handshake timeout and ignores late hello', () => {
      const missing = fixture({ openerMissing: true }); missing.bridge.start('a');
      assert.equal(missing.bridge.status, 'manual'); assert.equal(missing.listeners.has('message'), false);
      const f = fixture(); f.bridge.start('a'); f.advance(30000); f.hello();
      assert.equal(f.bridge.status, 'manual'); assert.equal(f.sent.length, 0);
      f.advance(15 * 60 * 1000); assert.equal(f.bridge.status, 'expired');
      assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
    });
    it('sends explicit cancellation only after handshake and cleans handlers, timers and context', () => {
      const f = fixture(); f.bridge.start('a'); f.hello(); f.bridge.cancel(); f.bridge.cancel(); f.hello();
      assert.deepEqual(f.sent.map(item => item.data.type), ['bridge.ready', 'bridge.cancelled']);
      assert.equal(f.sent[1].target, stOrigin); assert.equal(f.sent[1].data.nonce, nonce);
      assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
      assert.equal(f.bridge.appendToUrl(entry()).searchParams.has('bridge_nonce'), false);
      const early = fixture(); early.bridge.start('a'); early.bridge.cancel(); assert.equal(early.sent.length, 0);
    });
    it('fails malformed sessions safely and suspends pagehide without consuming or changing the URL', () => {
      const bad = fixture({ session: { error: '参数无效' } }); bad.bridge.start('a'); bad.hello();
      assert.equal(bad.bridge.status, 'invalid'); assert.equal(bad.listeners.size, 0);
      assert.equal(bad.bridge.appendToUrl(entry()).searchParams.has('bridge'), false);
      const f = fixture(); f.bridge.start('a'); f.listeners.get('pagehide')(); f.hello();
      assert.equal(f.bridge.status, 'suspended'); assert.equal(f.listeners.has('message'), false); assert.equal(f.timers.size, 0);
      assert.equal(f.changes(), 1, 'pagehide must not invoke the URL-rewriting status callback');
    });
    it('captures the first arrival before login and preserves the original deadline across OAuth documents', () => {
      const storage = new Map();
      const beforeLogin = fixture({ storage });
      assert.equal(beforeLogin.listeners.size, 0, 'unauthenticated redirect must not consume the session');
      const afterLogin = fixture({ storage, initialTime: 10 * 60 * 1000 });
      afterLogin.bridge.start('a'); afterLogin.hello(); assert.equal(afterLogin.bridge.status, 'ready');
      afterLogin.advance(5 * 60 * 1000); assert.equal(afterLogin.bridge.status, 'expired');
      const expired = fixture({ storage, initialTime: 16 * 60 * 1000 });
      expired.bridge.start('a'); expired.hello(); assert.equal(expired.bridge.status, 'expired'); assert.equal(expired.sent.length, 0);
    });
    it('re-handshakes ordinary reloads but rejects consumed nonces, even after another session', async () => {
      const storage = new Map();
      const first = fixture({ storage }); first.bridge.start('a'); first.hello();
      first.listeners.get('pagehide')();
      const reloaded = fixture({ storage }); reloaded.bridge.start('a');
      await assert.rejects(reloaded.bridge.select(albumId));
      reloaded.hello(); assert.equal(reloaded.bridge.status, 'ready');
      await reloaded.bridge.select(albumId);
      const replay = fixture({ storage }); replay.bridge.start('a'); replay.hello();
      assert.equal(replay.bridge.status, 'expired'); assert.equal(replay.sent.length, 0);
      const nextNonce = 'fresh_nonce_0123456789abcdef';
      const next = fixture({ storage, session: parseBridgeQuery(entry({ bridge_nonce: nextNonce })) });
      next.bridge.start('a'); next.hello({ nonce: nextNonce }); assert.equal(next.bridge.status, 'ready');
      const old = fixture({ storage }); old.bridge.start('a'); old.hello();
      assert.equal(old.bridge.status, 'expired'); assert.equal(old.sent.length, 0);
      for (const end of [f => f.bridge.cancel(), f => f.advance(15 * 60 * 1000)]) {
        const f = fixture(); f.bridge.start('a'); end(f);
        const reloaded = fixture({ storage: f.storage }); reloaded.bridge.start('a'); reloaded.hello();
        assert.equal(reloaded.bridge.status, 'expired'); assert.equal(reloaded.sent.length, 0);
      }
    });
    it('rejects a changed origin claim or logged-in account when a nonce is resumed', () => {
      const f = fixture(); f.bridge.start('a'); f.hello();
      const changedOrigin = fixture({ storage: f.storage, session: parseBridgeQuery(entry({ opener_origin: 'http://10.0.0.5:8000' })) });
      changedOrigin.bridge.start('a'); changedOrigin.hello({}, { origin: 'http://10.0.0.5:8000' });
      assert.equal(changedOrigin.bridge.status, 'expired'); assert.equal(changedOrigin.sent.length, 0);
      const account = fixture(); account.bridge.start('a'); account.hello();
      const changedAccount = fixture({ storage: account.storage }); changedAccount.bridge.start('b'); changedAccount.hello();
      assert.equal(changedAccount.bridge.status, 'expired'); assert.equal(changedAccount.sent.length, 0);
    });
    it('revalidates the opener after browser cache restoration and never restores ready automatically', () => {
      const f = fixture(); f.bridge.start('a'); f.hello();
      f.listeners.get('pagehide')(); f.listeners.get('pageshow')();
      assert.equal(f.bridge.status, 'waiting'); assert.equal(f.sent.length, 1);
      f.hello(); assert.equal(f.bridge.status, 'ready'); assert.equal(f.sent.length, 2);
      f.bridge.cancel(); assert.equal(f.listeners.size, 0);
    });
    it('uses validated manual links when temporary storage fails, including a failure just before hello', async () => {
      const storage = { get: () => { throw new Error('blocked'); }, set: () => {} };
      const f = fixture({ storage }); f.bridge.start('a'); f.hello();
      assert.equal(f.bridge.status, 'manual'); assert.equal(f.sent.length, 0);
      assert.match(f.bridge.reason, /临时连接状态/);
      assert.equal((await f.bridge.select(albumId, { manual: true })).sent, false);
      const later = fixture(); later.bridge.start('a');
      later.popup.sessionStorage.setItem = () => { throw new Error('blocked'); };
      later.hello(); assert.equal(later.bridge.status, 'manual'); assert.equal(later.sent.length, 0);
    });
  });

  describe('explicit album selection', () => {
    it('revalidates identity, owner and public v1 pack and sends one canonical URL without account data', async () => {
      const f = fixture(); f.bridge.start('a'); f.hello();
      const result = await f.bridge.select(albumId);
      assert.deepEqual(result, { albumId, remoteGalleryUrl: `${origin}${path}`, sent: true });
      assert.deepEqual(f.sent[1], { target: stOrigin, data: { protocol: 'charinfo-imgbed-bridge', version: 1, type: 'album.selected', nonce, albumId, remoteGalleryUrl: `${origin}${path}` } });
      assert.deepEqual(f.calls.map(call => call.url), ['/api/user/me', `/api/user/albums/${albumId}`, path, '/api/user/me']);
      assert.ok(f.calls.every(call => call.options.cache === 'no-store'));
      assert.equal(f.bridge.status, 'completed'); assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
      await assert.rejects(f.bridge.select(albumId)); f.hello(); assert.equal(f.sent.length, 2);
    });
    it('does not require a publicHandle and manual copy validates without sending or completing', async () => {
      const f = fixture({ openerMissing: true }); f.bridge.start('a');
      await assert.rejects(f.bridge.select(albumId));
      assert.deepEqual(await f.bridge.select(albumId, { manual: true }), { albumId, remoteGalleryUrl: `${origin}${path}`, sent: false });
      assert.equal(f.sent.length, 0); assert.equal(f.bridge.status, 'manual');
    });
    it('blocks selections before handshake and malformed UUIDs', async () => {
      const f = fixture(); f.bridge.start('a');
      await assert.rejects(f.bridge.select(albumId)); assert.equal(f.calls.length, 0);
      f.hello(); await assert.rejects(f.bridge.select('../other')); assert.equal(f.calls.length, 0);
    });
    it('denies a different owner even when the private API permits a site owner to read it', async () => {
      const f = fixture(); f.album.owner_id = 'other'; f.bridge.start('a'); f.hello();
      await assert.rejects(f.bridge.select(albumId), { code: 'album-unavailable' });
      assert.equal(f.sent.length, 1); assert.equal(f.calls.some(call => call.url === path), false);
    });
    it('requires a valid character name and a matching usable public v1 pack', async () => {
      for (const name of ['', '   ', 'x'.repeat(81), 'bad\nname']) {
        const f = fixture(); f.album.charInfoCharacterName = name; f.bridge.start('a'); f.hello();
        await assert.rejects(f.bridge.select(albumId), { code: 'character-name-required' }); assert.equal(f.sent.length, 1);
      }
      for (const change of [{ format: 'char-info-visual-pack' }, { version: 2 }, { packId: 'other' }, { profileId: 'other' }, { characterName: 'other' }, { gallery: null }]) {
        const f = fixture(); Object.assign(f.pack, change); f.bridge.start('a'); f.hello();
        await assert.rejects(f.bridge.select(albumId), { code: 'public-pack-unavailable' }); assert.equal(f.sent.length, 1);
      }
    });
    it('blocks deleted, forbidden and failed public albums without a successful message', async () => {
      for (const [failurePath, status] of [[`/api/user/albums/${albumId}`, 404], [`/api/user/albums/${albumId}`, 403], [path, 409], [path, 500]]) {
        const f = fixture({ response: async (url, { album, pack }) => {
          if (url === failurePath) throw Object.assign(new Error('请求失败'), { status });
          return url === '/api/user/me' ? { user: { id: 'a' } } : url === path ? pack : { album };
        } });
        f.bridge.start('a'); f.hello(); await assert.rejects(f.bridge.select(albumId), { status }); assert.equal(f.sent.length, 1);
      }
    });
    it('blocks changed or expired authentication including changes during pack loading', async () => {
      for (const finalOnly of [false, true]) {
        let checks = 0;
        const f = fixture({ response: async (url, { album, pack }) => url === '/api/user/me'
          ? { user: { id: ++checks === 1 && finalOnly ? 'a' : 'other' } } : url === path ? pack : { album } });
        f.bridge.start('a'); f.hello(); await assert.rejects(f.bridge.select(albumId), { code: 'auth-changed' });
        assert.equal(f.bridge.status, 'expired'); assert.equal(f.sent.length, 1);
      }
      const f = fixture({ response: async () => { throw Object.assign(new Error('登录已失效'), { status: 401 }); } });
      f.bridge.start('a'); f.hello(); await assert.rejects(f.bridge.select(albumId)); assert.equal(f.bridge.status, 'expired');
    });
    it('prevents concurrent clicks and cancellation or expiry during requests from sending selection', async () => {
      for (const terminate of [f => f.bridge.cancel(), f => f.advance(15 * 60 * 1000), f => { f.listeners.get('pagehide')(); f.listeners.get('pageshow')(); f.hello(); }]) {
        let release;
        const f = fixture({ response: async (url, { album, pack }) => {
          if (url === path) await new Promise(resolve => { release = resolve; });
          return url === '/api/user/me' ? { user: { id: 'a' } } : url === path ? pack : { album };
        } });
        f.bridge.start('a'); f.hello(); const pending = f.bridge.select(albumId);
        await assert.rejects(f.bridge.select(albumId));
        while (!release) await Promise.resolve();
        terminate(f); release(); await assert.rejects(pending);
        assert.equal(f.sent.filter(item => item.data.type === 'album.selected').length, 0);
      }
    });
    it('falls back safely when opener is closed or postMessage fails after validation', async () => {
      const f = fixture(); f.bridge.start('a'); f.hello(); f.opener.closed = true;
      await assert.rejects(f.bridge.select(albumId)); assert.equal(f.bridge.status, 'manual'); assert.equal(f.sent.length, 1);
      const failed = fixture(); failed.bridge.start('a'); failed.hello(); failed.opener.postMessage = () => { throw new Error('blocked'); };
      await assert.rejects(failed.bridge.select(albumId)); assert.equal(failed.bridge.status, 'manual'); assert.equal(failed.sent.length, 1);
    });
    it('does not let an old failed request terminate a re-handshaken restored page', async () => {
      let rejectPack;
      const f = fixture({ response: async (url, { album }) => {
        if (url === path) return new Promise((_resolve, reject) => { rejectPack = reject; });
        return url === '/api/user/me' ? { user: { id: 'a' } } : { album };
      } });
      f.bridge.start('a'); f.hello();
      const pending = f.bridge.select(albumId);
      while (!rejectPack) await Promise.resolve();
      f.listeners.get('pagehide')(); f.listeners.get('pageshow')(); f.hello();
      rejectPack(Object.assign(new Error('Old response'), { status: 401 }));
      await assert.rejects(pending, { status: 401 });
      assert.equal(f.bridge.status, 'ready');
      assert.equal(f.sent.filter(item => item.data.type === 'album.selected').length, 0);
    });
  });
});
