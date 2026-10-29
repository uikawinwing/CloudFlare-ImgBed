import { mountLegacyShell } from './shell.js';
import { getSiteConfig, publicFileUrl, setSitePageTitle } from '../site-config.js';
import { initializeWorkspaceWallpaper } from '../wallpaper-player.js';

const MEMBER_QUOTA_BYTES = 200 * 1024 * 1024;
const VIEW_CACHE_TTL = 30000;

const state = {
  user: null,
  files: [],
  filesNextCursor: null,
  filesUsedBytes: 0,
  filesRequestId: 0,
  albums: [],
  albumId: new URLSearchParams(location.search).get('album') || null,
  selected: new Set(),
  selectionMode: false,
  filter: 'all',
  fileQuery: '',
  fileSort: 'newest',
  view: ['albums', 'admin'].includes(new URLSearchParams(location.search).get('view')) ? new URLSearchParams(location.search).get('view') : 'files',
  adminSection: ['content', 'users', 'audit'].includes(new URLSearchParams(location.search).get('section')) ? new URLSearchParams(location.search).get('section') : 'content',
  adminStatus: 'all',
  adminQuery: '',
  adminFiles: [],
  users: [],
  audit: [],
};

const viewCache = {
  files: { loaded: false, dirty: false, loadedAt: 0, promise: null },
  albums: { loaded: false, dirty: false, loadedAt: 0, promise: null },
  admin: { loaded: false, dirty: false, loadedAt: 0, promise: null },
};
const scrollPositions = new Map();

const main = document.querySelector('#mainContent');
const dialogRoot = document.querySelector('#dialogRoot');
let activeDialogClose = null;
let wallpaperAdminScope = null;
let stopWorkspaceWallpaper = null;
let pendingWorkspaceWallpaper = null;
let wallpaperInitialization = 0;

const icons = {
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6.5 16 4-4 3 3 2-2 2.5 3"/><circle cx="16.5" cy="8.5" r="1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 14.5 5-5m-7 8H6a4 4 0 0 1 0-8h3m6 0h3a4 4 0 0 1 0 8h-3"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function encodeFilePath(id) {
  return String(id).split('/').map(encodeURIComponent).join('/');
}

function fileUrl(file) {
  return `/file/${encodeFilePath(file.id)}`;
}

function thumbnailUrl(file) {
  return file.thumbnail_url || `/thumb/${encodeFilePath(file.id)}`;
}

function previewUrl(file) {
  const isImage = String(file.file_type || '').startsWith('image/');
  return isImage ? thumbnailUrl(file) : fileUrl(file);
}

function isVideoFile(file) {
  return String(file?.file_type || '').startsWith('video/');
}

function isStaticCoverFile(file) {
  return String(file?.file_type || '').startsWith('image/') && file?.moderation_status === 'active';
}

function coverPosition(value) {
  const position = Number(value);
  return Number.isInteger(position) && position >= 0 && position <= 100 ? position : 50;
}

function selectedCoverFileId(album) {
  return album.coverFileId || album.cover_file_id || null;
}

function albumCoverItem(album) {
  const coverFileId = selectedCoverFileId(album);
  const items = album.items || [];
  if (coverFileId) {
    const selected = items.find(item => item.id === coverFileId && isStaticCoverFile(item));
    if (selected) return selected;
  }
  return items.find(item => item.moderation_status !== 'quarantined') || null;
}

function albumCoverPosition(album) {
  return {
    x: coverPosition(album.coverPositionX ?? album.cover_position_x),
    y: coverPosition(album.coverPositionY ?? album.cover_position_y),
  };
}

function videoTypeLabel(file) {
  return String(file?.file_type || '').toLowerCase() === 'video/webm' ? 'WEBM' : 'MP4';
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const serverErrorPage = contentType.includes('text/html') || (typeof body === 'string' && /<(?:!doctype|html)\b/i.test(body));
    const message = body && typeof body === 'object' ? body.error : (serverErrorPage ? '服务暂时不可用，请稍后重试。' : body);
    const error = new Error(message || '请求失败');
    error.status = response.status;
    throw error;
  }
  return body;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 2 : 1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(value) {
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  document.querySelector('#toastRegion').append(node);
  setTimeout(() => node.remove(), 3600);
}

function currentViewKey() {
  return state.view === 'admin' ? 'admin' : state.view;
}

function currentScrollKey() {
  return state.view === 'admin' ? `admin:${state.adminSection}` : state.view === 'albums' && state.albumId ? `album:${state.albumId}` : state.view;
}

function cacheEntry(key = currentViewKey()) {
  return viewCache[key] || viewCache.files;
}

function markViewDirty(...keys) {
  keys.forEach(key => {
    if (viewCache[key]) viewCache[key].dirty = true;
  });
}

function markViewFresh(key = currentViewKey()) {
  const entry = cacheEntry(key);
  entry.loaded = true;
  entry.dirty = false;
  entry.loadedAt = Date.now();
}

function rememberScroll() {
  scrollPositions.set(currentScrollKey(), window.scrollY || document.documentElement.scrollTop || 0);
}

function restoreScroll(key = currentScrollKey()) {
  const top = scrollPositions.get(key) || 0;
  requestAnimationFrame(() => window.scrollTo(0, top));
}

function workspaceTargetFromUrl(value = location.href) {
  const url = value instanceof URL ? value : new URL(value, location.href);
  if (url.origin !== location.origin || !/^\/account\/?$/.test(url.pathname)) return null;
  const view = ['files', 'albums', 'admin'].includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'files';
  const section = ['content', 'users', 'audit'].includes(url.searchParams.get('section')) ? url.searchParams.get('section') : 'content';
  return { view, section, albumId: view === 'albums' ? url.searchParams.get('album') : null };
}

function buildWorkspaceUrl(view = state.view, section = state.adminSection) {
  const url = new URL('/account/', location.origin);
  url.searchParams.set('view', view);
  if (view === 'admin') url.searchParams.set('section', section);
  if (view === 'albums' && state.albumId) url.searchParams.set('album', state.albumId);
  return url;
}

function renderCurrentView() {
  if (state.view === 'files') renderFiles();
  else if (state.view === 'albums') renderAlbums();
  else renderAdmin();
}

