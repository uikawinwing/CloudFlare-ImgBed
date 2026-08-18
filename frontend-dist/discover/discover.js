const state = { items: [], featuredItems: [], cursor: null, type: 'all', loading: false, done: false };
const masonry = document.querySelector('#masonry');
const feedStatus = document.querySelector('#feedStatus');
const loadMore = document.querySelector('#loadMore');
const feedSentinel = document.querySelector('#feedSentinel');
const dialogRoot = document.querySelector('#dialogRoot');
let lastTrigger = null;
let discoverReady = false;
let lastRefreshAt = 0;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const encodeFilePath = id => String(id).split('/').map(encodeURIComponent).join('/');
const originalUrl = item => item.url || `/file/${encodeFilePath(item.id)}`;
const previewUrl = item => item.thumbnailUrl || originalUrl(item);
const isVideo = item => String(item.type || '').startsWith('video/');
const titleFor = item => item.name || item.id || '未命名作品';
const creatorFor = item => item.creator?.name || item.creator?.handle || '创作者';
const creatorHandleFor = item => item.creator?.handle || null;
const ratioFor = item => {
  const width = Number(item.width);
  const height = Number(item.height);
  return width > 0 && height > 0 ? `${width} / ${height}` : '1 / 1';
};

function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
  return Promise.resolve();
}

function setStatus(kind, message) {
  feedStatus.className = `feed-status ${kind || ''}`.trim();
  feedStatus.textContent = message || '';
}

