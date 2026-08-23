const root = document.querySelector('#gallery-app');
const owner = document.body.dataset.owner || '';
const album = document.body.dataset.album || '';
const albumName = document.body.dataset.name || album;
const creator = document.body.dataset.creator || owner;
const description = document.body.dataset.description || '';

const brand = `<a class="brand" href="/" aria-label="返回 CloudFlare ImgBed 首页"><span class="brand-mark" aria-hidden="true">I</span><span>ImgBed <small>Community</small></span></a>`;
const themeButton = `<button class="theme-button" type="button" data-theme-toggle aria-label="切换主题"><svg class="theme-toggle-icon" viewBox="0 0 24 24" aria-hidden="true"><g class="theme-sun"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></g><g class="theme-moon"><path d="M20 15.2A8.3 8.3 0 0 1 8.8 4 8.4 8.4 0 1 0 20 15.2Z"/></g></svg></button>`;
const topbar = `${brand}<div class="top-actions"><a href="/">发现</a><span class="top-label">公开图库</span>${themeButton}</div>`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function mediaExtension(url) {
  try {
    const match = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || '';
  } catch {
    const match = String(url).toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
    return match?.[1] || '';
  }
}

function isVideo(url) {
  return ['mp4', 'webm'].includes(mediaExtension(url));
}

function videoLabel(url) {
  const extension = mediaExtension(url);
  return extension === 'webm' ? 'WEBM' : 'MP4';
}

function itemMedia(item, cover = false) {
  const original = item.sources?.[0] || '';
  const src = !isVideo(original) && item.thumbnail ? item.thumbnail : original;
  const label = cover ? albumName : (item.title || '图库项目');
  if (isVideo(original)) return `<video src="${escapeHtml(original)}" muted loop playsinline preload="metadata" aria-label="${escapeHtml(label)}"></video>${cover ? '' : `<span class="play" aria-hidden="true"></span><span class="type-label">${videoLabel(original)}</span>`}`;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" ${cover ? '' : 'loading="lazy"'} decoding="async">`;
}

function observeVideos() {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.play().catch(() => {}); else entry.target.pause();
  }), { threshold: .5 });
  document.querySelectorAll('.cover video, .gallery-item video').forEach(video => observer.observe(video));
}

function openViewer(item) {
  const src = item.sources?.[0] || '';
  const backdrop = document.createElement('div');
  backdrop.className = 'viewer-backdrop';
  backdrop.innerHTML = `<section class="viewer" role="dialog" aria-modal="true" aria-label="媒体预览"><header class="viewer-head"><h2>${escapeHtml(item.title)}</h2><button class="close-button" type="button" aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="viewer-media">${isVideo(src) ? `<video src="${escapeHtml(src)}" autoplay muted loop playsinline controls></video>` : `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}">`}</div></section>`;
  const close = () => backdrop.remove();
  backdrop.querySelector('.close-button').addEventListener('click', close);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', function onKey(event) { if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
  document.body.append(backdrop);
  backdrop.querySelector('.close-button').focus();
}

async function init() {
  root.innerHTML = `<div class="gallery-shell"><header class="gallery-topbar">${topbar}</header><div class="loading"><span class="loading-ring" aria-hidden="true"></span><p>正在读取图库…</p></div></div>`;
  try {
    const response = await fetch(`/api/public/gallery/${encodeURIComponent(owner)}/${encodeURIComponent(album)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404 ? '这个图库不存在，或尚未公开。' : '图库暂时无法读取。');
    const pack = await response.json();
    const items = Array.isArray(pack.gallery) ? pack.gallery : [];
    const cover = items[0];
    document.title = `${albumName} · CloudFlare ImgBed`;
    root.innerHTML = `<div class="gallery-shell">
      <header class="gallery-topbar">${topbar}</header>
      <main class="gallery-main">
        <section class="gallery-head">
          <div class="cover">${cover ? itemMedia(cover, true) : ''}</div>
          <div class="gallery-copy"><h1>${escapeHtml(albumName)}</h1><p class="creator">由 <strong>${escapeHtml(creator)}</strong> 创建</p>${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}<p class="item-count">${items.length} 个项目</p></div>
          <button class="copy-button" id="copyGallery" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 14.5 5-5m-7 8H6a4 4 0 0 1 0-8h3m6 0h3a4 4 0 0 1 0 8h-3"/></svg><span>复制图库链接</span></button>
        </section>
        ${items.length ? `<section class="gallery-grid" aria-label="图库内容">${items.map((item, index) => `<button class="gallery-item" type="button" data-index="${index}" aria-label="查看 ${escapeHtml(item.title)}"><div class="item-media">${itemMedia(item)}</div><p class="item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</p></button>`).join('')}</section>` : '<section class="empty"><h2>这个图库还是空的</h2><p>创作者加入内容后，会自动显示在这里。</p></section>'}
        <p class="gallery-note">公开图库中的内容可通过分享链接访问。</p>
      </main>
    </div>`;
    document.querySelector('#copyGallery').addEventListener('click', async event => {
      await navigator.clipboard.writeText(location.href);
      const label = event.currentTarget.querySelector('span');
      label.textContent = '已复制';
      setTimeout(() => { label.textContent = '复制图库链接'; }, 1800);
    });
    document.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => openViewer(items[Number(button.dataset.index)])));
    observeVideos();
  } catch (error) {
    root.innerHTML = `<div class="gallery-shell"><header class="gallery-topbar">${topbar}</header><section class="gallery-error"><h1>无法打开图库</h1><p>${escapeHtml(error.message)}</p></section></div>`;
  }
}

init();