function syncNavigation() {
  const activeKey = state.view === 'admin' ? state.adminSection : 'files';
  document.querySelectorAll('[data-shell-key]').forEach(link => {
    const active = link.dataset.shellKey === activeKey;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  history.replaceState(null, '', buildWorkspaceUrl());
  const titles = { files: '我的文件', albums: '我的文件', admin: state.adminSection === 'users' ? '成员管理' : state.adminSection === 'audit' ? '操作记录' : '内容管理' };
  setSitePageTitle(titles[state.view] || titles.files);
}

function showLogin() {
  location.replace(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
}

async function loadFiles({ reset = true } = {}) {
  if (!reset && !state.filesNextCursor) return;
  const requestId = ++state.filesRequestId;
  const params = new URLSearchParams({ limit: '50', sort: state.fileSort, filter: state.filter });
  if (!reset) params.set('cursor', state.filesNextCursor);
  if (state.fileQuery.trim()) params.set('query', state.fileQuery.trim());
  let data;
  try {
    data = await api(`/api/user/files?${params}`);
  } catch (error) {
    if (requestId !== state.filesRequestId) return;
    throw error;
  }
  if (requestId !== state.filesRequestId) return;
  const files = Array.isArray(data.files) ? data.files : [];
  state.files = reset ? files : [...state.files, ...files.filter(file => !state.files.some(existing => existing.id === file.id))];
  state.filesNextCursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
  state.filesUsedBytes = Number(data.usedBytes) || 0;
  if (reset) state.selected = new Set([...state.selected].filter(id => state.files.some(file => file.id === id)));
  markViewFresh('files');
}

async function loadAlbums(includeItems = true) {
  const data = await api('/api/user/albums');
  const albums = Array.isArray(data.albums) ? data.albums : [];
  if (!includeItems) {
    state.albums = albums;
    return;
  }
  state.albums = await Promise.all(albums.map(async album => {
    try {
      const detail = await api(`/api/user/albums/${encodeURIComponent(album.id)}`);
      return { ...album, ...detail.album, items: detail.items || [] };
    } catch {
      return { ...album, items: [] };
    }
  }));
  markViewFresh('albums');
}

function fileCard(file) {
  const isVideo = isVideoFile(file);
  const selected = state.selected.has(file.id);
  const src = fileUrl(file);
  const preview = previewUrl(file);
  const mediaLabel = file.file_name || file.id;
  return `<article class="media-card${selected ? ' selected' : ''}" data-file-id="${escapeHtml(file.id)}">
    ${state.selectionMode ? `<input class="media-select" type="checkbox" aria-label="选择 ${escapeHtml(mediaLabel)}" ${selected ? 'checked' : ''}>` : ''}
    <button class="media-frame" type="button" data-open-media ${isVideo ? 'data-video-frame' : ''} aria-label="${state.selectionMode ? '选择' : '打开'} ${escapeHtml(mediaLabel)}">
      ${isVideo ? `<video src="${src}" muted loop playsinline preload="metadata"></video><span class="media-type">${videoTypeLabel(file)}</span>` : `<img src="${escapeHtml(preview)}" alt="${escapeHtml(mediaLabel)}" loading="lazy" decoding="async">`}
    </button>
  </article>`;
}

function visibleFiles() {
  return state.files;
}

function workspaceHeader() {
  const used = state.filesUsedBytes;
  const quota = state.user.role === 'owner' ? null : MEMBER_QUOTA_BYTES;
  return `<header class="page-head">
    <div class="page-title"><h1>我的文件</h1><p>浏览全部文件，或打开图库整理、编辑和分享。</p></div>
    <div class="head-actions"><div class="quota" aria-label="个人容量">
      <div class="quota-copy"><span>${quota ? `已使用 ${formatBytes(used)} / 200 MB` : `已使用 ${formatBytes(used)}`}</span><span>${quota ? `${Math.min(100, Math.round(used / quota * 100))}%` : '所有者不限额'}</span></div>
      <div class="quota-track"><div class="quota-bar" style="width:${quota ? Math.min(100, used / quota * 100) : 0}%"></div></div>
    </div></div>
  </header>
  <nav class="workspace-tabs" aria-label="文件与图库">
    <a href="/account/?view=files"${state.view === 'files' ? ' aria-current="page"' : ''}>${icons.image}全部文件</a>
    <a href="/account/?view=albums"${state.view === 'albums' ? ' aria-current="page"' : ''}>${icons.folder}我的图库 <span>${state.albums.length}</span></a>
  </nav>`;
}

function renderFiles({ focusSearch = false } = {}) {
  syncNavigation();
  const filtered = visibleFiles();
  main.innerHTML = `<section class="page-section">
    ${workspaceHeader()}
    <div class="toolbar file-toolbar">
      <label class="search-control"><span class="sr-only">搜索文件</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><input id="fileSearch" type="search" value="${escapeHtml(state.fileQuery)}" placeholder="搜索文件名"></label>
      <div class="segmented" aria-label="文件类型">
        <button type="button" data-filter="all" class="${state.filter === 'all' ? 'active' : ''}">全部</button>
        <button type="button" data-filter="image" class="${state.filter === 'image' ? 'active' : ''}">图片</button>
        <button type="button" data-filter="video" class="${state.filter === 'video' ? 'active' : ''}">视频</button>
      </div>
      <select class="select-control" id="fileSort" aria-label="排序"><option value="newest" ${state.fileSort === 'newest' ? 'selected' : ''}>最近上传</option><option value="oldest" ${state.fileSort === 'oldest' ? 'selected' : ''}>最早上传</option><option value="name" ${state.fileSort === 'name' ? 'selected' : ''}>按名称</option></select>
      <button class="button" type="button" data-integrated-upload-trigger>${icons.upload}上传文件</button>
      <button class="button${state.selectionMode ? ' active' : ''}" id="toggleSelectionMode" type="button">${state.selectionMode ? '完成选择' : '批量选择'}</button>
    </div>
    ${state.selectionMode && state.selected.size ? `<div class="selection-bar">
      <div class="selection-copy"><strong>已选择 ${state.selected.size} 项</strong><button class="button ghost" id="clearSelection" type="button">取消选择</button></div>
      <div class="selection-actions"><button class="button" id="addToAlbum" type="button">${icons.folder}加入图库</button><button class="button danger" id="deleteSelected" type="button">${icons.trash}永久删除</button></div>
    </div>` : ''}
    ${filtered.length ? `<div class="media-grid">${filtered.map(fileCard).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${icons.image}</span><h2>${state.fileQuery || state.filter !== 'all' ? '没有符合条件的文件' : '还没有上传文件'}</h2><p>${state.fileQuery || state.filter !== 'all' ? '试试更换筛选条件或搜索词。' : '使用上方“上传文件”，或直接拖拽 / Ctrl+V 粘贴 JPG、PNG、GIF、WebP、AVIF、MP4 或 WebM。'}</p></div>`}
    ${state.filesNextCursor ? `<div class="load-more"><button class="button" id="loadMoreFiles" type="button">加载更多</button></div>` : ''}
  </section>`;
  bindFileEvents();
  observeVideos();
  if (focusSearch) {
    const search = document.querySelector('#fileSearch');
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  }
}

function albumRow(album) {
  const items = album.items || [];
  const cover = albumCoverItem(album);
  const focus = albumCoverPosition(album);
  const useSavedFocus = cover && selectedCoverFileId(album) === cover.id && isStaticCoverFile(cover);
  const coverMedia = !cover ? `<span class="empty-icon">${icons.image}</span>` : isVideoFile(cover)
    ? `<video src="${fileUrl(cover)}" muted loop playsinline preload="metadata"></video>`
    : `<img src="${escapeHtml(previewUrl(cover))}" alt="${escapeHtml(cover.file_name || album.name)}" loading="lazy" decoding="async"${useSavedFocus ? ` style="object-position:${focus.x}% ${focus.y}%"` : ''}>`;
  const canShare = Boolean(state.user.publicHandle);
  const canShareCharInfo = canShare && Boolean(album.charInfoCharacterName);
  const shareUrl = canShare ? `${location.origin}/gallery/${encodeURIComponent(state.user.publicHandle)}/${encodeURIComponent(album.slug)}` : '';
  const feedUrl = canShareCharInfo ? `${location.origin}/api/public/charinfo/${encodeURIComponent(album.id)}` : '';
  return `<article class="album-row" data-album-id="${escapeHtml(album.id)}">
    <a class="album-cover" href="/account/?view=albums&album=${encodeURIComponent(album.id)}" aria-label="打开图库 ${escapeHtml(album.name)}">${coverMedia}</a>
    <div class="album-body">
      <h2><a href="/account/?view=albums&album=${encodeURIComponent(album.id)}">${escapeHtml(album.name)}</a></h2>
      <div class="album-meta"><span>${items.length} 个项目</span><span>最近更新：${formatDate(album.updated_at)}</span></div>
      <div class="album-card-actions"><button class="button" type="button" data-manage-album>打开图库</button><button class="button ghost" type="button" data-edit-album>编辑信息</button></div>
      <details class="album-actions-menu">
        <summary>分享与更多</summary>
        <div class="album-actions">
          <p class="album-visibility">${state.user.publicHandle ? `会显示在发现页 · 可通过分享链接访问${album.charInfoCharacterName ? ` · CharInfo：${escapeHtml(album.charInfoCharacterName)}` : ' · CharInfo 未配置角色全名'}` : '设置公开名称后，图库会显示在发现页并可分享'}</p>
          ${canShare ? `<button class="button" type="button" data-copy="${escapeHtml(shareUrl)}">${icons.link}复制分享链接</button>` : ''}
          ${canShareCharInfo ? `<button class="button" type="button" data-copy="${escapeHtml(feedUrl)}">${icons.link}复制 CharInfo 链接</button>` : ''}
          ${album.charInfoCharacterName ? `<a class="button primary" href="/charinfo/?album=${encodeURIComponent(album.id)}">打开 Creator</a>` : '<button class="button primary" type="button" data-edit-album>配置 CharInfo</button>'}
          <button class="button danger" type="button" data-delete-album>删除图库</button>
        </div>
      </details>
    </div>
  </article>`;
}

function renderAlbums() {
  syncNavigation();
  const album = state.albums.find(item => item.id === state.albumId);
  main.innerHTML = `<section class="page-section">
    ${workspaceHeader()}
    ${album ? albumDetailMarkup(album) : `<div class="workspace-section-head">
      <h2>我的图库</h2>
      <button class="button primary" id="createAlbum" type="button">${icons.plus}新建图库</button>
    </div>
    ${state.user.publicHandle ? '' : '<div class="notice-panel"><div><strong>准备公开图库？</strong><p>先设置一个用于分享链接的公开名称。它会绑定当前 Discord 账号。</p></div><button class="button" id="setPublicHandle" type="button">设置公开名称</button></div>'}
    ${state.albums.length ? `<div class="album-list">${state.albums.map(albumRow).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${icons.folder}</span><h2>还没有图库</h2><p>创建图库后，可以直接选择已有文件加入。</p><button class="button primary" id="emptyCreateAlbum" type="button">新建第一个图库</button></div>`}`}
  </section>`;
  bindAlbumEvents();
  if (album) bindAlbumItemEvents(album);
  observeVideos();
}

async function loadAdminData() {
  const [files, audit, users] = await Promise.all([
    api('/api/moderation/files'),
    api('/api/moderation/audit'),
    state.user.role === 'owner' ? api('/api/admin/users') : Promise.resolve({ users: [] }),
  ]);
  state.adminFiles = files.files || [];
  state.audit = audit.audit || [];
  state.users = users.users || [];
  markViewFresh('admin');
}

function moderationRow(file) {
  const isVideo = isVideoFile(file);
  const canRestore = ['admin', 'owner'].includes(state.user.role);
  const status = file.moderation_status === 'quarantined' ? '已撤下' : file.moderation_status === 'deleting' ? '删除处理中' : '正常';
  return `<article class="moderation-row" data-file-id="${escapeHtml(file.id)}">
    <button class="moderation-thumb" type="button" data-preview-admin aria-label="预览 ${escapeHtml(file.file_name || file.id)}">${isVideo ? `<video src="${fileUrl(file)}" muted playsinline preload="metadata"></video>` : `<img src="${fileUrl(file)}" alt="" loading="lazy">`}</button>
    <div class="moderation-copy file-column"><strong>${escapeHtml(file.file_name || file.id)}</strong><span>${escapeHtml(file.id)}</span></div>
    <div class="moderation-copy owner-column"><strong>${escapeHtml(file.owner_name || '未绑定账号')}</strong><span>${escapeHtml(file.owner_id || '旧文件')}</span></div>
    <div class="moderation-copy type-column"><strong>${isVideo ? `视频 / ${videoTypeLabel(file)}` : '图片'}</strong><span>${formatBytes(file.file_size_bytes)}</span></div>
    <time class="moderation-time">${formatDate(file.timestamp)}</time>
    <span class="status-chip ${file.moderation_status === 'active' ? 'success' : 'danger'}">${status}</span>
    <div class="moderation-actions">${file.moderation_status === 'active' ? '<button class="button" type="button" data-quarantine>先撤下</button>' : ''}${file.moderation_status === 'quarantined' && canRestore ? '<button class="button" type="button" data-restore>恢复</button><button class="button danger" type="button" data-hard-delete>永久删除</button>' : ''}</div>
  </article>`;
}

function userRow(user) {
  if (user.discord_id === state.user.id) return `<article class="user-row"><div class="moderation-copy"><strong>${escapeHtml(user.username)}</strong><span>${escapeHtml(user.discord_id)} · 所有者账号</span></div><span class="status-chip">所有者权限固定</span></article>`;
  return `<article class="user-row" data-user-id="${escapeHtml(user.discord_id)}"><div class="moderation-copy"><strong>${escapeHtml(user.username)}</strong><span>${escapeHtml(user.discord_id)} · ${formatBytes(user.used_bytes)}</span></div><select class="select-control" data-user-role aria-label="${escapeHtml(user.username)} 的权限"><option value="member" ${user.role === 'member' ? 'selected' : ''}>成员</option><option value="manager" ${user.role === 'manager' ? 'selected' : ''}>协管</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option></select><select class="select-control" data-user-status aria-label="${escapeHtml(user.username)} 的状态"><option value="active" ${user.status === 'active' ? 'selected' : ''}>正常</option><option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>暂停上传</option></select><button class="button" type="button" data-save-user>保存</button></article>`;
}

function auditRow(entry) {
  return `<article class="audit-row"><div><strong>${escapeHtml(entry.action)}</strong><span>${escapeHtml(entry.actor_name || entry.actor_id)} → ${escapeHtml(entry.target_id)}</span></div><p>${escapeHtml(entry.reason || '未填写原因')}</p><time>${formatDate(entry.created_at)}</time></article>`;
}

function renderAdmin() {
  syncNavigation();
  let body = '';
  if (state.adminSection === 'content') {
    const query = state.adminQuery.trim().toLocaleLowerCase('zh-CN');
    const files = state.adminFiles.filter(file => (state.adminStatus === 'all' || file.moderation_status === state.adminStatus) && (!query || `${file.file_name || ''} ${file.owner_name || ''} ${file.id || ''}`.toLocaleLowerCase('zh-CN').includes(query)));
    body = `<div class="admin-tabs segmented"><button type="button" data-admin-status="all" class="${state.adminStatus === 'all' ? 'active' : ''}">全部内容</button><button type="button" data-admin-status="quarantined" class="${state.adminStatus === 'quarantined' ? 'active' : ''}">已撤下</button><button type="button" data-admin-section="audit">操作记录</button></div>
      <div class="toolbar admin-toolbar"><label class="search-control"><span class="sr-only">搜索文件或所有者</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><input id="adminSearch" type="search" value="${escapeHtml(state.adminQuery)}" placeholder="搜索文件名、编号或所有者"></label></div>
      ${files.length ? `<div class="moderation-table"><div class="moderation-head"><span></span><span>文件</span><span>所有者</span><span>类型 / 大小</span><span>上传时间</span><span>状态</span><span>操作</span></div><div class="moderation-list">${files.map(moderationRow).join('')}</div></div>` : '<div class="empty-state"><h2>没有符合条件的内容</h2><p>可以更换筛选条件或搜索词。</p></div>'}`;
  }
  if (state.adminSection === 'users') body = `<div class="admin-tools"><div><strong>旧文件归属</strong><small>将尚未关联账号的旧文件纳入成员文件列表。</small></div><button class="button" id="migrateLegacy" type="button">整理未归属的旧文件</button></div>${state.users.length ? `<div class="user-list">${state.users.map(userRow).join('')}</div>` : '<div class="empty-state"><h2>还没有成员记录</h2></div>'}`;
  if (state.adminSection === 'audit') body = `<div class="admin-tabs segmented"><button type="button" data-admin-section="content">全部内容</button><button type="button" data-admin-section="content" data-set-status="quarantined">已撤下</button><button type="button" class="active">操作记录</button></div>${state.audit.length ? `<div class="audit-list">${state.audit.map(auditRow).join('')}</div>` : '<div class="empty-state"><h2>还没有管理操作</h2><p>撤下、恢复、删除和权限变更会显示在这里。</p></div>'}`;
  const title = state.adminSection === 'users' ? '成员管理' : state.adminSection === 'audit' ? '操作记录' : '内容管理';
  const description = state.adminSection === 'users' ? '设置成员权限、暂停上传，并查看个人容量。' : state.adminSection === 'audit' ? '查看管理操作、处理原因和发生时间。' : '查看全站内容、处理问题文件并保留操作记录。';
  main.innerHTML = `<section class="page-section"><header class="page-head"><div class="page-title"><h1>${title}</h1><p>${description}</p></div>${state.adminSection === 'content' ? '<div class="role-hint">协管可先撤下；管理员和站点所有者可恢复或永久删除。</div>' : ''}</header>${body}</section>`;
  bindAdminEvents();
}

function askReason(title, explanation, confirmLabel, action, danger = false) {
  const content = `<form id="reasonForm"><div class="dialog-head"><h2>${escapeHtml(title)}</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div><div class="dialog-body"><p style="margin-top:0;color:var(--muted);line-height:1.65">${escapeHtml(explanation)}</p><div class="field"><label for="actionReason">处理原因</label><textarea id="actionReason" name="reason" minlength="3" maxlength="500" required></textarea><small>原因会保存在操作记录中。</small></div></div><div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button ${danger ? 'danger' : 'primary'}" type="submit">${escapeHtml(confirmLabel)}</button></div></form>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#reasonForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try { await action(event.currentTarget.reason.value.trim()); close(); await loadAdminData(); renderAdmin(); toast('处理完成。'); }
    catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
}

function bindAdminEvents() {
  document.querySelectorAll('[data-admin-section]').forEach(button => button.addEventListener('click', () => {
    rememberScroll();
    state.adminSection = button.dataset.adminSection;
    if (button.dataset.setStatus) state.adminStatus = button.dataset.setStatus;
    renderAdmin();
    restoreScroll();
  }));
  document.querySelectorAll('[data-admin-status]').forEach(button => button.addEventListener('click', () => { state.adminStatus = button.dataset.adminStatus; renderAdmin(); }));
  document.querySelector('#adminSearch')?.addEventListener('change', event => { state.adminQuery = event.target.value; renderAdmin(); });
  document.querySelector('#adminSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); state.adminQuery = event.currentTarget.value; renderAdmin(); } });
  document.querySelectorAll('.moderation-row').forEach(row => {
    const fileId = row.dataset.fileId;
    row.querySelector('[data-preview-admin]')?.addEventListener('click', () => previewFile(state.adminFiles.find(file => file.id === fileId)));
    row.querySelector('[data-quarantine]')?.addEventListener('click', () => askReason('先撤下这个文件？', '直链和公开图库会立即停止显示，等待管理员复核。', '确认撤下', reason => api(`/api/moderation/quarantine/${encodeFilePath(fileId)}`, { method: 'POST', body: JSON.stringify({ reason }) }), true));
    row.querySelector('[data-restore]')?.addEventListener('click', () => askReason('恢复这个文件？', '文件直链会重新可用。', '确认恢复', reason => api(`/api/moderation/restore/${encodeFilePath(fileId)}`, { method: 'POST', body: JSON.stringify({ reason }) })));
    row.querySelector('[data-hard-delete]')?.addEventListener('click', () => askReason('永久删除这个文件？', '文件、上游存储消息和所有图库引用都会永久删除，无法恢复。', '永久删除', reason => api(`/api/moderation/delete/${encodeFilePath(fileId)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }), true));
  });
  document.querySelectorAll('.user-row[data-user-id]').forEach(row => row.querySelector('[data-save-user]').addEventListener('click', () => {
    const username = row.querySelector('.moderation-copy strong').textContent;
    askReason(`保存 ${username} 的权限？`, '新权限会在下一次敏感操作时生效。暂停后，现有登录也无法继续上传或管理文件。', '保存更改', reason => api(`/api/admin/users/${encodeURIComponent(row.dataset.userId)}`, { method: 'PATCH', body: JSON.stringify({ role: row.querySelector('[data-user-role]').value, status: row.querySelector('[data-user-status]').value, reason }) }));
  }));
  document.querySelector('#migrateLegacy')?.addEventListener('click', migrateLegacyFiles);
}