async function reflectSignInState() {
  try {
    const response = await fetch('/api/user/me', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const body = await response.json();
    if (!body.authenticated) return;
    const accountAction = document.querySelector('[data-account-action]');
    const uploadAction = document.querySelector('[data-upload-action]');
    accountAction.href = '/account/?view=files';
    accountAction.textContent = '我的工作室';
    uploadAction.href = '/account/?view=files&upload=1';
  } catch {}
}

function mediaMarkup(item, eager = false) {
  const title = escapeHtml(titleFor(item));
  if (isVideo(item)) return `<div class="video-placeholder" aria-hidden="true"><span class="play-symbol"></span></div><span class="type-label">视频</span>`;
  return `<img src="${escapeHtml(previewUrl(item))}" alt="${title}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${eager ? 'high' : 'low'}">`;
}

function cardMarkup(item, featured = false) {
  if (featured) return `<button class="feature-card" type="button" data-open-id="${escapeHtml(item.id)}" aria-label="查看作品"><span class="feature-media">${mediaMarkup(item)}</span></button>`;
  return `<article class="pin"><button class="pin-button" type="button" data-open-id="${escapeHtml(item.id)}" aria-label="查看作品"><span class="pin-media" style="aspect-ratio:${ratioFor(item)}">${mediaMarkup(item)}</span></button></article>`;
}

function render() {
  const query = document.querySelector('#searchInput').value.trim().toLocaleLowerCase('zh-CN');
  const visible = state.items.filter(item => {
    const terms = `${titleFor(item)} ${creatorFor(item)} ${creatorHandleFor(item) || ''}`.toLocaleLowerCase('zh-CN');
    return !query || terms.includes(query);
  });
  masonry.innerHTML = visible.map(item => cardMarkup(item)).join('');
  if (!state.loading && !visible.length && state.items.length) setStatus('empty', '没有符合这个搜索条件的公开作品。');
  else if (!state.loading && !state.items.length) setStatus('empty', '还没有公开作品。第一批作品发布后，会在这里出现。');
  else if (!state.loading) setStatus('', '');
  loadMore.hidden = state.done || !state.items.length;
}

function featured(items) {
  const section = document.querySelector('#featured');
  const hero = document.querySelector('#heroFeature');
  const rail = document.querySelector('#featuredRail');
  state.featuredItems = items;
  hero.hidden = true;
  hero.innerHTML = '';
  rail.innerHTML = '';
  const heroItem = items[0];
  section.hidden = !heroItem;
  if (!heroItem) return;

  hero.hidden = false;
  hero.innerHTML = `<button type="button" data-open-id="${escapeHtml(heroItem.id)}" aria-label="查看精选作品"><span class="hero-media">${mediaMarkup(heroItem, true)}</span><span class="hero-feature-overlay"><small>精选推荐</small></span></button>`;
  rail.innerHTML = items.slice(1, 5).map(item => cardMarkup(item, true)).join('');
}

async function loadFeed({ reset = false } = {}) {
  if (state.loading || (!reset && state.done)) return;
  state.loading = true;
  if (reset) {
    state.items = [];
    state.cursor = null;
    state.done = false;
    masonry.innerHTML = '';
  }
  setStatus('loading', '正在读取公开作品…');
  loadMore.disabled = true;
  try {
    const params = new URLSearchParams({ limit: '24' });
    if (state.type !== 'all') params.set('type', state.type);
    if (state.cursor) params.set('cursor', state.cursor);
    const response = await fetch(`/api/public/discover?${params}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '暂时无法读取公开作品。');
    const items = Array.isArray(body.files) ? body.files : [];
    state.items.push(...items);
    state.cursor = body.nextCursor || body.cursor || null;
    state.done = !state.cursor || !items.length;
    render();
  } catch (error) {
    state.done = true;
    setStatus('error', `${error.message || '暂时无法读取公开作品。'} 请稍后重试。`);
  } finally {
    state.loading = false;
    loadMore.disabled = false;
    loadMore.hidden = state.done || !state.items.length;
  }
}

async function loadFeatured() {
  try {
    const response = await fetch('/api/public/discover?limit=5&sort=featured', { cache: 'no-store', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return featured([]);
    featured(Array.isArray(body.files) ? body.files : []);
  } catch {
    featured([]);
  }
}

async function refreshDiscover() {
  const now = Date.now();
  if (!discoverReady || now - lastRefreshAt < 30000) return;
  lastRefreshAt = now;
  await Promise.all([loadFeatured(), loadFeed({ reset: true })]);
}

function openMedia(item) {
  if (!item) return;
  const title = titleFor(item);
  const media = isVideo(item)
    ? `<video class="dialog-media" src="${escapeHtml(originalUrl(item))}" controls playsinline preload="metadata" aria-label="${escapeHtml(title)}"></video>`
    : `<img class="dialog-media" src="${escapeHtml(originalUrl(item))}" alt="${escapeHtml(title)}">`;
  const handle = creatorHandleFor(item);
  dialogRoot.innerHTML = `<div class="dialog-backdrop" data-close-dialog><section class="media-dialog" role="dialog" aria-modal="true" aria-labelledby="mediaTitle" tabindex="-1"><button class="dialog-close" type="button" data-close-dialog aria-label="关闭预览">×</button><div class="dialog-visual">${media}</div><div class="dialog-panel"><p class="dialog-kicker">公开作品</p><h2 id="mediaTitle">${escapeHtml(title)}</h2><p class="dialog-by">${escapeHtml(creatorFor(item))}${handle ? ` · @${escapeHtml(handle)}` : ''}</p><div class="dialog-actions"><button class="text-button" type="button" data-copy-link>复制资源链接</button><a class="primary-button" href="${escapeHtml(originalUrl(item))}" target="_blank" rel="noopener">打开原文件</a></div></div></section></div>`;
  const dialog = dialogRoot.querySelector('.media-dialog');
  dialog.focus();
  dialogRoot.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', event => {
    if (event.target === event.currentTarget || event.currentTarget.matches('button')) closeDialog();
  }));
  dialogRoot.querySelector('[data-copy-link]').addEventListener('click', async event => {
    await copyText(new URL(originalUrl(item), location.origin).href);
    event.currentTarget.textContent = '已复制';
  });
}

function closeDialog() {
  dialogRoot.innerHTML = '';
  lastTrigger?.focus();
  lastTrigger = null;
}

document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
  state.type = button.dataset.type;
  document.querySelectorAll('[data-type]').forEach(node => {
    const active = node === button;
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-pressed', String(active));
  });
  loadFeed({ reset: true });
}));

document.querySelector('#searchInput').addEventListener('input', render);
loadMore.addEventListener('click', () => loadFeed());
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-open-id]');
  if (!trigger) return;
  lastTrigger = trigger;
  openMedia([...state.featuredItems, ...state.items].find(item => String(item.id) === trigger.dataset.openId));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dialogRoot.firstChild) closeDialog();
});
window.addEventListener('focus', refreshDiscover);

Promise.all([reflectSignInState(), loadFeatured(), loadFeed()]).finally(() => {
  discoverReady = true;
  lastRefreshAt = Date.now();
  if ('IntersectionObserver' in window && feedSentinel) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !state.loading && !state.done) loadFeed();
    }, { rootMargin: '500px 0px' });
    observer.observe(feedSentinel);
  }
});
