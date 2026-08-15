import { mountLegacyShell } from './shell.js';

const MEMBER_QUOTA_BYTES = 200 * 1024 * 1024;

const state = {
  user: null,
  files: [],
  albums: [],
  selected: new Set(),
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

const main = document.querySelector('#mainContent');
const dialogRoot = document.querySelector('#dialogRoot');

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

function isEnabled(value) {
  return value === true || value === 1 || value === '1';
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

function syncNavigation() {
  const activeKey = state.view === 'admin' ? state.adminSection : state.view;
  document.querySelectorAll('[data-shell-key]').forEach(link => {
    const active = link.dataset.shellKey === activeKey;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const url = new URL(location.href);
  url.searchParams.set('view', state.view);
  if (state.view === 'admin') url.searchParams.set('section', state.adminSection);
  else url.searchParams.delete('section');
  history.replaceState(null, '', url);
  const titles = { files: '我的文件', albums: '我的图库', admin: state.adminSection === 'users' ? '成员管理' : state.adminSection === 'audit' ? '操作记录' : '内容管理' };
  document.title = `${titles[state.view] || titles.files} · CloudFlare ImgBed`;
}

function showLogin() {
  location.replace(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
}

async function applyConfiguredWallpaper() {
  try {
    const config = await api('/api/userConfig');
    if (config.wallpaperEnabled === false) return;
    const configured = state.view === 'admin' ? (config.adminBkImg || config.uploadBkImg) : config.uploadBkImg;
    const candidate = Array.isArray(configured) ? configured[0] : configured;
    if (typeof candidate !== 'string' || candidate === 'bing' || !candidate.trim()) return;
    document.body.style.setProperty('--account-wallpaper', `url(${JSON.stringify(candidate.trim())})`);
  } catch {}
}

async function loadFiles() {
  const data = await api('/api/user/files');
  state.files = Array.isArray(data.files) ? data.files : [];
  state.selected = new Set([...state.selected].filter(id => state.files.some(file => file.id === id)));
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
}

function fileCard(file) {
  const isVideo = file.file_type === 'video/mp4';
  const selected = state.selected.has(file.id);
  const src = fileUrl(file);
  const mediaLabel = file.file_name || file.id;
  const visibility = ['private', 'unlisted', 'public'].includes(file.visibility) ? file.visibility : 'private';
  const visibilityHelp = visibility === 'private' ? '不公开展示；已有资源链接仍可访问' : visibility === 'unlisted' ? '仅用于链接分享；不出现在公开目录' : '可在公开图库展示；可选择加入发现';
  return `<article class="media-card${selected ? ' selected' : ''}" data-file-id="${escapeHtml(file.id)}">
    <input class="media-select" type="checkbox" aria-label="选择 ${escapeHtml(mediaLabel)}" ${selected ? 'checked' : ''}>
    <button class="media-frame" type="button" aria-label="预览 ${escapeHtml(mediaLabel)}">
      ${isVideo ? `<video src="${src}" muted loop playsinline preload="metadata"></video><span class="play" aria-hidden="true"></span><span class="media-type">MP4</span>` : `<img src="${src}" alt="${escapeHtml(mediaLabel)}" loading="lazy">`}
    </button>
    <div class="media-info">
      <p class="media-name" title="${escapeHtml(file.file_name || file.id)}">${escapeHtml(file.file_name || file.id)}</p>
      <div class="media-meta"><span>${formatBytes(file.file_size_bytes)}</span><span>${formatDate(file.timestamp)}</span>${file.moderation_status === 'quarantined' ? '<span>已撤下</span>' : ''}</div>
      <div class="file-visibility-row"><label><span class="sr-only">${escapeHtml(mediaLabel)} 的可见性</span><select class="file-visibility" aria-label="${escapeHtml(mediaLabel)} 的可见性"><option value="private" ${visibility === 'private' ? 'selected' : ''}>私密（不展示）</option><option value="unlisted" ${visibility === 'unlisted' ? 'selected' : ''}>不公开链接</option><option value="public" ${visibility === 'public' ? 'selected' : ''}>公开</option></select></label>${visibility === 'public' ? `<label class="discover-option"><input class="file-discover" type="checkbox" ${isEnabled(file.discover_eligible) || isEnabled(file.discoverEligible) ? 'checked' : ''}><span>加入发现</span></label>` : ''}</div><small class="file-visibility-help">${visibilityHelp}</small>
      <div class="file-card-actions"><button class="file-action" type="button" data-copy-file>${icons.link}<span>复制链接</span></button><a class="file-action" href="${escapeHtml(src)}" target="_blank" rel="noopener">${icons.external}<span>原文件</span></a></div>
    </div>
  </article>`;
}

function visibleFiles() {
  const query = state.fileQuery.trim().toLocaleLowerCase('zh-CN');
  return state.files
    .filter(file => state.filter === 'all' || (state.filter === 'video' ? file.file_type === 'video/mp4' : file.file_type !== 'video/mp4'))
    .filter(file => !query || String(file.file_name || file.id).toLocaleLowerCase('zh-CN').includes(query))
    .sort((a, b) => {
      if (state.fileSort === 'oldest') return Number(a.timestamp || 0) - Number(b.timestamp || 0);
      if (state.fileSort === 'name') return String(a.file_name || a.id).localeCompare(String(b.file_name || b.id), 'zh-CN');
      return Number(b.timestamp || 0) - Number(a.timestamp || 0);
    });
}

function renderFiles() {
  syncNavigation();
  const used = state.files.reduce((total, file) => total + (Number(file.file_size_bytes) || 0), 0);
  const quota = state.user.role === 'owner' ? null : MEMBER_QUOTA_BYTES;
  const filtered = visibleFiles();
  main.innerHTML = `<section class="page-section">
    <header class="page-head">
      <div class="page-title"><h1>我的文件</h1><p>集中管理上传的图片、动图和 MP4 视频。</p></div>
      <div class="head-actions">
        <div class="quota" aria-label="个人容量">
          <div class="quota-copy"><span>${quota ? `已使用 ${formatBytes(used)} / 200 MB` : `已使用 ${formatBytes(used)}`}</span><span>${quota ? `${Math.min(100, Math.round(used / quota * 100))}%` : '所有者不限额'}</span></div>
          <div class="quota-track"><div class="quota-bar" style="width:${quota ? Math.min(100, used / quota * 100) : 0}%"></div></div>
        </div>
        <a class="button primary" href="/studio">${icons.upload}前往上传</a>
      </div>
    </header>
    <div class="toolbar file-toolbar">
      <label class="search-control"><span class="sr-only">搜索文件</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><input id="fileSearch" type="search" value="${escapeHtml(state.fileQuery)}" placeholder="搜索文件名"></label>
      <div class="segmented" aria-label="文件类型">
        <button type="button" data-filter="all" class="${state.filter === 'all' ? 'active' : ''}">全部</button>
        <button type="button" data-filter="image" class="${state.filter === 'image' ? 'active' : ''}">图片</button>
        <button type="button" data-filter="video" class="${state.filter === 'video' ? 'active' : ''}">视频</button>
      </div>
      <select class="select-control" id="fileSort" aria-label="排序"><option value="newest" ${state.fileSort === 'newest' ? 'selected' : ''}>最近上传</option><option value="oldest" ${state.fileSort === 'oldest' ? 'selected' : ''}>最早上传</option><option value="name" ${state.fileSort === 'name' ? 'selected' : ''}>按名称</option></select>
    </div>
    ${state.selected.size ? `<div class="selection-bar">
      <div class="selection-copy"><strong>已选择 ${state.selected.size} 项</strong><button class="button ghost" id="clearSelection" type="button">取消选择</button></div>
      <div class="selection-actions"><button class="button" id="addToAlbum" type="button">${icons.folder}加入图库</button><button class="button danger" id="deleteSelected" type="button">${icons.trash}永久删除</button></div>
    </div>` : ''}
    ${filtered.length ? `<div class="media-grid">${filtered.map(fileCard).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${icons.image}</span><h2>${state.files.length ? '没有符合条件的文件' : '还没有上传文件'}</h2><p>${state.files.length ? '试试更换筛选条件或搜索词。' : '从上传页添加 JPG、PNG、GIF、WebP、AVIF 或 MP4。'}</p>${state.files.length ? '' : '<a class="button primary" href="/studio">上传第一个文件</a>'}</div>`}
  </section>`;
  bindFileEvents();
  observeVideos();
}

function albumRow(album) {
  const items = album.items || [];
  const cover = items.find(item => item.moderation_status !== 'quarantined');
  const coverMedia = cover ? (cover.file_type === 'video/mp4' ? `<video src="${fileUrl(cover)}" muted loop playsinline preload="metadata"></video>` : `<img src="${fileUrl(cover)}" alt="${escapeHtml(cover.file_name || album.name)}" loading="lazy">`) : `<span class="empty-icon">${icons.image}</span>`;
  const canShare = album.visibility === 'public' && state.user.publicHandle;
  const shareUrl = canShare ? `${location.origin}/gallery/${encodeURIComponent(state.user.publicHandle)}/${encodeURIComponent(album.slug)}` : '';
  const feedUrl = canShare ? `${location.origin}/api/public/gallery/${encodeURIComponent(state.user.publicHandle)}/${encodeURIComponent(album.slug)}` : '';
  return `<article class="album-row" data-album-id="${escapeHtml(album.id)}">
    <div class="album-cover">${coverMedia}</div>
    <div class="album-body">
      <h2>${escapeHtml(album.name)}</h2>
      <div class="album-meta"><span>${items.length} 个项目</span><span>最近更新：${formatDate(album.updated_at)}</span></div>
      <p class="album-visibility">${album.visibility === 'public' ? '公开 · 可通过分享链接访问' : '不公开 · 已分享的文件链接仍可访问'}</p>
      <div class="album-actions">
        ${canShare ? `<button class="button" type="button" data-copy="${escapeHtml(shareUrl)}">${icons.link}复制分享链接</button><button class="button" type="button" data-copy="${escapeHtml(feedUrl)}">${icons.link}复制 CharInfo 链接</button>` : ''}
        <button class="button" type="button" data-manage-album>管理内容</button>
        <button class="button" type="button" data-edit-album>编辑</button>
        <button class="button danger" type="button" data-delete-album>删除图库</button>
      </div>
    </div>
  </article>`;
}

function renderAlbums() {
  syncNavigation();
  main.innerHTML = `<section class="page-section">
    <header class="page-head">
      <div class="page-title"><h1>我的图库</h1><p>把文件整理成可分享的图库。删除图库只会拆掉收纳盒，原文件仍留在“我的文件”。</p></div>
      <button class="button primary" id="createAlbum" type="button">${icons.plus}新建图库</button>
    </header>
    ${state.user.publicHandle ? '' : '<div class="notice-panel"><div><strong>准备公开图库？</strong><p>先设置一个用于分享链接的公开名称。它会绑定当前 Discord 账号。</p></div><button class="button" id="setPublicHandle" type="button">设置公开名称</button></div>'}
    ${state.albums.length ? `<div class="album-list">${state.albums.map(albumRow).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${icons.folder}</span><h2>还没有图库</h2><p>创建图库后，可以把同一文件整理进一个或多个图库。</p><button class="button primary" id="emptyCreateAlbum" type="button">新建第一个图库</button></div>`}
  </section>`;
  bindAlbumEvents();
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
}

function moderationRow(file) {
  const isVideo = file.file_type === 'video/mp4';
  const canRestore = ['admin', 'owner'].includes(state.user.role);
  const status = file.moderation_status === 'quarantined' ? '已撤下' : file.moderation_status === 'deleting' ? '删除处理中' : '正常';
  return `<article class="moderation-row" data-file-id="${escapeHtml(file.id)}">
    <button class="moderation-thumb" type="button" data-preview-admin aria-label="预览 ${escapeHtml(file.file_name || file.id)}">${isVideo ? `<video src="${fileUrl(file)}" muted playsinline preload="metadata"></video>` : `<img src="${fileUrl(file)}" alt="" loading="lazy">`}</button>
    <div class="moderation-copy file-column"><strong>${escapeHtml(file.file_name || file.id)}</strong><span>${escapeHtml(file.id)}</span></div>
    <div class="moderation-copy owner-column"><strong>${escapeHtml(file.owner_name || '未绑定账号')}</strong><span>${escapeHtml(file.owner_id || '旧文件')}</span></div>
    <div class="moderation-copy type-column"><strong>${isVideo ? '视频 / MP4' : '图片'}</strong><span>${formatBytes(file.file_size_bytes)}</span></div>
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
  const owner = state.user.role === 'owner';
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
  document.querySelectorAll('[data-admin-section]').forEach(button => button.addEventListener('click', () => { state.adminSection = button.dataset.adminSection; if (button.dataset.setStatus) state.adminStatus = button.dataset.setStatus; renderAdmin(); }));
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
    toast(`未归属旧文件整理完成：${migrated} 条。`);
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
}

function observeVideos() {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) video.play().catch(() => {}); else video.pause();
  }), { threshold: .45 });
  document.querySelectorAll('.media-frame video, .album-cover video').forEach(video => observer.observe(video));
}

function openDialog(content, { closeable = true, wide = false } = {}) {
  const previouslyFocused = document.activeElement;
  dialogRoot.innerHTML = `<div class="dialog-backdrop" role="presentation"><section class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="对话框" tabindex="-1">${content}</section></div>`;
  const backdrop = dialogRoot.firstElementChild;
  const dialog = dialogRoot.querySelector('.dialog');
  dialog?.focus();
  const close = () => {
    dialogRoot.innerHTML = '';
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
  };
  if (closeable) {
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    dialogRoot.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', close));
  }
  return close;
}

async function ensurePublicHandle() {
  if (state.user.publicHandle) return;
  const content = `<form id="handleForm">
    <div class="dialog-head"><h2>设置公开名称</h2></div>
    <div class="dialog-body">
      <p style="margin-top:0;color:var(--muted);line-height:1.65">这个名称会出现在公开图库链接中，并绑定当前 Discord 账号。</p>
      <div class="field"><label for="publicHandle">公开名称</label><input id="publicHandle" name="publicHandle" autocomplete="off" minlength="3" maxlength="32" pattern="[a-z0-9][a-z0-9-]{2,31}" required><small>使用 3–32 位小写英文字母、数字或短横线。</small><small class="field-error" id="handleError"></small></div>
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

function previewFile(file) {
  const isVideo = file.file_type === 'video/mp4';
  openDialog(`<div class="dialog-head"><div><h2>${escapeHtml(file.file_name || file.id)}</h2><p style="color:var(--muted);margin:6px 0 0">${formatBytes(file.file_size_bytes)}</p></div><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body"><div class="media-frame" style="aspect-ratio:16/10;border-radius:12px">${isVideo ? `<video src="${fileUrl(file)}" autoplay muted loop playsinline controls></video>` : `<img src="${fileUrl(file)}" alt="${escapeHtml(file.file_name || '')}">`}</div></div>`, { wide: true });
}

function bindFileEvents() {
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderFiles(); }));
  document.querySelector('#fileSearch')?.addEventListener('change', event => { state.fileQuery = event.target.value; renderFiles(); });
  document.querySelector('#fileSearch')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); state.fileQuery = event.currentTarget.value; renderFiles(); } });
  document.querySelector('#fileSort')?.addEventListener('change', event => { state.fileSort = event.target.value; renderFiles(); });
  document.querySelector('#clearSelection')?.addEventListener('click', () => { state.selected.clear(); renderFiles(); });
  document.querySelector('#addToAlbum')?.addEventListener('click', addSelectedToAlbum);
  document.querySelector('#deleteSelected')?.addEventListener('click', confirmDeleteSelected);
  document.querySelectorAll('.media-card').forEach(card => {
    const id = card.dataset.fileId;
    card.querySelector('.media-select').addEventListener('change', event => {
      if (event.target.checked) state.selected.add(id); else state.selected.delete(id);
      renderFiles();
    });
    card.querySelector('.media-frame').addEventListener('click', () => previewFile(state.files.find(file => file.id === id)));
    card.querySelector('[data-copy-file]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(new URL(fileUrl(state.files.find(file => file.id === id)), location.origin).href);
        toast('资源链接已复制。');
      } catch {
        toast('复制失败，请直接打开原文件后复制地址。', 'error');
      }
    });
    card.querySelector('.file-visibility')?.addEventListener('change', event => updateFileVisibility(id, event.currentTarget.value));
    card.querySelector('.file-discover')?.addEventListener('change', event => updateFileVisibility(id, 'public', event.currentTarget.checked));
  });
}

