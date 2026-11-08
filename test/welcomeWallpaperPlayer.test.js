import assert from 'assert';
import { readFileSync } from 'fs';
import { runInNewContext } from 'vm';
import { safeSiteUrl } from '../frontend-dist/site-config.js';

const source = readFileSync(new URL('../frontend-dist/welcome/wallpaper.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../frontend-dist/wallpaper-player.js', import.meta.url), 'utf8');

function eventListeners() {
  const entries = new Map();
  return {
    get size() { return entries.size; },
    add(name, callback) { if (!entries.has(name)) entries.set(name, new Set()); entries.get(name).add(callback); },
    remove(name, callback) { const values = entries.get(name); values?.delete(callback); if (!values?.size) entries.delete(name); },
    get(name) { const values = entries.get(name); return values ? event => [...values].forEach(callback => callback(event)) : undefined; },
  };
}

function playerEnvironment({ reducedMotion = false, hidden = false, response, failure } = {}) {
  const values = new Map();
  const timers = new Map();
  const images = [];
  const requests = [];
  const warnings = [];
  const listeners = eventListeners();
  const motionListeners = eventListeners();
  const pageListeners = eventListeners();
  let timerId = 0;
  const document = {
    hidden,
    body: { style: { setProperty: (name, value) => values.set(name, value), removeProperty: name => values.delete(name) } },
    addEventListener: (name, callback) => listeners.add(name, callback),
    removeEventListener: (name, callback) => listeners.remove(name, callback),
  };
  const motion = {
    matches: reducedMotion,
    addEventListener: (name, callback) => motionListeners.add(name, callback),
    removeEventListener: (name, callback) => motionListeners.remove(name, callback),
  };
  const window = {
    matchMedia: () => motion,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, callback) => pageListeners.add(name, callback),
    removeEventListener: (name, callback) => pageListeners.remove(name, callback),
  };
  const script = `${playerSource}\n${source}`.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const api = runInNewContext(`${script}\n({ applyWallpaperConfig, initializeWelcomeWallpaper, initializeWorkspaceWallpaper })`, {
    document, window,
    URL, safeSiteUrl,
    Image: class { constructor() { images.push(this); } },
    console: { warn: (...args) => warnings.push(args) },
    AbortSignal: { timeout: () => ({}) },
    getSiteConfig: async () => {
      requests.push('site-config');
      if (failure) throw failure;
      const result = response || { ok: true, json: async () => ({}) };
      if (!result.ok) throw new Error('Configuration unavailable');
      return result.json();
    },
  });
  return {
    ...api, document, motion, images, timers, requests, warnings, listeners, motionListeners, pageListeners,
    value: (name, prefix = 'welcome-wallpaper') => values.get(`--${prefix}-${name}`),
    load: (index, success = true) => images[index][success ? 'onload' : 'onerror']?.(),
    tick: () => {
      assert.equal(timers.size, 1, 'there should be exactly one scheduled rotation');
      const [id, timer] = [...timers][0];
      timers.delete(id);
      timer.callback();
    },
    visibility: value => { document.hidden = value; listeners.get('visibilitychange')?.(); },
    setMotion: value => { motion.matches = value; motionListeners.get('change')?.(); },
    siteConfig: value => pageListeners.get('charatopia:site-config-change')?.({ detail: value }),
  };
}

const image = (url, positions = {}) => ({ url, positionX: 50, positionY: 50, mobilePositionX: 60, mobilePositionY: 0, ...positions });
const config = (items, values = {}) => ({ enabled: true, intervalSeconds: 15, opacity: 1, items, ...values });

