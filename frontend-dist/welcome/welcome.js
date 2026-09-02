const featureRoot = document.querySelector('#welcomeFeature');
const FEATURED_CACHE_KEY = 'imgbed:welcome-featured:v1';
const FEATURED_CACHE_TTL_MS = 10 * 60 * 1000;
const FEATURED_CACHE_STALE_MS = 24 * 60 * 60 * 1000;
let featuredItems = [];
let featureOrder = [];
let featureIndex = 0;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const isVideo = item => String(item?.type || '').startsWith('video/');
const featureMediaUrl = item => item?.thumbnailUrl || item?.url || '';
const featureOriginalUrl = item => item?.url || featureMediaUrl(item);

function shuffledIndexes(length) {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }
  return indexes;
}

function currentFeature() {
  if (!featureOrder.length) return null;
  return featuredItems[featureOrder[featureIndex % featureOrder.length]] || null;
}

function applyFeatured(items) {
  featuredItems = Array.isArray(items) ? items : [];
  featureOrder = shuffledIndexes(featuredItems.length);
  featureIndex = 0;
  renderFeature();
}

function readFeaturedCache() {
  try {
    const raw = localStorage.getItem(FEATURED_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const savedAt = Number(cached?.savedAt) || 0;
    const items = Array.isArray(cached?.items) ? cached.items : null;
    if (!items || !savedAt) throw new Error('Invalid Featured cache');
    const age = Date.now() - savedAt;
    if (age > FEATURED_CACHE_STALE_MS) {
      localStorage.removeItem(FEATURED_CACHE_KEY);
      return null;
    }
    return { items, fresh: age <= FEATURED_CACHE_TTL_MS };
  } catch {
    try { localStorage.removeItem(FEATURED_CACHE_KEY); } catch {}
    return null;
  }
}

function writeFeaturedCache(items) {
  try {
    localStorage.setItem(FEATURED_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {}
}

function renderFeature() {
  const item = currentFeature();
  if (!item) {
    featureRoot.innerHTML = `<div class="welcome-feature-placeholder"><span>Featured</span><strong>暂时还没有精选作品</strong><p>站长标记 Featured 后，这里会随机展示其中一张。</p></div>`;
    return;
  }

  const mediaUrl = featureMediaUrl(item);
  const originalUrl = featureOriginalUrl(item);
  const title = item.name || item.id || '精选作品';
  const creator = item.creator?.name || item.creator?.handle || 'Creator';
  const media = isVideo(item)
    ? `<video src="${escapeHtml(mediaUrl)}" controls playsinline preload="none" aria-label="${escapeHtml(title)}"></video>`
    : `<img src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(title)}" decoding="async" fetchpriority="high">`;

  featureRoot.innerHTML = `
    <div class="welcome-feature-media">${media}</div>
    <div class="welcome-feature-shade" aria-hidden="true"></div>
    <div class="welcome-feature-controls">
      ${featuredItems.length > 1 ? '<button class="welcome-feature-control" type="button" data-next-feature>换一张</button>' : ''}
      <a class="welcome-feature-control" href="${escapeHtml(originalUrl)}" target="_blank" rel="noopener">查看原文件</a>
    </div>
    <div class="welcome-feature-meta">
      <small>Featured</small>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(creator)}</span>
    </div>`;

  featureRoot.querySelector('[data-next-feature]')?.addEventListener('click', () => {
    featureIndex += 1;
    if (featureIndex >= featureOrder.length) {
      featureOrder = shuffledIndexes(featuredItems.length);
      featureIndex = 0;
    }
    renderFeature();
  });
}

async function loadFeatured() {
  const cached = readFeaturedCache();
  if (cached) {
    applyFeatured(cached.items);
    if (cached.fresh) return;
  }

  try {
    const response = await fetch('/api/public/discover?limit=12&sort=featured', {
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to load Featured');
    const items = Array.isArray(body.files) ? body.files : [];
    writeFeaturedCache(items);
    applyFeatured(items);
  } catch {
    if (!cached) {
      featureRoot.innerHTML = `<div class="welcome-feature-placeholder"><span>Featured</span><strong>精选作品暂时无法读取</strong><p>上传和 Discover 入口仍可正常使用。</p></div>`;
    }
  }
}

async function reflectSignInState() {
  try {
    const response = await fetch('/api/user/me', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const body = await response.json();
    if (!body.authenticated) return;
    document.querySelectorAll('[data-account-action]').forEach(action => {
      action.href = '/account/?view=files';
      action.textContent = '我的工作室';
    });
    document.querySelectorAll('[data-upload-action]').forEach(action => {
      action.href = '/account/?view=files&upload=1';
    });
  } catch {}
}

Promise.allSettled([reflectSignInState(), loadFeatured()]);