async function updateFileVisibility(fileId, visibility, discoverEligible = undefined) {
  const file = state.files.find(item => item.id === fileId);
  if (!file) return;
  const previous = { visibility: file.visibility || 'private', discoverEligible: isEnabled(file.discover_eligible) || isEnabled(file.discoverEligible) };
  const nextDiscover = visibility === 'public' ? (discoverEligible === undefined ? previous.discoverEligible : discoverEligible) : false;
  file.visibility = visibility;
  file.discover_eligible = nextDiscover;
  renderFiles();
  try {
    await api(`/api/user/files/${encodeFilePath(fileId)}`, { method: 'PATCH', body: JSON.stringify({ visibility, discoverEligible: nextDiscover }) });
    toast(visibility === 'private' ? '已设为私密。' : visibility === 'unlisted' ? '已设为不公开链接。' : nextDiscover ? '已公开，并会出现在发现页候选中。' : '已公开，但不会出现在发现页。');
  } catch (error) {
    file.visibility = previous.visibility;
    file.discover_eligible = previous.discoverEligible;
    renderFiles();
    toast(error.message || '无法更新可见性。', 'error');
  }
}

async function addSelectedToAlbum() {
  if (!state.albums.length) await loadAlbums(false);
  if (!state.albums.length) {
    toast('请先创建一个图库。', 'error');
    state.view = 'albums';
    await showView();
    return;
  }
  const content = `<div class="dialog-head"><h2>加入图库</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body"><div class="album-picker">${state.albums.map((album, index) => `<label><input type="radio" name="album" value="${escapeHtml(album.id)}" ${index === 0 ? 'checked' : ''}><span>${escapeHtml(album.name)}</span></label>`).join('')}</div></div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button primary" type="button" id="confirmAddToAlbum">加入图库</button></div>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#confirmAddToAlbum').addEventListener('click', async event => {
    const albumId = dialogRoot.querySelector('input[name="album"]:checked')?.value;
    if (!albumId) return;
    event.currentTarget.disabled = true;
    let added = 0;
    for (const fileId of state.selected) {
      try {
        await api(`/api/user/albums/${encodeURIComponent(albumId)}/items`, { method: 'POST', body: JSON.stringify({ fileId }) });
        added += 1;
      } catch (error) {
        toast(error.message, 'error');
      }
    }
    close();
    state.selected.clear();
    renderFiles();
    toast(`已将 ${added} 个文件加入图库。`);
  });
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
    renderFiles();
    toast(`已永久删除 ${deleted} 个文件。`);
  });
}

function albumDialog(album = null) {
  const editing = Boolean(album);
  const content = `<form id="albumForm">
    <div class="dialog-head"><h2>${editing ? '编辑图库' : '新建图库'}</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body">
      <div class="field"><label for="albumName">图库名称</label><input id="albumName" name="name" maxlength="80" value="${escapeHtml(album?.name || '')}" required></div>
      <div class="field"><label for="albumSlug">分享链接名称</label><input id="albumSlug" name="slug" maxlength="80" value="${escapeHtml(album?.slug || '')}" pattern="[a-z0-9][a-z0-9-]*"><small>用于分享链接，只能使用小写英文字母、数字和短横线；留空会根据图库名称生成。</small></div>
      <div class="field"><label for="albumDescription">说明</label><textarea id="albumDescription" name="description" maxlength="200">${escapeHtml(album?.description || '')}</textarea></div>
      <fieldset class="field" style="border:0;padding:0"><legend>可见性</legend>
        <label class="radio-option"><input type="radio" name="visibility" value="public" ${album?.visibility === 'public' ? 'checked' : ''}><span class="radio-copy"><strong>公开图库</strong><small>任何人都可以通过链接浏览，并可供 CharInfo 读取。</small></span></label>
        <label class="radio-option"><input type="radio" name="visibility" value="unlisted" ${album?.visibility !== 'public' ? 'checked' : ''}><span class="radio-copy"><strong>不公开图库</strong><small>不会公开展示图库，但已分享的文件直链仍可访问。</small></span></label>
      </fieldset>
      <small class="field-error" id="albumError"></small>
    </div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button primary" type="submit">${editing ? '保存更改' : '创建图库'}</button></div>
  </form>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#albumForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = { name: form.name.value.trim(), slug: form.slug.value.trim() || undefined, description: form.description.value.trim(), visibility: form.visibility.value };
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      if (editing) await api(`/api/user/albums/${encodeURIComponent(album.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/user/albums', { method: 'POST', body: JSON.stringify(payload) });
      close();
      await loadAlbums(true);
      renderAlbums();
      toast(editing ? '图库已更新。' : '图库已创建。');
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
    await navigator.clipboard.writeText(button.dataset.copy);
    toast('链接已复制。');
  }));
  document.querySelector('#setPublicHandle')?.addEventListener('click', async () => { await ensurePublicHandle(); renderAlbums(); });
  document.querySelectorAll('.album-row').forEach(row => {
    const album = state.albums.find(item => item.id === row.dataset.albumId);
    row.querySelector('[data-manage-album]').addEventListener('click', () => manageAlbumItems(album));
    row.querySelector('[data-edit-album]').addEventListener('click', () => albumDialog(album));
    row.querySelector('[data-delete-album]').addEventListener('click', () => confirmDeleteAlbum(album));
  });
}

function manageAlbumItems(album) {
  const items = [...(album.items || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const rows = items.map((item, index) => `<article class="album-item-row" data-file-id="${escapeHtml(item.id)}">
    <div class="album-item-thumb">${item.file_type === 'video/mp4' ? `<video src="${fileUrl(item)}" muted playsinline preload="metadata"></video>` : `<img src="${fileUrl(item)}" alt="${escapeHtml(item.file_name || item.id)}">`}</div>
    <div class="album-item-copy"><strong>${escapeHtml(item.file_name || item.id)}</strong><span>${formatBytes(item.file_size_bytes)}</span></div>
    <div class="album-item-actions"><button class="icon-button" type="button" data-move-up aria-label="上移" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" type="button" data-move-down aria-label="下移" ${index === items.length - 1 ? 'disabled' : ''}>↓</button><button class="button danger" type="button" data-remove-item>移出图库</button></div>
  </article>`).join('');
  const content = `<div class="dialog-head"><div><h2>管理“${escapeHtml(album.name)}”的内容</h2><p>${items.length} 个项目</p></div><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div><div class="dialog-body">${rows || '<div class="empty-state compact"><h3>图库里还没有文件</h3><p>请从“我的文件”选择内容加入。</p></div>'}</div>`;
  openDialog(content, { wide: true });
  dialogRoot.querySelectorAll('.album-item-row').forEach((row, index) => {
    const fileId = row.dataset.fileId;
    const mutate = async (method, body = null, suffix = '') => {
      row.classList.add('busy');
      try {
        await api(`/api/user/albums/${encodeURIComponent(album.id)}/items${suffix}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
        await loadAlbums(true);
        const refreshed = state.albums.find(item => item.id === album.id);
        manageAlbumItems(refreshed || album);
      } catch (error) {
        row.classList.remove('busy');
        toast(error.message, 'error');
      }
    };
    const reorder = async (otherFile, nextPosition, otherPosition) => {
      row.classList.add('busy');
      try {
        await Promise.all([
          api(`/api/user/albums/${encodeURIComponent(album.id)}/items`, { method: 'PATCH', body: JSON.stringify({ fileId, position: nextPosition }) }),
          api(`/api/user/albums/${encodeURIComponent(album.id)}/items`, { method: 'PATCH', body: JSON.stringify({ fileId: otherFile.id, position: otherPosition }) }),
        ]);
        await loadAlbums(true);
        manageAlbumItems(state.albums.find(item => item.id === album.id) || album);
      } catch (error) {
        row.classList.remove('busy');
        toast(error.message, 'error');
      }
    };
    row.querySelector('[data-move-up]')?.addEventListener('click', async () => {
      const previous = items[index - 1];
      await reorder(previous, index - 1, index);
    });
    row.querySelector('[data-move-down]')?.addEventListener('click', async () => {
      const next = items[index + 1];
      await reorder(next, index + 1, index);
    });
    row.querySelector('[data-remove-item]')?.addEventListener('click', () => mutate('DELETE', null, `?fileId=${encodeURIComponent(fileId)}`));
  });
}

