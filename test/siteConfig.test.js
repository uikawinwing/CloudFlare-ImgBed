import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../frontend-dist/site-config.js', import.meta.url), 'utf8');

function fixture(fetch) {
  const element = () => ({
    attributes: {}, style: {}, children: [], events: {}, hidden: false,
    classList: { values: new Set(), toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); } },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); child.remove = () => { this.children = this.children.filter(item => item !== child); }; },
    addEventListener(key, callback) { this.events[key] = callback; },
  });
  const name = element(), link = element(), fallback = element(), logo = element(), icon = element(), heading = element(), brandText = element();
  logo.querySelector = selector => selector === '[data-site-logo-fallback]' ? fallback : logo.children[0];
  const nodes = { '[data-site-name]': [name], '[data-site-link]': [link], '[data-site-logo]': [logo], '[data-site-wordmark-heading]': [heading], '[data-site-brand-text]': [brandText] };
  const document = {
    title: '', documentElement: { dataset: { sitePageTitle: '发现' } }, head: element(),
    querySelectorAll: selector => nodes[selector] || [],
    querySelector: selector => selector === 'link[rel="icon"]' ? icon : null,
    createElement: element,
  };
  const events = [];
  const context = {
    URL, fetch, document, location: { origin: 'https://charatopia.test' },
    AbortSignal: { timeout: milliseconds => ({ timeout: milliseconds }) },
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console: { warn() {} },
  };
  const api = runInNewContext(`${source.replace(/^export /gm, '')}\n({ getSiteConfig, refreshSiteConfig, applySiteBranding, setSitePageTitle, publicFileUrl, normalizeSiteConfig, safeSiteUrl })`, context);
  return { ...api, document, name, link, logo, fallback, icon, heading, brandText, events };
}