async function migrateLegacyFiles() {
  const button = document.querySelector('#migrateLegacy');
  button.disabled = true;
  let cursor = null;
  let migrated = 0;
  try {
    do {
      const result = await api('/api/admin/migrate-kv-files', { method: 'POST', body: JSON.stringify({ cursor, limit: 50 }) });
      migrated += result.migrated;
      cursor = result.cursor;
    } while (cursor);
    markViewDirty('admin');
    toast(`未归属旧文件整理完成：${migrated} 条。`);
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
}

function observeVideos() {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) video.play().catch(() => {}); else video.pause();
  }), { threshold: .45 });
  document.querySelectorAll('.media-frame video, .album-cover video').forEach(video => {
    video.addEventListener('loadedmetadata', syncFrameRatio, { once: true });
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) syncFrameRatio();
    observer.observe(video);

    function syncFrameRatio() {
      const { videoWidth, videoHeight } = video;
      const frame = video.closest('.media-frame');
      if (frame && videoWidth > 0 && videoHeight > 0) frame.style.aspectRatio = `${videoWidth} / ${videoHeight}`;
    }
  });
}

function openDialog(content, { closeable = true, wide = false, className = '', label = '对话框' } = {}) {
  activeDialogClose?.();
  const previouslyFocused = document.activeElement;
  dialogRoot.innerHTML = `<div class="dialog-backdrop" role="presentation"><section class="dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}" tabindex="-1">${content}</section></div>`;
  const backdrop = dialogRoot.firstElementChild;
  const dialog = dialogRoot.querySelector('.dialog');
  dialog?.focus();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', closeOnEscape);
    dialogRoot.innerHTML = '';
    if (activeDialogClose === close) activeDialogClose = null;
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
  };
  const closeOnEscape = event => {
    if (event.key === 'Escape' && closeable) {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(node => node.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    }
  };
  if (closeable) {
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    dialogRoot.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', close));
  }
  document.addEventListener('keydown', closeOnEscape);
  activeDialogClose = close;
  return close;
}

