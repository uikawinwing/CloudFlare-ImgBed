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
  const context = vm.createContext({
    URLSearchParams, Date, Set,
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      },
      createElement: element,
    },
    window: { addEventListener() {} },
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
  return { elements, requests, context };
}

const iris = {
  id: 'iris-album', characterName: 'Iris', name: '旅行相册', itemCount: 10,
  url: '/gallery/master/iris', coverThumbnailUrl: '/thumb/iris-cover',
  coverUrl: '/file/iris-original.png', coverPositionX: 25, coverPositionY: 75,
  creator: { name: 'Master' },
};

describe('Discover character album feed', () => {
  it('renders one cover per album and never requests original files or video media', async () => {
    const { elements, requests } = await discoverHarness([{ body: {
      albums: [iris, { id: 'video-album', name: '视频', url: '/gallery/master/video', coverUrl: '/file/video.mp4', itemCount: 2 }],
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
    assert.match(markup, /暂无封面/);
    assert.doesNotMatch(markup, /<video|\/file\//);
    assert.deepEqual(requests, ['/api/public/discover?limit=24']);
    assert.equal(elements.get('#loadMore').hidden, true);
    assert.equal(elements.get('#albumGrid').attributes['aria-busy'], 'false');
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