describe('welcome wallpaper player', () => {
  it('loads the configured queue in order and only replaces a loaded image', () => {
    const env = playerEnvironment();
    env.applyWallpaperConfig(config([image('/one.jpg'), image('/two.jpg')], { intervalSeconds: 20, opacity: .7 }));
    assert.equal(env.images[0].src, '/one.jpg');
    assert.equal(env.value('image'), undefined);
    env.load(0);
    assert.equal(env.value('image'), 'url("/one.jpg")');
    assert.equal(env.value('opacity'), '0.7');
    assert.equal([...env.timers.values()][0].delay, 20000);
    env.tick();
    assert.equal(env.images[1].src, '/two.jpg');
    assert.equal(env.value('image'), 'url("/one.jpg")');
    env.load(1);
    assert.equal(env.value('image'), 'url("/two.jpg")');
    env.tick();
    assert.equal(env.images[2].src, '/one.jpg');
  });

  it('keeps a single wallpaper static and applies separate desktop and mobile focal points', () => {
    const env = playerEnvironment();
    env.applyWallpaperConfig(config([image('/one.jpg', { positionX: 25, positionY: 35, mobilePositionX: 70, mobilePositionY: 10 })]));
    env.load(0);
    assert.equal(env.timers.size, 0);
    assert.equal(env.value('x'), '25%');
    assert.equal(env.value('y'), '35%');
    assert.equal(env.value('mobile-x'), '70%');
    assert.equal(env.value('mobile-y'), '10%');
  });

  it('uses a solid background when explicitly disabled or when the queue is empty', () => {
    for (const settings of [config([image('/one.jpg')], { enabled: false }), config([])]) {
      const env = playerEnvironment();
      env.applyWallpaperConfig(settings);
      assert.equal(env.value('image'), 'none');
      assert.equal(env.images.length, 0);
      assert.equal(env.timers.size, 0);
    }
  });

  it('keeps the current image on loading failure and waits the normal interval before advancing', () => {
    const env = playerEnvironment();
    env.applyWallpaperConfig(config([image('/one.jpg'), image('/broken.jpg'), image('/three.jpg')]));
    env.load(0);
    env.tick();
    env.load(1, false);
    assert.equal(env.value('image'), 'url("/one.jpg")');
    assert.equal(env.images.length, 2);
    assert.equal(env.warnings.length, 1);
    assert.equal([...env.timers.values()][0].delay, 15000);
    env.tick();
    assert.equal(env.images[2].src, '/three.jpg');
    env.load(2);
    assert.equal(env.value('image'), 'url("/three.jpg")');
  });

  it('pauses while hidden and resumes from the next queued wallpaper', () => {
    const env = playerEnvironment();
    env.applyWallpaperConfig(config([image('/one.jpg'), image('/two.jpg')]));
    env.load(0);
    env.visibility(true);
    assert.equal(env.timers.size, 0);
    env.visibility(false);
    env.tick();
    assert.equal(env.images[1].src, '/two.jpg');
  });

  it('keeps the first image static for reduced motion and responds to preference changes', () => {
    const env = playerEnvironment({ reducedMotion: true });
    env.applyWallpaperConfig(config([image('/one.jpg'), image('/two.jpg')]));
    env.load(0);
    assert.equal(env.value('image'), 'url("/one.jpg")');
    assert.equal(env.timers.size, 0);
    env.setMotion(false);
    assert.equal(env.timers.size, 1);
    env.setMotion(true);
    assert.equal(env.timers.size, 0);
  });

  it('resumes the existing queue after back-forward cache restores without new requests or duplicate timers', async () => {
    const env = playerEnvironment({ response: { ok: true, json: async () => ({ welcomeWallpaper: config([image('/one.jpg'), image('/two.jpg')]) }) } });
    const stop = await env.initializeWelcomeWallpaper();
    env.load(0);
    const listenerCounts = [env.listeners.size, env.motionListeners.size, env.pageListeners.size];
    env.pageListeners.get('pagehide')({ persisted: true });
    assert.equal(env.timers.size, 0);
    env.visibility(false);
    assert.equal(env.timers.size, 0);
    env.pageListeners.get('pageshow')({ persisted: true });
    env.pageListeners.get('pageshow')({ persisted: true });
    assert.equal(env.timers.size, 1);
    env.tick();
    assert.equal(env.images[1].src, '/two.jpg');
    env.pageListeners.get('pagehide')({ persisted: true });
    env.load(1);
    assert.equal(env.timers.size, 0);
    env.pageListeners.get('pageshow')({ persisted: true });
    assert.equal(env.timers.size, 1);
    assert.equal(env.requests.length, 1);
    assert.deepEqual([env.listeners.size, env.motionListeners.size, env.pageListeners.size], listenerCounts);
    stop();
    assert.equal(env.timers.size, 0);
    assert.equal(env.listeners.size + env.motionListeners.size + env.pageListeners.size, 0);
  });

  it('cleans up permanently when the page is unloaded without back-forward caching', () => {
    const env = playerEnvironment();
    env.applyWallpaperConfig(config([image('/one.jpg'), image('/two.jpg')]));
    env.load(0);
    env.pageListeners.get('pagehide')({ persisted: false });
    assert.equal(env.timers.size, 0);
    assert.equal(env.listeners.size + env.motionListeners.size + env.pageListeners.size, 0);
  });

  it('removes timers and listeners and ignores images that finish after cleanup', () => {
    const env = playerEnvironment();
    const stop = env.applyWallpaperConfig(config([image('/one.jpg'), image('/two.jpg')]));
    env.load(0);
    env.tick();
    const lateLoad = env.images[1].onload;
    stop();
    lateLoad();
    assert.equal(env.value('image'), 'url("/one.jpg")');
    assert.equal(env.timers.size, 0);
    assert.equal(env.listeners.size, 0);
    assert.equal(env.motionListeners.size, 0);
    assert.equal(env.pageListeners.size, 0);
  });

  it('reads public configuration once without polling the server', async () => {
    const env = playerEnvironment({ response: { ok: true, json: async () => ({ welcomeWallpaper: config([image('/one.jpg'), image('/two.jpg')]) }) } });
    await env.initializeWelcomeWallpaper();
    env.load(0);
    env.tick();
    env.load(1);
    assert.equal(env.requests.length, 1);
    assert.equal(env.requests[0], 'site-config');
  });

  it('retains the built-in wallpaper and reports missing or unavailable configuration', async () => {
    for (const options of [
      { response: { ok: true, json: async () => ({}) } },
      { response: { ok: false, status: 500 } },
      { failure: new Error('Network unavailable') },
    ]) {
      const env = playerEnvironment(options);
      await env.initializeWelcomeWallpaper();
      assert.equal(env.value('image'), undefined);
      assert.equal(env.images.length, 0);
      assert.equal(env.warnings.length, 1);
    }
  });

  it('rejects malformed settings without loading a URL or starting rotation', () => {
    for (const settings of [
      config([image('javascript:alert(1)')]),
      config([image('//other.example/a.jpg')]),
      config([image('/one.jpg')], { intervalSeconds: 0 }),
      config([image('/one.jpg')], { opacity: 2 }),
    ]) {
      const env = playerEnvironment();
      env.applyWallpaperConfig(settings);
      assert.equal(env.value('image'), undefined);
      assert.equal(env.images.length, 0);
      assert.equal(env.timers.size, 0);
      assert.equal(env.warnings.length, 1);
    }
  });
});

