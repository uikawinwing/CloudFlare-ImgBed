const state = { albums: [], cursor: null, loading: false, done: false, failed: false, retryReset: false };
const albumGrid = document.querySelector('#albumGrid');
const feedStatus = document.querySelector('#feedStatus');
const loadMore = document.querySelector('#loadMore');
const feedSentinel = document.querySelector('#feedSentinel');
let discoverReady = false;
let lastRefreshAt = 0;
let videoCoverObserver = null;
const visibleVideoCovers = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const albumCoverPosition = value => {
  const position = Number(value);
  return Number.isInteger(position) && position >= 0 && position <= 100 ? position : 50;
};

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

function albumCardMarkup(album) {
  const title = album.characterName || album.name || '未命名相册';
  const objectPosition = `${albumCoverPosition(album.coverPositionX)}% ${albumCoverPosition(album.coverPositionY)}%`;
  const isVideoCover = ['video/mp4', 'video/webm'].includes(album.coverType) && album.coverUrl;
  const coverMarkup = isVideoCover
    ? `<video data-video-src="${escapeHtml(album.coverUrl)}" muted loop playsinline preload="none" aria-hidden="true" style="object-position:${objectPosition}"></video><span class="album-cover-video-label">视频</span>`
    : album.coverThumbnailUrl
    ? `<img src="${escapeHtml(album.coverThumbnailUrl)}" alt="" loading="lazy" decoding="async" style="object-position:${objectPosition}">`
    : '<span class="album-cover-empty">暂无封面</span>';
  return `<a class="album-card" href="${escapeHtml(album.url)}">
    <span class="album-cover">${coverMarkup}</span>
    <span class="album-card-info"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(album.creator?.name || album.creator?.handle || '创作者')} · ${Number(album.itemCount) || 0} 项</small></span>
  </a>`;
}

function updateVideoCoverPlayback() {
  visibleVideoCovers.forEach(video => {
    if (document.hidden) { video.pause(); return; }
    if (!video.hasAttribute('src')) {
      video.preload = 'metadata';
      video.src = video.dataset.videoSrc;
      video.load();
    }
    if (reducedMotion.matches) video.pause();
    else video.play().catch(() => {});
  });
}

function observeVideoCovers() {
  const videos = albumGrid.querySelectorAll('video');
  if (!videos.length || !('IntersectionObserver' in window)) return;
  videoCoverObserver = new IntersectionObserver(entries => {
    entries.forEach(({ target: video, isIntersecting }) => {
      if (isIntersecting) visibleVideoCovers.add(video);
      else { visibleVideoCovers.delete(video); video.pause(); }
    });
    updateVideoCoverPlayback();
  }, { threshold: .1 });
  videos.forEach(video => videoCoverObserver.observe(video));
}

function render() {
  const query = document.querySelector('#searchInput').value.trim().toLocaleLowerCase('zh-CN');
  const visible = state.albums.filter(album => {
    const terms = `${album.characterName || ''} ${album.name || ''} ${album.description || ''} ${album.creator?.name || ''} ${album.creator?.handle || ''}`.toLocaleLowerCase('zh-CN');
    return !query || terms.includes(query);
  });
  videoCoverObserver?.disconnect();
  albumGrid.querySelectorAll('video').forEach(video => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
  visibleVideoCovers.clear();
  albumGrid.innerHTML = visible.map(albumCardMarkup).join('');
  albumGrid.querySelectorAll('img, video').forEach(media => media.addEventListener('error', () => {
    const placeholder = document.createElement('span');
    placeholder.className = 'album-cover-empty';
    placeholder.textContent = '封面暂不可用';
    if (media.tagName === 'VIDEO') {
      visibleVideoCovers.delete(media);
      videoCoverObserver?.unobserve(media);
      media.pause();
    }
    media.replaceWith(placeholder);
  }, { once: true }));
  observeVideoCovers();
  if (!state.loading && !state.failed) {
    if (!visible.length && state.albums.length) setStatus('empty', '已加载的相册中没有符合搜索条件的结果。');
    else if (!state.albums.length) setStatus('empty', '还没有人物相册。创建相册并加入作品后，会在这里出现。');
    else setStatus('', '');
  }
  loadMore.hidden = !state.failed && (state.done || !state.albums.length);
}

async function loadFeed({ reset = false } = {}) {
  if (state.loading || (!reset && state.done)) return;
  state.loading = true;
  state.failed = false;
  albumGrid.setAttribute('aria-busy', 'true');
  setStatus('loading', '正在读取人物相册…');
  loadMore.disabled = true;
  try {
    const params = new URLSearchParams({ limit: '24' });
    if (!reset && state.cursor) params.set('cursor', state.cursor);
    const response = await fetch(`/api/public/discover?${params}`, { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '暂时无法读取人物相册。');
    const albums = Array.isArray(body.albums) ? body.albums : [];
    if (reset) state.albums = [];
    const existingIds = new Set(state.albums.map(album => album.id));
    for (const album of albums) {
      if (existingIds.has(album.id)) continue;
      existingIds.add(album.id);
      state.albums.push(album);
    }
    state.cursor = body.nextCursor || null;
    state.done = !state.cursor || !albums.length;
    state.retryReset = false;
    state.loading = false;
    render();
  } catch (error) {
    state.failed = true;
    state.retryReset = reset;
    setStatus('error', error.message || '暂时无法读取人物相册。');
  } finally {
    state.loading = false;
    albumGrid.setAttribute('aria-busy', 'false');
    loadMore.disabled = false;
    loadMore.textContent = state.failed ? '重试' : '加载更多';
    loadMore.hidden = !state.failed && (state.done || !state.albums.length);
  }
}

async function refreshDiscover() {
  const now = Date.now();
  if (!discoverReady || now - lastRefreshAt < 30000) return;
  lastRefreshAt = now;
  await loadFeed({ reset: true });
}

document.querySelector('#searchInput').addEventListener('input', render);
loadMore.addEventListener('click', () => loadFeed({ reset: state.retryReset }));
window.addEventListener('focus', refreshDiscover);
document.addEventListener('visibilitychange', updateVideoCoverPlayback);
reducedMotion.addEventListener('change', updateVideoCoverPlayback);

Promise.all([reflectSignInState(), loadFeed()]).finally(() => {
  discoverReady = true;
  lastRefreshAt = Date.now();
  if ('IntersectionObserver' in window && feedSentinel) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !state.loading && !state.done && !state.failed) loadFeed();
    }, { rootMargin: '500px 0px' });
    observer.observe(feedSentinel);
  }
});