async function ensurePublicHandle() {
  if (state.user.publicHandle) return;
  const content = `<form id="handleForm">
    <div class="dialog-head"><h2>设置公开名称</h2></div>
    <div class="dialog-body">
      <p style="margin-top:0;color:var(--muted);line-height:1.65">这个名称会出现在公开图库链接中，并绑定当前 Discord 账号。</p>
      <div class="field"><label for="publicHandle">公开名称</label><input id="publicHandle" name="publicHandle" autocomplete="off" minlength="3" maxlength="32" pattern="[a-z0-9][a-z0-9\\-]{2,31}" required><small>使用 3–32 位小写英文字母、数字或短横线。</small><small class="field-error" id="handleError"></small></div>
    </div>
    <div class="dialog-actions"><button class="button primary" type="submit">保存并继续</button></div>
  </form>`;
  const close = openDialog(content, { closeable: false });
  await new Promise(resolve => {
    dialogRoot.querySelector('#handleForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const errorNode = form.querySelector('#handleError');
      button.disabled = true;
      errorNode.textContent = '';
      try {
        const data = await api('/api/user/handle', { method: 'PUT', body: JSON.stringify({ publicHandle: form.publicHandle.value }) });
        state.user.publicHandle = data.publicHandle;
        close();
        resolve();
      } catch (error) {
        errorNode.textContent = error.status === 409 ? '这个名称已经有人使用。' : '名称格式不正确，请检查后重试。';
      } finally {
        button.disabled = false;
      }
    });
  });
}