describe('workspace wallpaper settings', () => {
  const environment = settings => playerEnvironment({ response: { ok: true, json: async () => settings } });
  const value = (env, name) => env.value(name, 'account-wallpaper');

  it('rotates upload wallpapers in order using the legacy millisecond interval and image opacity', async () => {
    const env = environment({ uploadBkImg: ['/one.jpg', '/two.jpg'], bkInterval: '4200', bkOpacity: '.35' });
    await env.initializeWorkspaceWallpaper();
    env.load(0);
    assert.equal(value(env, 'image'), 'url("/one.jpg")');
    assert.equal(value(env, 'opacity'), '0.35');
    assert.equal([...env.timers.values()][0].delay, 4200);
    assert.equal(env.value('image'), undefined, 'workspace settings must not change the welcome wallpaper');
    env.tick();
    assert.equal(env.images[1].src, '/two.jpg');
    env.load(1);
    env.tick();
    assert.equal(env.images[2].src, '/one.jpg');
    assert.equal(env.requests.length, 1);
  });

  it('supports a single URL without scheduling rotation and keeps the original 3000 ms default', async () => {
    const single = environment({ uploadBkImg: 'https://images.example/one.jpg' });
    await single.initializeWorkspaceWallpaper();
    single.load(0);
    assert.equal(value(single, 'image'), 'url("https://images.example/one.jpg")');
    assert.equal(single.timers.size, 0);
    const multiple = environment({ uploadBkImg: ['/one.jpg', '/two.jpg'] });
    await multiple.initializeWorkspaceWallpaper();
    multiple.load(0);
    assert.equal([...multiple.timers.values()][0].delay, 3000);
    assert.equal(value(multiple, 'opacity'), '1');
  });

  it('uses the admin queue for admin views and otherwise falls back to the upload queue', async () => {
    for (const [settings, isAdmin, expected] of [
      [{ adminBkImg: ['/admin.jpg'], uploadBkImg: ['/upload.jpg'] }, true, '/admin.jpg'],
      [{ adminBkImg: ['/admin.jpg'], uploadBkImg: ['/upload.jpg'] }, false, '/upload.jpg'],
      [{ adminBkImg: [], uploadBkImg: ['/upload.jpg'] }, true, '/upload.jpg'],
      [{ uploadBkImg: '/upload.jpg' }, true, '/upload.jpg'],
    ]) {
      const env = environment(settings);
      await env.initializeWorkspaceWallpaper({ isAdmin });
      assert.equal(env.images[0].src, expected);
    }
  });

  it('disables the image and overlay for an explicit global off setting, but leaves unconfigured gradients intact', async () => {
    const off = environment({ wallpaperEnabled: false, uploadBkImg: ['/one.jpg'] });
    await off.initializeWorkspaceWallpaper();
    assert.equal(value(off, 'image'), 'none');
    assert.equal(value(off, 'overlay'), 'none');
    assert.equal(off.images.length, 0);
    const empty = environment({});
    await empty.initializeWorkspaceWallpaper();
    assert.equal(value(empty, 'image'), undefined);
    assert.equal(value(empty, 'overlay'), undefined);
    assert.equal(empty.images.length, 0);
  });

  it('replaces the current player on saved settings without duplicate timers or stale image loads', async () => {
    const env = environment({ uploadBkImg: ['/old-one.jpg', '/old-two.jpg'] });
    const stop = await env.initializeWorkspaceWallpaper();
    env.load(0);
    env.tick();
    const oldLoad = env.images[1].onload;
    env.siteConfig({ uploadBkImg: ['/new-one.jpg', '/new-two.jpg'], bkInterval: 6000, bkOpacity: .8 });
    assert.equal(env.timers.size, 0);
    oldLoad();
    assert.equal(value(env, 'image'), 'url("/old-one.jpg")');
    env.load(2);
    assert.equal(value(env, 'image'), 'url("/new-one.jpg")');
    assert.equal(value(env, 'opacity'), '0.8');
    assert.equal(env.timers.size, 1);
    assert.equal([...env.timers.values()][0].delay, 6000);
    assert.equal(env.requests.length, 1);
    stop();
    env.siteConfig({ uploadBkImg: ['/ignored.jpg'] });
    assert.equal(env.images.length, 3);
    assert.equal(env.listeners.size + env.motionListeners.size + env.pageListeners.size, 0);
  });

  it('updates enabled and empty settings immediately when an administrator saves changes', async () => {
    const env = environment({ uploadBkImg: ['/one.jpg', '/two.jpg'] });
    await env.initializeWorkspaceWallpaper();
    env.load(0);
    env.siteConfig({ wallpaperEnabled: false });
    assert.equal(value(env, 'image'), 'none');
    assert.equal(value(env, 'overlay'), 'none');
    assert.equal(env.timers.size, 0);
    env.siteConfig({ uploadBkImg: [] });
    assert.equal(value(env, 'image'), undefined);
    assert.equal(value(env, 'overlay'), undefined);
    env.siteConfig({ uploadBkImg: '/enabled.jpg' });
    env.load(1);
    assert.equal(value(env, 'image'), 'url("/enabled.jpg")');
    assert.equal(value(env, 'overlay'), undefined);
  });

  it('retains lifecycle handling for hidden pages, reduced motion and back-forward cache restores', async () => {
    const env = environment({ uploadBkImg: ['/one.jpg', '/two.jpg'] });
    await env.initializeWorkspaceWallpaper();
    env.load(0);
    env.visibility(true);
    assert.equal(env.timers.size, 0);
    env.visibility(false);
    env.setMotion(true);
    assert.equal(env.timers.size, 0);
    env.setMotion(false);
    env.pageListeners.get('pagehide')({ persisted: true });
    assert.equal(env.timers.size, 0);
    env.pageListeners.get('pageshow')({ persisted: true });
    assert.equal(env.timers.size, 1);
    env.tick();
    assert.equal(env.images[1].src, '/two.jpg');
    env.load(1, false);
    assert.equal(value(env, 'image'), 'url("/one.jpg")');
    assert.equal(env.timers.size, 1);
    env.pageListeners.get('pagehide')({ persisted: false });
    assert.equal(env.timers.size, 0);
    assert.equal(env.listeners.size + env.motionListeners.size + env.pageListeners.size, 0);
  });

  it('does not fetch Bing or unsupported image schemes and reports the unsupported source', async () => {
    for (const uploadBkImg of ['bing', ['javascript:alert(1)', '//other.example/image.jpg']]) {
      const env = environment({ uploadBkImg });
      await env.initializeWorkspaceWallpaper();
      assert.equal(env.images.length, 0);
      assert.equal(env.requests.length, 1);
      assert.equal(env.warnings.length, 1);
      assert.equal(env.timers.size, 0);
    }
  });

  it('does not let a late initial response replace settings that have already been refreshed', async () => {
    let resolveInitial;
    const initial = new Promise(resolve => { resolveInitial = resolve; });
    const env = playerEnvironment({ response: { ok: true, json: () => initial } });
    const initialization = env.initializeWorkspaceWallpaper();
    env.siteConfig({ uploadBkImg: '/current.jpg' });
    resolveInitial({ uploadBkImg: '/stale.jpg' });
    await initialization;
    assert.equal(env.images.length, 1);
    assert.equal(env.images[0].src, '/current.jpg');
  });
});