function confirmDeleteAlbum(album) {
  const content = `<div class="dialog-head"><h2>删除图库“${escapeHtml(album.name)}”？</h2><button class="icon-button" type="button" data-close-dialog aria-label="关闭">${icons.close}</button></div>
    <div class="dialog-body"><p style="margin:0;color:var(--muted);line-height:1.65">图库会被删除，其中的 ${album.items?.length || 0} 个文件仍保留在“我的文件”，不会永久删除。</p></div>
    <div class="dialog-actions"><button class="button" type="button" data-close-dialog>取消</button><button class="button danger" type="button" id="confirmDeleteAlbum">删除图库</button></div>`;
  const close = openDialog(content);
  dialogRoot.querySelector('#confirmDeleteAlbum').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      await api(`/api/user/albums/${encodeURIComponent(album.id)}`, { method: 'DELETE' });
      close();
      await loadAlbums(true);
      renderAlbums();
      toast('图库已删除，原文件仍然保留。');
    } catch (error) {
      toast(error.message, 'error');
      event.currentTarget.disabled = false;
    }
  });
}

async function showView() {
  syncNavigation();
  main.innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span><p>正在读取内容…</p></div>';
  try {
    if (state.view === 'files') {
      await Promise.all([loadFiles(), state.albums.length ? Promise.resolve() : loadAlbums(false)]);
      renderFiles();
    } else if (state.view === 'albums') {
      await loadAlbums(true);
      renderAlbums();
    } else {
      await loadAdminData();
      renderAdmin();
    }
  } catch (error) {
    main.innerHTML = `<div class="error-state"><span class="empty-icon">${icons.image}</span><h2>暂时无法读取内容</h2><p>${escapeHtml(error.message)}</p><button class="button" id="retryButton" type="button">重试</button></div>`;
    document.querySelector('#retryButton').addEventListener('click', showView);
  }
}

async function init() {
  try {
    const data = await api('/api/user/me');
    state.user = data.user;
    mountLegacyShell(state.user);
    if (!['manager', 'admin', 'owner'].includes(state.user.role) && state.view === 'admin') state.view = 'files';
    if (state.view === 'admin' && state.adminSection === 'users' && state.user.role !== 'owner') state.adminSection = 'content';
    applyConfiguredWallpaper();
    await showView();
  } catch (error) {
    if (error.status === 401) showLogin();
    else main.innerHTML = `<div class="error-state"><h2>账户暂时不可用</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