function openFileViewer(file) {
  if (!file) return;
  const isVideo = isVideoFile(file);
  openDialog(`<div class="media-viewer-head"><div><h2>${escapeHtml(file.file_name || file.id)}</h2><p>${formatBytes(file.file_size_bytes)}${formatDate(file.timestamp) ? ` · ${formatDate(file.timestamp)}` : ''}</p></div><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="file-preview-media" data-media-viewer-stage>${isVideo ? `<video src="${fileUrl(file)}" autoplay muted loop playsinline controls></video>` : `<img src="${fileUrl(file)}" alt="${escapeHtml(file.file_name || '')}">`}</div>
    <div class="media-viewer-details"><p>加入人物图库后，可通过图库在发现页浏览。</p><div class="media-viewer-actions"><button class="button" type="button" id="copyViewerFile">${icons.link}复制链接</button><a class="button" href="${escapeHtml(fileUrl(file))}" target="_blank" rel="noopener">${icons.external}打开原始尺寸</a></div></div>`, { className: 'media-viewer-dialog', label: `查看 ${file.file_name || file.id}` });
  dialogRoot.querySelector('#copyViewerFile')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicFileUrl(file.id, await getSiteConfig()));
      toast('资源链接已复制。');
    } catch {
      toast('复制失败，请直接打开原文件后复制地址。', 'error');
    }
  });
}

function previewFile(file) {
  openFileViewer(file);
}

function bindFileEvents() {
  const reload = async (focusSearch = false) => {
    try {
      await loadFiles();
      renderFiles({ focusSearch });
    } catch (error) {
      toast(error.message || '无法读取文件。', 'error');
    }
  };
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', async () => { state.filter = button.dataset.filter; await reload(); }));
  document.querySelector('#fileSearch')?.addEventListener('change', async event => { state.fileQuery = event.target.value; await reload(); });
  document.querySelector('#fileSearch')?.addEventListener('keydown', async event => { if (event.key === 'Enter') { event.preventDefault(); state.fileQuery = event.currentTarget.value; await reload(true); } });
  document.querySelector('#fileSort')?.addEventListener('change', async event => { state.fileSort = event.target.value; await reload(); });
  document.querySelector('#loadMoreFiles')?.addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      await loadFiles({ reset: false });
      renderFiles();
    } catch (error) {
      event.currentTarget.disabled = false;
      toast(error.message || '无法读取更多文件。', 'error');
    }
  });
  document.querySelector('#toggleSelectionMode')?.addEventListener('click', () => {
    state.selectionMode = !state.selectionMode;
    if (!state.selectionMode) state.selected.clear();
    renderFiles();
  });
  document.querySelector('#clearSelection')?.addEventListener('click', () => { state.selected.clear(); renderFiles(); });
  document.querySelector('#addToAlbum')?.addEventListener('click', addSelectedToAlbum);
  document.querySelector('#deleteSelected')?.addEventListener('click', confirmDeleteSelected);
  document.querySelectorAll('.media-card').forEach(card => {
    const id = card.dataset.fileId;
    card.querySelector('.media-select')?.addEventListener('change', event => {
      if (event.target.checked) state.selected.add(id); else state.selected.delete(id);
      renderFiles();
    });
    card.querySelector('[data-open-media]')?.addEventListener('click', () => {
      if (state.selectionMode) {
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        renderFiles();
        return;
      }
      openFileViewer(state.files.find(file => file.id === id));
    });
  });
}

async function addSelectedToAlbum() {
  if (!state.albums.length) await loadAlbums(false);
  if (!state.albums.length) {
    albumDialog(null, { onCreated: addSelectedFilesToAlbum });
    return;
  }
  const content = `<div class="dialog-head"><h2>加入图库</h2><div><button class="icon-button" id="createAlbumForSelection" type="button" aria-label="新建图库" title="新建图库">${icons.plus}</button><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div></div>
    <div class="dialog-body"><div class="album-picker">${state.albums.map((album, index) => `<label><input type="radio" name="album" value="${escapeHtml(album.id)}" ${index === 0 ? 'checked' : ''}><span>${escapeHtml(album.name)}</span></label>`).join('')}</div></div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button primary" type="button" id="confirmAddToAlbum">加入图库</button></div>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#createAlbumForSelection').addEventListener('click', () => {
    close();
    albumDialog(null, { onCreated: addSelectedFilesToAlbum });
  });
  dialogRoot.querySelector('#confirmAddToAlbum').addEventListener('click', async event => {
    const albumId = dialogRoot.querySelector('input[name="album"]:checked')?.value;
    if (!albumId) return;
    event.currentTarget.disabled = true;
    const button = event.currentTarget;
    try {
      const added = await addSelectedFilesToAlbum(albumId);
      close();
      if (state.view === 'files') renderFiles();
      toast(`已将 ${added} 个文件加入图库。`);
    } catch (error) {
      button.disabled = false;
      toast(error.message || '无法加入图库，请重试。', 'error');
    }
  });
}

async function addSelectedFilesToAlbum(albumId) {
  const detail = await api(`/api/user/albums/${encodeURIComponent(albumId)}`);
  const existingItems = detail.items || [];
  const included = new Set(existingItems.map(item => item.id));
  let position = Math.max(-1, ...existingItems.map(item => Number(item.position) || 0)) + 1;
  let added = 0;
  for (const fileId of state.selected) {
    if (included.has(fileId)) continue;
    try {
      await api(`/api/user/albums/${encodeURIComponent(albumId)}/items`, { method: 'POST', body: JSON.stringify({ fileId, position }) });
      position += 1;
      added += 1;
    } catch (error) {
      toast(error.message, 'error');
    }
  }
  state.selected.clear();
  if (added) markViewDirty('albums');
  return added;
}

function confirmDeleteSelected() {
  const selectedFiles = state.files.filter(file => state.selected.has(file.id));
  const content = `<div class="dialog-head"><h2>永久删除文件？</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body"><p style="margin-top:0;color:var(--muted);line-height:1.65">将永久删除 ${selectedFiles.length} 个文件。它们会从所有图库和存储中移除，已保存的链接也会失效。此操作无法恢复。</p><ul>${selectedFiles.slice(0, 8).map(file => `<li>${escapeHtml(file.file_name || file.id)}</li>`).join('')}</ul>${selectedFiles.length > 8 ? `<p>以及另外 ${selectedFiles.length - 8} 个文件</p>` : ''}</div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button danger" type="button" id="confirmDelete">确认永久删除</button></div>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#confirmDelete').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    let deleted = 0;
    for (const file of selectedFiles) {
      try {
        await api(`/api/user/files/${encodeFilePath(file.id)}`, { method: 'DELETE' });
        deleted += 1;
      } catch (error) {
        toast(`${file.file_name || file.id}：${error.message}`, 'error');
      }
    }
    close();
    state.selected.clear();
    await loadFiles();
    markViewDirty('albums');
    renderFiles();
    toast(`已永久删除 ${deleted} 个文件。`);
  });
}

