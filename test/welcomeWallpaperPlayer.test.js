import assert from 'assert';
import { readFileSync } from 'fs';
import { runInNewContext } from 'vm';

const source = readFileSync(new URL('../frontend-dist/welcome/wallpaper.js', import.meta.url), 'utf8');

function playerEnvironment({ reducedMotion = false, hidden = false, response, failure } = {}) {
  const values = new Map();
  const timers = new Map();
  const images = [];
  const requests = [];
  const warnings = [];
  const listeners = new Map();
  const motionListeners = new Map();
  const pageListeners = new Map();
  let timerId = 0;
  const document = {
    hidden,
    body: { style: { setProperty: (name, value) => values.set(name, value) } },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const motion = {
    matches: reducedMotion,
    addEventListener: (name, callback) => motionListeners.set(name, callback),
    removeEventListener: (name, callback) => { if (motionListeners.get(name) === callback) motionListeners.delete(name); },
  };
  const window = {
    matchMedia: () => motion,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, callback) => pageListeners.set(name, callback),
    removeEventListener: (name, callback) => { if (pageListeners.get(name) === callback) pageListeners.delete(name); },
  };
  const api = runInNewContext(`${source.replace(/^export /gm, '')}\n({ applyWallpaperConfig, initializeWelcomeWallpaper })`, {
    document, window,
    Image: class { constructor() { images.push(this); } },
    console: { warn: (...args) => warnings.push(args) },
    AbortSignal: { timeout: () => ({}) },
    fetch: async (...args) => {
      requests.push(args);
      if (failure) throw failure;
      return response || { ok: true, json: async () => ({}) };
    },
  });
  return {
    ...api, document, motion, images, timers, requests, warnings, listeners, motionListeners, pageListeners,
    value: name => values.get(`--welcome-wallpaper-${name}`),
    load: (index, success = true) => images[index][success ? 'onload' : 'onerror']?.(),
    tick: () => {
      assert.equal(timers.size, 1, 'there should be exactly one scheduled rotation');
      const [id, timer] = [...timers][0];
      timers.delete(id);
      timer.callback();
    },
    visibility: value => { document.hidden = value; listeners.get('visibilitychange')?.(); },
    setMotion: value => { motion.matches = value; motionListeners.get('change')?.(); },
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
    assert.equal(env.requests[0][0], '/api/userConfig');
    assert.equal(env.requests[0][1].cache, 'no-store');
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