describe('shared site configuration', () => {
  it('loads lazily and shares one request with branding and wallpaper consumers', async () => {
    const calls = [];
    const wallpaper = { enabled: true, items: [{ url: '/forest.jpg' }] };
    const app = fixture(async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({ ownerName: '万灵之乡', welcomeWallpaper: wallpaper }) };
    });
    assert.equal(calls.length, 0);
    const first = app.getSiteConfig(), second = app.getSiteConfig();
    assert.equal(first, second);
    const config = await first;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/api/userConfig');
    assert.equal(calls[0][1].cache, 'no-store');
    assert.equal(calls[0][1].signal.timeout, 5000);
    assert.equal(config.ownerName, '万灵之乡');
    assert.equal(config.siteTitle, 'Charatopia');
    assert.equal(config.welcomeWallpaper, wallpaper);
  });

  it('rejects unsafe configuration URLs and keeps safe local paths', () => {
    const app = fixture();
    for (const value of ['javascript:alert(1)', '//external.test/a', '/\\external.test/a', 'https://user:password@example.test/a', 'https://example.test/\nimage.png', 'data:image/svg+xml,svg', 'relative.png']) {
      assert.equal(app.safeSiteUrl(value), '', value);
    }
    assert.equal(app.safeSiteUrl('/images/logo.png'), '/images/logo.png');
    assert.equal(app.safeSiteUrl(' https://images.test/logo.png '), 'https://images.test/logo.png');
    const config = app.normalizeSiteConfig({ logoLink: 'javascript:alert(1)', logoUrl: '//example.test/logo.svg', siteIcon: 'bad', ownerName: '' });
    assert.equal(config.logoLink, '/');
    assert.equal(config.logoUrl, '');
    assert.equal(config.siteIcon, '/static/media/logo.png');
    assert.equal(config.ownerName, 'Charatopia');
  });

  it('preserves the newest workspace title when configuration arrives late', async () => {
    let finish;
    const app = fixture(() => new Promise(resolve => { finish = resolve; }));
    const pending = app.getSiteConfig();
    app.setSitePageTitle('我的文件');
    app.setSitePageTitle('网站设置');
    finish({ ok: true, json: async () => ({ siteTitle: 'My Realm' }) });
    app.applySiteBranding(app.document, await pending);
    assert.equal(app.document.title, '网站设置 · My Realm');
  });

  it('applies names as plain text and restores the mark after a broken logo', () => {
    const app = fixture();
    const name = '<img src=x onerror=alert(1)>';
    app.applySiteBranding(app.document, { ownerName: name, siteTitle: 'Realm', logoUrl: '/missing.png', logoLink: '/discover/', siteIcon: '/icon.ico' });
    assert.equal(app.name.textContent, name);
    assert.equal(app.link.attributes.href, '/discover/');
    assert.equal(app.link.attributes['aria-label'], `${name} 首页`);
    assert.equal(app.icon.href, '/icon.ico');
    assert.equal(app.document.title, '发现 · Realm');
    assert.equal(app.fallback.hidden, true);
    assert.equal(app.logo.children[0].src, '/missing.png');
    app.logo.children[0].events.error();
    assert.equal(app.fallback.hidden, false);
    assert.equal(app.logo.children.length, 0);
  });

  it('refreshes saved settings once and notifies the shared wallpaper player', async () => {
    let count = 0;
    const app = fixture(async () => ({ ok: true, json: async () => ({ siteTitle: ++count === 1 ? 'Old' : 'New' }) }));
    await app.getSiteConfig();
    assert.equal(app.events.length, 0);
    const config = await app.refreshSiteConfig();
    assert.equal(config.siteTitle, 'New');
    assert.equal((await app.getSiteConfig()).siteTitle, 'New');
    assert.equal(count, 2);
    assert.equal(app.events[0].type, 'charatopia:site-config-change');
    assert.equal(app.events[0].detail, config);
    assert.equal(app.document.title, '发现 · New');
  });

  it('uses the English wordmark by default and preserves configured brands and custom logos', () => {
    const app = fixture();
    app.applySiteBranding(app.document, {});
    assert.equal(app.logo.hidden, false);
    assert.equal(app.logo.attributes['data-custom-logo'], 'false');
    assert.equal(app.brandText.hidden, true);
    assert.equal(app.heading.classList.values.has('site-wordmark'), true);
    app.applySiteBranding(app.document, { ownerName: 'Another Brand' });
    assert.equal(app.logo.hidden, true);
    assert.equal(app.brandText.hidden, false);
    assert.equal(app.heading.classList.values.has('site-wordmark'), false);
    app.applySiteBranding(app.document, { logoUrl: '/my-logo.png' });
    assert.equal(app.logo.hidden, false);
    assert.equal(app.logo.attributes['data-custom-logo'], 'true');
    assert.equal(app.brandText.hidden, false);
    app.logo.children[0].events.error();
    assert.equal(app.logo.hidden, false);
    assert.equal(app.logo.attributes['data-custom-logo'], 'false');
    assert.equal(app.brandText.hidden, true);
  });

  it('falls back to current settings after an initial request failure', async () => {
    const app = fixture(async () => { throw new Error('network unavailable'); });
    const config = await app.getSiteConfig();
    assert.equal(config.siteTitle, 'Charatopia');
    assert.equal(config.logoLink, '/');
    assert.equal(app.events.length, 0);
  });

  it('rejects a failed refresh without changing current branding or broadcasting success', async () => {
    let count = 0;
    const app = fixture(async () => {
      count += 1;
      if (count === 2) throw new Error('request timed out');
      return { ok: true, json: async () => ({ siteTitle: count === 1 ? 'Current' : 'Updated' }) };
    });
    const current = await app.getSiteConfig();
    app.applySiteBranding(app.document, current);
    await assert.rejects(app.refreshSiteConfig(), /request timed out/);
    assert.equal(app.document.title, '发现 · Current');
    assert.equal(app.events.length, 0);
    assert.equal(await app.getSiteConfig(), current);
    assert.equal(count, 2);
    await app.refreshSiteConfig();
    assert.equal(app.document.title, '发现 · Updated');
    assert.equal(app.events.length, 1);
  });

  it('builds only public file links with the configured prefix and encoded IDs', () => {
    const app = fixture();
    assert.equal(app.publicFileUrl('users/master/春日 #1.png'), 'https://charatopia.test/file/users/master/%E6%98%A5%E6%97%A5%20%231.png');
    assert.equal(app.publicFileUrl('users/master/a.png', { urlPrefix: 'https://cdn.test/files/' }), 'https://cdn.test/files/users/master/a.png');
    assert.equal(app.publicFileUrl('users/master/a.png', { urlPrefix: '/assets/' }), 'https://charatopia.test/assets/users/master/a.png');
    assert.equal(app.publicFileUrl('a.png', { urlPrefix: 'javascript:bad' }), 'https://charatopia.test/file/a.png');
  });

  it('rejects query strings and fragments only for the public file prefix', () => {
    const app = fixture();
    for (const urlPrefix of ['https://cdn.test/files?token=x', 'https://cdn.test/files#images', '/assets?x=1', '/assets#images', '/assets?', '/assets#']) {
      assert.equal(app.normalizeSiteConfig({ urlPrefix }).urlPrefix, '', urlPrefix);
      assert.equal(app.publicFileUrl('a.png', { urlPrefix }), 'https://charatopia.test/file/a.png');
    }
    const config = app.normalizeSiteConfig({ logoUrl: '/logo.png?v=2', logoLink: '/discover/?sort=new#explore', siteIcon: '/icon.png?v=2' });
    assert.equal(config.logoUrl, '/logo.png?v=2');
    assert.equal(config.logoLink, '/discover/?sort=new#explore');
    assert.equal(config.siteIcon, '/icon.png?v=2');
  });

  it('prefers the server public URL for upload results without changing preview URLs', () => {
    const upload = readFileSync(new URL('../frontend-dist/account/upload-in-files.js', import.meta.url), 'utf8');
    const parser = runInNewContext(`${upload.slice(0, upload.indexOf("document.addEventListener('click'"))}\nparseUploadResponse`, {
      URL, URLSearchParams, location: { origin: 'https://charatopia.test', search: '?view=files' },
      sessionStorage: { getItem: () => null, removeItem() {} },
      document: { addEventListener() {}, querySelector: () => null }, MutationObserver: class { observe() {} },
    });
    const result = parser({ status: 200, responseText: JSON.stringify([{ src: '/file/a.png', publicUrl: 'https://cdn.test/a.png' }]) }, 'a.png');
    assert.equal(result.url, 'https://cdn.test/a.png');
  });
});