function albumDialog(album = null, { onCreated = null } = {}) {
  const editing = Boolean(album);
  const originView = state.view;
  const originAlbumId = state.albumId;
  const content = `<form id="albumForm">
    <div class="dialog-head"><h2>${editing ? '编辑图库' : '新建图库'}</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body">
      <div class="field"><label for="albumName">图库名称</label><input id="albumName" name="name" maxlength="80" value="${escapeHtml(album?.name || '')}" required></div>
      <div class="field"><label for="albumSlug">分享链接名称</label><input id="albumSlug" name="slug" maxlength="80" value="${escapeHtml(album?.slug || '')}" pattern="[a-z0-9][a-z0-9\\-]*"><small>用于分享链接，只能使用小写英文字母、数字和短横线；留空会根据图库名称生成。</small></div>
      <div class="field"><label for="albumDescription">说明</label><textarea id="albumDescription" name="description" maxlength="200">${escapeHtml(album?.description || '')}</textarea></div>
      <div class="field"><label for="albumCharInfoCharacterName">CharInfo 角色全名（可选）</label><input id="albumCharInfoCharacterName" name="charInfoCharacterName" maxlength="80" value="${escapeHtml(album?.charInfoCharacterName || '')}"><small>需要生成 CharInfo 链接时填写角色完整姓名；不要填写 Discord 用户名或角色简称。</small></div>
      <p>设置公开名称后，图库会显示在发现页；每个图库只展示一张封面。</p>
      <small class="field-error" id="albumError"></small>
    </div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button primary" type="submit">${editing ? '保存更改' : '创建图库'}</button></div>
  </form>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#albumForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = { name: form.name.value.trim(), slug: form.slug.value.trim() || undefined, description: form.description.value.trim(), charInfoCharacterName: form.charInfoCharacterName.value.trim() };
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const savedAlbum = editing
        ? await api(`/api/user/albums/${encodeURIComponent(album.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/api/user/albums', { method: 'POST', body: JSON.stringify(payload) });
      close();
      await loadAlbums(true);
      if (!editing && onCreated) {
        const added = await onCreated(savedAlbum.id);
        await loadAlbums(true);
        if (state.view === 'files') renderFiles();
        toast(`图库已创建，并已将 ${added} 个文件加入图库。`);
      } else {
        if (state.view === 'albums') {
          if (!editing && originView === 'albums' && state.albumId === originAlbumId) state.albumId = savedAlbum.id;
          renderAlbums();
        }
        toast(editing ? '图库已更新。' : '图库已创建。');
      }
    } catch (error) {
      form.querySelector('#albumError').textContent = error.status === 409 ? '这个公开名称已经被使用。' : error.message;
      form.querySelector('button[type="submit"]').disabled = false;
    }
  });
}

function bindAlbumEvents() {
  document.querySelector('#createAlbum')?.addEventListener('click', () => albumDialog());
  document.querySelector('#emptyCreateAlbum')?.addEventListener('click', () => albumDialog());
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      toast('链接已复制。');
    } catch {
      toast('复制失败，请重试。', 'error');
    }
  }));
  document.querySelector('#setPublicHandle')?.addEventListener('click', async () => { await ensurePublicHandle(); if (state.view === 'albums') renderAlbums(); });
  document.querySelectorAll('.album-row, .album-detail').forEach(row => {
    const album = state.albums.find(item => item.id === row.dataset.albumId);
    row.querySelector('[data-manage-album]')?.addEventListener('click', () => manageAlbumItems(album));
    row.querySelectorAll('[data-edit-album]').forEach(button => button.addEventListener('click', () => albumDialog(album)));
    row.querySelector('[data-delete-album]')?.addEventListener('click', () => confirmDeleteAlbum(album));
  });
}

function manageAlbumItems(album) {
  if (!album) return;
  navigateWorkspace({ view: 'albums', albumId: album.id });
}

function albumDetailMarkup(album) {
  const items = [...(album.items || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const coverFileId = selectedCoverFileId(album);
  const rows = items.map((item, index) => `<article class="album-item-row" data-file-id="${escapeHtml(item.id)}">
    <button class="album-item-thumb" type="button" data-preview-item aria-label="查看 ${escapeHtml(item.file_name || item.id)}">${isVideoFile(item) ? `<video src="${fileUrl(item)}" muted playsinline preload="metadata"></video>` : `<img src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(item.file_name || item.id)}" loading="lazy" decoding="async">`}</button>
    <div class="album-item-copy"><strong>${escapeHtml(item.file_name || item.id)}</strong><span>${formatBytes(item.file_size_bytes)}</span></div>
    <div class="album-item-actions">${coverFileId === item.id ? '<span class="status-chip">当前封面</span>' : ''}${isStaticCoverFile(item) ? `<button class="button" type="button" data-edit-cover>${coverFileId === item.id ? '调整封面' : '设为封面'}</button>` : ''}<button class="icon-button" type="button" data-move-up aria-label="上移 ${escapeHtml(item.file_name || item.id)}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" type="button" data-move-down aria-label="下移 ${escapeHtml(item.file_name || item.id)}" ${index === items.length - 1 ? 'disabled' : ''}>↓</button><button class="button ghost" type="button" data-remove-item>移出图库</button></div>
  </article>`).join('');
  const shareUrl = state.user.publicHandle ? `${location.origin}/gallery/${encodeURIComponent(state.user.publicHandle)}/${encodeURIComponent(album.slug)}` : '';
  return `<div class="album-detail" data-album-id="${escapeHtml(album.id)}">
    <a class="album-back" href="/account/?view=albums">← 所有图库</a>
    <div class="workspace-section-head"><div><h2>${escapeHtml(album.name)}</h2><p>${items.length} 个文件${album.description ? ` · ${escapeHtml(album.description)}` : ''}</p></div><div class="album-detail-actions"><button class="button" type="button" data-edit-album>编辑信息</button><button class="button primary" id="addAlbumFiles" type="button">${icons.plus}添加已有文件</button></div></div>
    <div class="album-detail-tools">${shareUrl ? `<button class="button" type="button" data-copy="${escapeHtml(shareUrl)}">${icons.link}复制分享链接</button>` : '<button class="button" id="setPublicHandle" type="button">设置公开名称以分享</button>'}${shareUrl && album.charInfoCharacterName ? `<button class="button" type="button" data-copy="${escapeHtml(`${location.origin}/api/public/charinfo/${encodeURIComponent(album.id)}`)}">复制 CharInfo 链接</button>` : ''}${album.charInfoCharacterName ? `<a class="button primary" href="/charinfo/?album=${encodeURIComponent(album.id)}">打开 Creator</a>` : ''}${coverFileId ? '<button class="button ghost" type="button" data-clear-cover>恢复自动封面</button>' : ''}<button class="button ghost album-delete" type="button" data-delete-album>删除图库</button></div>
    <p class="album-content-hint">使用上下箭头调整文件顺序；移出图库会保留原文件。</p>
    <div class="album-items">${rows || '<div class="empty-state compact"><span class="empty-icon">' + icons.folder + '</span><h3>图库里还没有文件</h3><p>点击“添加已有文件”，直接选择要加入的图片或视频。</p></div>'}</div>
  </div>`;
}

function bindAlbumItemEvents(album) {
  const items = [...(album.items || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  document.querySelector('#addAlbumFiles')?.addEventListener('click', () => openAlbumFilePicker(album));
  main.querySelectorAll('.album-item-row').forEach((row, index) => {
    const fileId = row.dataset.fileId;
    const mutate = async (method, body = null, suffix = '') => {
      row.classList.add('busy');
      try {
        await api(`/api/user/albums/${encodeURIComponent(album.id)}/items${suffix}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
        await loadAlbums(true);
        if (state.view === 'albums') renderAlbums();
        toast('已移出图库，原文件仍然保留。');
      } catch (error) {
        row.classList.remove('busy');
        toast(error.message, 'error');
      }
    };
    const reorder = async (otherFile) => {
      row.classList.add('busy');
      try {
        await api(`/api/user/albums/${encodeURIComponent(album.id)}/items`, { method: 'PATCH', body: JSON.stringify({ fileId, swapWithFileId: otherFile.id }) });
        await loadAlbums(true);
        if (state.view === 'albums') renderAlbums();
        toast('展示顺序已更新。');
      } catch (error) {
        row.classList.remove('busy');
        toast(error.message, 'error');
      }
    };
    row.querySelector('[data-move-up]')?.addEventListener('click', async () => {
      const previous = items[index - 1];
      await reorder(previous);
    });
    row.querySelector('[data-move-down]')?.addEventListener('click', async () => {
      const next = items[index + 1];
      await reorder(next);
    });
    row.querySelector('[data-edit-cover]')?.addEventListener('click', () => openAlbumCoverEditor(album, items[index]));
    row.querySelector('[data-preview-item]')?.addEventListener('click', () => openFileViewer(items[index]));
    row.querySelector('[data-remove-item]')?.addEventListener('click', () => mutate('DELETE', null, `?fileId=${encodeURIComponent(fileId)}`));
  });
  main.querySelector('[data-clear-cover]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api(`/api/user/albums/${encodeURIComponent(album.id)}`, { method: 'PATCH', body: JSON.stringify({ coverFileId: null }) });
      await loadAlbums(true);
      if (state.view === 'albums') renderAlbums();
      toast('已恢复自动封面。');
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'error');
    }
  });
}

