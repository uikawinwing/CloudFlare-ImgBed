import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../frontend-dist/discover/discover.js', import.meta.url), 'utf8');

function element() {
  return {
    innerHTML: '', textContent: '', value: '', hidden: false, attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    querySelectorAll() { return []; },
  };
}

async function discoverHarness(responses) {
  const elements = new Map();
  const requests = [];
  const documentListeners = {};
  const motion = { matches: false, addEventListener(name, callback) { this.onChange = callback; } };
  const context = vm.createContext({
    URLSearchParams, Date, Set,
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      },
      createElement: element,
      hidden: false,
      addEventListener(name, callback) { documentListeners[name] = callback; },
    },
    window: { addEventListener() {}, matchMedia: () => motion },
    fetch: async url => {
      if (url === '/api/user/me') return { ok: false };
      requests.push(url);
      const response = responses.shift();
      if (!response) throw new Error('Unexpected Discover request');
      return { ok: response.ok !== false, json: async () => response.body };
    },
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { elements, requests, context, motion, documentListeners };
}

const iris = {
  id: 'iris-album', characterName: 'Iris', name: '旅行相册', itemCount: 10,
  url: '/gallery/master/iris', coverThumbnailUrl: '/thumb/iris-cover',
  coverUrl: '/file/iris-original.png', coverPositionX: 25, coverPositionY: 75,
  creator: { name: 'Master' },
};

describe('Discover character album feed', () => {
  it('renders image thumbnails and defers video sources until their covers are visible', async () => {
    const { elements, requests } = await discoverHarness([{ body: {
      albums: [iris, { id: 'video-album', name: '视频', url: '/gallery/master/video', coverUrl: '/file/video.mp4', coverType: 'video/mp4', itemCount: 2 }],
      files: Array.from({ length: 10 }, (_, index) => ({ id: `image-${index}`, url: `/file/${index}.png` })),
      nextCursor: null,
    } }]);
    const markup = elements.get('#albumGrid').innerHTML;
    assert.equal((markup.match(/class="album-card"/g) || []).length, 2);
    assert.equal((markup.match(/<img/g) || []).length, 1);
    assert.match(markup, /href="\/gallery\/master\/iris"/);
    assert.match(markup, /src="\/thumb\/iris-cover"/);
    assert.match(markup, /object-position:25% 75%/);
    assert.match(markup, /Iris[\s\S]*10 项/);
    assert.match(markup, /<video[^>]*data-video-src="\/file\/video.mp4"[^>]*muted[^>]*loop[^>]*playsinline[^>]*preload="none"/);
    assert.doesNotMatch(markup, /<video[^>]*\ssrc=/);
    assert.doesNotMatch(markup, /iris-original/);
    assert.deepEqual(requests, ['/api/public/discover?limit=24']);
    assert.equal(elements.get('#loadMore').hidden, true);
    assert.equal(elements.get('#albumGrid').attributes['aria-busy'], 'false');
  });

  it('loads only visible video covers and pauses them offscreen, in hidden tabs, and with reduced motion', async () => {
    const { elements, context, motion, documentListeners } = await discoverHarness([{ body: { albums: [], nextCursor: null } }]);
    const observers = [];
    class Observer {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    }
    context.IntersectionObserver = Observer;
    context.window.IntersectionObserver = Observer;
    const video = {
      dataset: { videoSrc: '/file/clip.webm' }, loads: 0, plays: 0, pauses: 0,
      hasAttribute(name) { return name === 'src' && Boolean(this.src); },
      removeAttribute(name) { if (name === 'src') delete this.src; },
      load() { this.loads += 1; },
      play() { this.plays += 1; return Promise.resolve(); },
      pause() { this.pauses += 1; },
    };
    elements.get('#albumGrid').querySelectorAll = selector => selector === 'video' ? [video] : [];
    context.observeVideoCovers();
    assert.equal(video.src, undefined);
    assert.equal(video.loads, 0);
    observers[0].callback([{ target: video, isIntersecting: true }]);
    assert.equal(video.src, '/file/clip.webm');
    assert.equal(video.loads, 1);
    assert.equal(video.plays, 1);
    observers[0].callback([{ target: video, isIntersecting: false }]);
    assert.equal(video.pauses, 1);
    motion.matches = true;
    observers[0].callback([{ target: video, isIntersecting: true }]);
    assert.equal(video.plays, 1);
    assert.equal(video.pauses, 2);
    motion.matches = false;
    context.document.hidden = true;
    documentListeners.visibilitychange();
    assert.equal(video.plays, 1);
    context.document.hidden = false;
    documentListeners.visibilitychange();
    assert.equal(video.plays, 2);
    context.render();
    assert.equal(observers[0].disconnected, true);
    assert.equal(video.src, undefined);
    assert.equal(video.pauses, 4);
  });

  it('appends later pages without duplicate albums and searches character names', async () => {
    const { elements, requests, context } = await discoverHarness([
      { body: { albums: [iris], nextCursor: 'page2' } },
      { body: { albums: [iris, { id: 'reimu', characterName: 'Reimu <3', name: '春', url: '/gallery/master/reimu' }], nextCursor: null } },
    ]);
    assert.equal(elements.get('#loadMore').hidden, false);
    await context.loadFeed();
    assert.equal((elements.get('#albumGrid').innerHTML.match(/class="album-card"/g) || []).length, 2);
    assert.equal(requests[1], '/api/public/discover?limit=24&cursor=page2');
    elements.get('#searchInput').value = 'reimu';
    context.render();
    assert.doesNotMatch(elements.get('#albumGrid').innerHTML, /Iris/);
    assert.match(elements.get('#albumGrid').innerHTML, /Reimu &lt;3/);
    elements.get('#searchInput').value = 'not-found';
    context.render();
    assert.match(elements.get('#feedStatus').textContent, /没有符合搜索条件/);
  });

  it('keeps a failed first page retryable even after searching', async () => {
    const { elements, context } = await discoverHarness([
      { ok: false, body: { error: '服务暂不可用' } },
      { body: { albums: [iris], nextCursor: null } },
    ]);
    assert.equal(elements.get('#loadMore').hidden, false);
    assert.equal(elements.get('#loadMore').textContent, '重试');
    context.render();
    assert.equal(elements.get('#feedStatus').textContent, '服务暂不可用');
    assert.equal(elements.get('#loadMore').hidden, false);
    await elements.get('#loadMore').listeners.click();
    assert.match(elements.get('#albumGrid').innerHTML, /Iris/);
    assert.equal(elements.get('#loadMore').hidden, true);
  });

  it('retries a failed refresh from the first page while retaining the current covers', async () => {
    const { elements, requests, context } = await discoverHarness([
      { body: { albums: [iris], nextCursor: 'old-page2' } },
      { ok: false, body: {} },
      { body: { albums: [{ ...iris, characterName: 'Iris updated' }], nextCursor: null } },
    ]);
    await context.loadFeed({ reset: true });
    assert.match(elements.get('#albumGrid').innerHTML, /Iris/);
    await elements.get('#loadMore').listeners.click();
    assert.equal(requests[2], '/api/public/discover?limit=24');
    assert.equal((elements.get('#albumGrid').innerHTML.match(/class="album-card"/g) || []).length, 1);
    assert.match(elements.get('#albumGrid').innerHTML, /Iris updated/);
  });
});
