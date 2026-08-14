const root = document.querySelector('#gallery-app');
const owner = document.body.dataset.owner || '';
const album = document.body.dataset.album || '';
const albumName = document.body.dataset.name || album;
const creator = document.body.dataset.creator || owner;
const description = document.body.dataset.description || '';

const brand = `<a class="brand" href="/" aria-label="返回 CloudFlare ImgBed 首页"><svg viewBox="0 0 36 28" aria-hidden="true"><path d="M10.5 23.5h17a6.5 6.5 0 0 0 .5-13 10.5 10.5 0 0 0-20.2 3.6A4.8 4.8 0 0 0 10.5 23.5Z"/><path d="M12 15.5a6.5 6.5 0 0 1 12.3-2.9"/></svg><span>CloudFlare <strong>ImgBed</strong></span></a>`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function isVideo(url) {
  try { return new URL(url).pathname.toLowerCase().endsWith('.mp4'); } catch { return String(url).toLowerCase().includes('.mp4'); }
}

function itemMedia(item, cover = false) {
  const src = item.sources?.[0] || '';
  const label = cover ? albumName : (item.title || '图库项目');
  if (isVideo(src)) return `<video src="${escapeHtml(src)}" muted loop playsinline preload="metadata" aria-label="${escapeHtml(label)}"></video>${cover ? '' : '<span class="play" aria-hidden="true"></span><span class="type-label">MP4</span>'}`;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" ${cover ? '' : 'loading="lazy"'}>`;
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
  root.innerHTML = `<div class="gallery-shell"><header class="gallery-topbar">${brand}<span class="top-label">公开图库</span></header><div class="loading"><span class="loading-ring" aria-hidden="true"></span><p>正在读取图库…</p></div></div>`;
  try {
    const response = await fetch(`/api/public/gallery/${encodeURIComponent(owner)}/${encodeURIComponent(album)}`);
    if (!response.ok) throw new Error(response.status === 404 ? '这个图库不存在，或尚未公开。' : '图库暂时无法读取。');
    const pack = await response.json();
    const items = Array.isArray(pack.gallery) ? pack.gallery : [];
    const cover = items[0];
    document.title = `${albumName} · CloudFlare ImgBed`;
    root.innerHTML = `<div class="gallery-shell">
      <header class="gallery-topbar">${brand}<span class="top-label">公开图库</span></header>
      <main class="gallery-main">
        <section class="gallery-head">
          <div class="cover">${cover ? itemMedia(cover, true) : ''}</div>
          <div class="gallery-copy"><h1>${escapeHtml(albumName)}</h1><p class="creator">由 <strong>${escapeHtml(creator)}</strong> 创建</p>${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}<p class="item-count">${items.length} 个项目</p></div>
          <button class="copy-button" id="copyGallery" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 14.5 5-5m-7 8H6a4 4 0 0 1 0-8h3m6 0h3a4 4 0 0 1 0 8h-3"/></svg>复制图库链接</button>
        </section>
        ${items.length ? `<section class="gallery-grid" aria-label="图库内容">${items.map((item, index) => `<button class="gallery-item" type="button" data-index="${index}" aria-label="查看 ${escapeHtml(item.title)}"><div class="item-media">${itemMedia(item)}</div><p class="item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</p></button>`).join('')}</section>` : '<section class="empty"><h2>这个图库还是空的</h2><p>创作者加入内容后，会自动显示在这里。</p></section>'}
        <p class="gallery-note">公开图库中的内容可通过分享链接访问。</p>
      </main>
    </div>`;
    document.querySelector('#copyGallery').addEventListener('click', async event => {
      await navigator.clipboard.writeText(location.href);
      event.currentTarget.lastChild.textContent = ' 已复制';
      setTimeout(() => { event.currentTarget.lastChild.textContent = '复制图库链接'; }, 1800);
    });
    document.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => openViewer(items[Number(button.dataset.index)])));
    observeVideos();
  } catch (error) {
    root.innerHTML = `<div class="gallery-shell"><header class="gallery-topbar">${brand}<span class="top-label">公开图库</span></header><section class="gallery-error"><h1>无法打开图库</h1><p>${escapeHtml(error.message)}</p></section></div>`;
  }
}

init();