function openAlbumFilePicker(album) {
  const included = new Set((album.items || []).map(item => item.id));
  const selected = new Set();
  let files = [];
  let cursor = null;
  let requestId = 0;
  let query = '';
  let position = Math.max(-1, ...(album.items || []).map(item => Number(item.position) || 0)) + 1;
  const close = openDialog(`<div class="dialog-head"><div><h2>添加文件到“${escapeHtml(album.name)}”</h2><p>选择已有文件；同一文件可以加入多个图库。</p></div><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body"><form id="albumFileSearchForm" class="album-file-search" novalidate><label class="search-control"><span class="sr-only">搜索已有文件</span><input type="search" id="albumFileSearch" placeholder="搜索文件名"><button class="icon-button" id="clearAlbumFileSearch" type="button" aria-label="清除搜索" hidden>${icons.close}</button></label><button class="button" type="submit">搜索</button></form><div id="albumFileResults" class="album-file-results" aria-live="polite"></div><p class="field-error" id="albumFileError" role="status"></p></div>
    <div class="dialog-actions"><span id="albumFileSelectionCount" class="album-file-count">已选择 0 个文件</span><button class="button" type="button" data-close-dialog>取消</button><button class="button primary" id="confirmAlbumFiles" type="button" disabled>添加到图库</button></div>`, { wide: true, label: '选择已有文件' });
  const results = dialogRoot.querySelector('#albumFileResults');
  const search = dialogRoot.querySelector('#albumFileSearch');
  const clear = dialogRoot.querySelector('#clearAlbumFileSearch');
  const confirm = dialogRoot.querySelector('#confirmAlbumFiles');
  const errorNode = dialogRoot.querySelector('#albumFileError');
  const updateSelection = () => {
    dialogRoot.querySelector('#albumFileSelectionCount').textContent = `已选择 ${selected.size} 个文件`;
    confirm.disabled = selected.size === 0;
  };
  const renderResults = () => {
    results.innerHTML = files.length ? `<div class="album-file-grid">${files.map(file => `<label class="album-file-option${included.has(file.id) ? ' included' : ''}"><input type="checkbox" value="${escapeHtml(file.id)}" ${included.has(file.id) || selected.has(file.id) ? 'checked' : ''} ${included.has(file.id) ? 'disabled' : ''}><span class="album-file-preview">${isVideoFile(file) ? `<video src="${fileUrl(file)}" muted playsinline preload="metadata"></video>` : `<img src="${escapeHtml(previewUrl(file))}" alt="" loading="lazy" decoding="async">`}</span><strong title="${escapeHtml(file.file_name || file.id)}">${escapeHtml(file.file_name || file.id)}</strong><small>${included.has(file.id) ? '已在图库中' : formatBytes(file.file_size_bytes)}</small></label>`).join('')}</div>${cursor ? '<div class="load-more"><button class="button" type="button" data-more-album-files>加载更多</button></div>' : ''}` : `<div class="empty-state compact"><h3>${query ? '没有符合条件的文件' : '还没有上传文件'}</h3><p>${query ? '试试其他文件名，或清除搜索。' : '在“全部文件”上传后，即可在这里选择加入。'}</p></div>`;
  };
  const load = async (more = false) => {
    const currentRequest = ++requestId;
    const params = new URLSearchParams({ limit: '50', sort: 'newest', filter: 'all' });
    if (query) params.set('query', query);
    if (more && cursor) params.set('cursor', cursor);
    errorNode.textContent = '';
    results.setAttribute('aria-busy', 'true');
    if (!more) results.innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span><p>正在读取文件…</p></div>';
    else results.querySelector('[data-more-album-files]').disabled = true;
    try {
      const data = await api(`/api/user/files?${params}`);
      if (currentRequest !== requestId || !results.isConnected) return;
      files = more ? [...files, ...(data.files || [])] : (data.files || []);
      cursor = data.nextCursor || null;
      renderResults();
    } catch (error) {
      if (currentRequest !== requestId || !results.isConnected) return;
      errorNode.textContent = error.message || '无法读取文件，请重试。';
      if (!more) results.innerHTML = '<div class="empty-state compact"><button class="button" type="button" data-retry-album-files>重新读取</button></div>';
      else results.querySelector('[data-more-album-files]').disabled = false;
    } finally {
      if (currentRequest === requestId) results.removeAttribute('aria-busy');
    }
  };
  dialogRoot.querySelector('#albumFileSearchForm').addEventListener('submit', event => {
    event.preventDefault();
    query = search.value.trim();
    load();
  });
  search.addEventListener('input', () => { clear.hidden = !search.value; });
  search.addEventListener('keydown', event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); });
  clear.addEventListener('click', () => { search.value = ''; query = ''; clear.hidden = true; search.focus(); load(); });
  results.addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    if (event.target.checked) selected.add(event.target.value); else selected.delete(event.target.value);
    updateSelection();
  });
  results.addEventListener('click', event => {
    if (event.target.closest('[data-more-album-files]')) load(true);
    if (event.target.closest('[data-retry-album-files]')) load();
  });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    dialogRoot.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
    const failures = [];
    let added = 0;
    for (const fileId of selected) {
      try {
        await api(`/api/user/albums/${encodeURIComponent(album.id)}/items`, { method: 'POST', body: JSON.stringify({ fileId, position }) });
        position += 1;
        included.add(fileId);
        selected.delete(fileId);
        added += 1;
      } catch (error) {
        failures.push(error.message);
      }
    }
    if (added) {
      markViewDirty('albums');
      try {
        await loadAlbums(true);
        if (state.view === 'albums') renderAlbums();
      } catch (error) { failures.push(error.message); }
      toast(`已将 ${added} 个文件加入图库。`);
    }
    if (!results.isConnected) return;
    if (!failures.length) { close(); return; }
    dialogRoot.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
    errorNode.textContent = `部分文件未能加入：${failures[0]}。已成功加入的文件会保留。`;
    renderResults();
    updateSelection();
  });
  load();
}

function openAlbumCoverEditor(album, item) {
  const selected = selectedCoverFileId(album) === item.id;
  const initial = selected ? albumCoverPosition(album) : { x: 50, y: 50 };
  const content = `<form id="albumCoverForm">
    <div class="dialog-head"><h2>调整封面</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body cover-editor-body">
      <div class="cover-focus-preview"><img src="${escapeHtml(previewUrl(item))}" alt="${escapeHtml(item.file_name || item.id)}" draggable="false" style="object-position:${initial.x}% ${initial.y}%"></div>
      <label class="cover-focus-control" for="coverFocusX"><span>水平焦点 <output id="coverFocusXValue" for="coverFocusX">${initial.x}%</output></span><input id="coverFocusX" name="coverFocusX" type="range" min="0" max="100" step="1" value="${initial.x}" aria-label="水平焦点"></label>
      <label class="cover-focus-control" for="coverFocusY"><span>垂直焦点 <output id="coverFocusYValue" for="coverFocusY">${initial.y}%</output></span><input id="coverFocusY" name="coverFocusY" type="range" min="0" max="100" step="1" value="${initial.y}" aria-label="垂直焦点"></label>
    </div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button primary" type="submit">保存封面</button></div>
  </form>`;
  const close = openDialog(content, { label: '调整相册封面' });
  const form = dialogRoot.querySelector('#albumCoverForm');
  const focusPreview = form.querySelector('.cover-focus-preview');
  const preview = focusPreview.querySelector('img');
  const xInput = form.coverFocusX;
  const yInput = form.coverFocusY;
  const updatePreview = () => {
    preview.style.objectPosition = `${xInput.value}% ${yInput.value}%`;
    form.querySelector('#coverFocusXValue').textContent = `${xInput.value}%`;
    form.querySelector('#coverFocusYValue').textContent = `${yInput.value}%`;
  };
  xInput.addEventListener('input', updatePreview);
  yInput.addEventListener('input', updatePreview);
  const clampFocus = value => Math.round(Math.min(100, Math.max(0, value)));
  let drag = null;
  const updateFromDrag = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = focusPreview.getBoundingClientRect();
    xInput.value = String(clampFocus(drag.focusX - (event.clientX - drag.clientX) / bounds.width * 100));
    yInput.value = String(clampFocus(drag.focusY - (event.clientY - drag.clientY) / bounds.height * 100));
    updatePreview();
  };
  focusPreview.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, focusX: Number(xInput.value), focusY: Number(yInput.value) };
    focusPreview.setPointerCapture(event.pointerId);
    focusPreview.classList.add('is-dragging');
  });
  focusPreview.addEventListener('pointermove', event => {
    if (focusPreview.hasPointerCapture(event.pointerId)) updateFromDrag(event);
  });
  const finishDrag = event => {
    if (focusPreview.hasPointerCapture(event.pointerId)) focusPreview.releasePointerCapture(event.pointerId);
    if (drag?.pointerId === event.pointerId) drag = null;
    focusPreview.classList.remove('is-dragging');
  };
  focusPreview.addEventListener('pointerup', finishDrag);
  focusPreview.addEventListener('pointercancel', finishDrag);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api(`/api/user/albums/${encodeURIComponent(album.id)}`, { method: 'PATCH', body: JSON.stringify({ coverFileId: item.id, coverPositionX: Number(xInput.value), coverPositionY: Number(yInput.value) }) });
      await loadAlbums(true);
      close();
      if (state.view === 'albums') renderAlbums();
      toast('封面已更新。');
    } catch (error) {
      button.disabled = false;
      toast(error.message, 'error');
    }
  });
}

function confirmDeleteAlbum(album) {
  const content = `<div class="dialog-head"><h2>删除图库“${escapeHtml(album.name)}”？</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body"><p style="margin:0;color:var(--muted);line-height:1.65">图库会被删除，其中的 ${album.items?.length || 0} 个文件仍保留在“我的文件”，不会永久删除。</p></div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button danger" type="button" id="confirmDeleteAlbum">删除图库</button></div>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#confirmDeleteAlbum').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api(`/api/user/albums/${encodeURIComponent(album.id)}`, { method: 'DELETE' });
      close();
      await loadAlbums(true);
      if (state.view === 'albums') {
        if (state.albumId === album.id) state.albumId = null;
        renderAlbums();
      }
      toast('图库已删除，原文件仍然保留。');
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}

async function loadViewData(key) {
  const entry = cacheEntry(key);
  if (entry.promise) return entry.promise;
  entry.promise = (async () => {
    if (key === 'files') {
      await Promise.all([loadFiles(), state.albums.length ? Promise.resolve() : loadAlbums(false)]);
    } else if (key === 'albums') {
      await Promise.all([loadAlbums(true), cacheEntry('files').loaded ? Promise.resolve() : loadFiles()]);
    } else {
      await loadAdminData();
    }
    markViewFresh(key);
  })();
  try {
    await entry.promise;
  } finally {
    entry.promise = null;
  }
}

async function refreshView(key = currentViewKey(), { preserveScroll = true } = {}) {
  const scrollKey = currentScrollKey();
  const top = window.scrollY || 0;
  try {
    await loadViewData(key);
    if (currentViewKey() === key) {
      renderCurrentView();
      if (preserveScroll) {
        scrollPositions.set(scrollKey, top);
        restoreScroll(scrollKey);
      }
    }
  } catch (error) {
    if (currentViewKey() === key) toast(error.message || '刷新失败，请稍后重试。', 'error');
  }
}

async function showView({ initial = false, force = false } = {}) {
  syncNavigation();
  const key = currentViewKey();
  const scrollKey = currentScrollKey();
  const entry = cacheEntry(key);

  if (entry.loaded && !force) {
    renderCurrentView();
    restoreScroll(scrollKey);
    if (entry.dirty || Date.now() - entry.loadedAt > VIEW_CACHE_TTL) refreshView(key, { preserveScroll: true });
    return;
  }

  const alreadyShowingWorkspace = Boolean(main.querySelector('.page-section'));
  if (initial && !alreadyShowingWorkspace) {
    main.innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span><p>正在读取内容…</p></div>';
  }
  main.setAttribute('aria-busy', 'true');
  try {
    await loadViewData(key);
    if (currentViewKey() !== key) return;
    renderCurrentView();
    restoreScroll(scrollKey);
  } catch (error) {
    if (currentViewKey() !== key) return;
    main.innerHTML = `<div class="error-state"><span class="empty-icon">${icons.image}</span><h2>暂时无法读取内容</h2><p>${escapeHtml(error.message)}</p><button class="button" id="retryButton" type="button">重试</button></div>`;
    document.querySelector('#retryButton')?.addEventListener('click', () => showView({ force: true }));
  } finally {
    if (currentViewKey() === key) main.removeAttribute('aria-busy');
  }
}

async function syncWorkspaceWallpaper() {
  const isAdmin = state.view === 'admin';
  if (wallpaperAdminScope === isAdmin) return;
  wallpaperAdminScope = isAdmin;
  const initialization = ++wallpaperInitialization;
  stopWorkspaceWallpaper?.();
  stopWorkspaceWallpaper = null;
  if (pendingWorkspaceWallpaper) await pendingWorkspaceWallpaper;
  if (initialization !== wallpaperInitialization) return;
  const pending = initializeWorkspaceWallpaper({ isAdmin });
  pendingWorkspaceWallpaper = pending;
  const stop = await pending;
  if (pendingWorkspaceWallpaper === pending) pendingWorkspaceWallpaper = null;
  if (initialization !== wallpaperInitialization) {
    stop();
    return;
  }
  stopWorkspaceWallpaper = stop;
}

async function navigateWorkspace(target, { historyMode = 'push' } = {}) {
  if (!target) return;
  let { view, section, albumId = null } = target;
  if (view === 'admin' && !['manager', 'admin', 'owner'].includes(state.user?.role)) view = 'files';
  if (view === 'admin' && section === 'users' && state.user?.role !== 'owner') section = 'content';
  if (state.view === view && (view !== 'admin' || state.adminSection === section) && (view !== 'albums' || state.albumId === albumId)) return;

  rememberScroll();
  state.view = view;
  state.albumId = view === 'albums' ? albumId : null;
  if (view === 'admin') state.adminSection = section;
  syncWorkspaceWallpaper();
  activeDialogClose?.();
  const url = buildWorkspaceUrl(view, section);
  if (historyMode === 'push') history.pushState(null, '', url);
  else if (historyMode === 'replace') history.replaceState(null, '', url);
  await showView();
}

function bindWorkspaceNavigation() {
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const target = workspaceTargetFromUrl(link.href);
    if (!target) return;
    event.preventDefault();
    navigateWorkspace(target);
  });
  window.addEventListener('popstate', () => {
    const target = workspaceTargetFromUrl(location.href);
    if (target) navigateWorkspace(target, { historyMode: 'none' });
  });
  window.addEventListener('imgbed:files-changed', () => {
    markViewDirty('files');
    if (currentViewKey() === 'files') refreshView('files', { preserveScroll: true });
  });
}

async function init() {
  try {
    const data = await api('/api/user/me');
    state.user = data.user;
    mountLegacyShell(state.user);
    bindWorkspaceNavigation();
    if (!['manager', 'admin', 'owner'].includes(state.user.role) && state.view === 'admin') state.view = 'files';
    if (state.view === 'admin' && state.adminSection === 'users' && state.user.role !== 'owner') state.adminSection = 'content';
    syncWorkspaceWallpaper();
    await showView({ initial: true });
  } catch (error) {
    if (error.status === 401) showLogin();
    else main.innerHTML = `<div class="error-state"><h2>账户暂时不可用</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
