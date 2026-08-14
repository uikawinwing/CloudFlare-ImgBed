const MAX_BATCH_FILES = 20;
const MAX_REQUEST_BYTES = 95 * 1024 * 1024;
const MEMBER_QUOTA_BYTES = 200 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'video/mp4']);

const state = {
  user: null,
  files: [],
  albums: [],
  selected: new Set(),
  filter: 'all',
  view: ['albums', 'admin'].includes(new URLSearchParams(location.search).get('view')) ? new URLSearchParams(location.search).get('view') : 'files',
  adminSection: 'content',
  adminFiles: [],
  users: [],
  audit: [],
};

const main = document.querySelector('#mainContent');
const uploadInput = document.querySelector('#uploadInput');
const dialogRoot = document.querySelector('#dialogRoot');
const accountButton = document.querySelector('#accountButton');
const accountMenu = document.querySelector('#accountMenu');

const icons = {
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6.5 16 4-4 3 3 2-2 2.5 3"/><circle cx="16.5" cy="8.5" r="1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 14.5 5-5m-7 8H6a4 4 0 0 1 0-8h3m6 0h3a4 4 0 0 1 0 8h-3"/></svg>',
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

function roleLabel(role) {
  return ({ owner: '站主', admin: '管理员', manager: '协管', member: '成员' })[role] || '成员';
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  document.querySelector('#toastRegion').append(node);
  setTimeout(() => node.remove(), 3600);
}

function setAccount(user) {
  document.querySelector('#accountName').textContent = user.username || 'Discord 账户';
  document.querySelector('#accountRole').textContent = roleLabel(user.role);
  const avatar = document.querySelector('#accountAvatar');
  if (user.avatar) avatar.style.backgroundImage = `url("${String(user.avatar).replace(/["\\]/g, '')}")`;
}

function syncNavigation() {
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const url = new URL(location.href);
  url.searchParams.set('view', state.view);
  history.replaceState(null, '', url);
  const titles = { files: '我的文件', albums: '我的图库', admin: '管理中心' };
  document.title = `${titles[state.view] || titles.files} · CloudFlare ImgBed`;
}

function showLogin() {
  document.querySelector('.sidebar').hidden = true;
  accountButton.hidden = true;
  main.style.marginLeft = '0';
  main.innerHTML = `<section class="login-state">
    <span class="empty-icon">${icons.image}</span>
    <h1>登录后管理个人文件</h1>
    <p>使用 Discord 登录。第一阶段仅向目标社区中拥有“已验证”身份组的成员开放上传。</p>
    <a class="button primary" href="/api/auth/discord">使用 Discord 登录</a>
  </section>`;
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
  return `<article class="media-card${selected ? ' selected' : ''}" data-file-id="${escapeHtml(file.id)}">
    <input class="media-select" type="checkbox" aria-label="选择 ${escapeHtml(mediaLabel)}" ${selected ? 'checked' : ''}>
    <button class="media-frame" type="button" aria-label="预览 ${escapeHtml(mediaLabel)}">
      ${isVideo ? `<video src="${src}" muted loop playsinline preload="metadata"></video><span class="play" aria-hidden="true"></span><span class="media-type">MP4</span>` : `<img src="${src}" alt="${escapeHtml(mediaLabel)}" loading="lazy">`}
    </button>
    <div class="media-info">
      <p class="media-name" title="${escapeHtml(file.file_name || file.id)}">${escapeHtml(file.file_name || file.id)}</p>
      <div class="media-meta"><span>${formatBytes(file.file_size_bytes)}</span><span>${formatDate(file.timestamp)}</span>${file.moderation_status === 'quarantined' ? '<span>已撤下</span>' : ''}</div>
    </div>
  </article>`;
}

function renderFiles() {
  syncNavigation();
  const used = state.files.reduce((total, file) => total + (Number(file.file_size_bytes) || 0), 0);
  const quota = state.user.role === 'owner' ? null : MEMBER_QUOTA_BYTES;
  const filtered = state.files.filter(file => state.filter === 'all' || (state.filter === 'video' ? file.file_type === 'video/mp4' : file.file_type !== 'video/mp4'));
  main.innerHTML = `<section>
    <header class="page-head">
      <div class="page-title"><h1>我的文件</h1><p>整理上传内容，创建图库，或永久删除不再需要的文件。</p></div>
      <div class="head-actions">
        <div class="quota" aria-label="个人容量">
          <div class="quota-copy"><span>${quota ? `已使用 ${formatBytes(used)} / 200 MB` : `已使用 ${formatBytes(used)}`}</span><span>${quota ? `${Math.min(100, Math.round(used / quota * 100))}%` : '站主不限额'}</span></div>
          <div class="quota-track"><div class="quota-bar" style="width:${quota ? Math.min(100, used / quota * 100) : 0}%"></div></div>
        </div>
        <button class="button primary" id="uploadButton" type="button">${icons.upload}上传文件</button>
      </div>
    </header>
    <div class="toolbar">
      <div class="segmented" aria-label="文件类型">
        <button type="button" data-filter="all" class="${state.filter === 'all' ? 'active' : ''}">全部</button>
        <button type="button" data-filter="image" class="${state.filter === 'image' ? 'active' : ''}">图片</button>
        <button type="button" data-filter="video" class="${state.filter === 'video' ? 'active' : ''}">视频</button>
      </div>
      <select class="select-control" aria-label="排序"><option>最近上传</option></select>
    </div>
    ${state.selected.size ? `<div class="selection-bar">
      <div class="selection-copy"><strong>已选择 ${state.selected.size} 项</strong><button class="button ghost" id="clearSelection" type="button">取消选择</button></div>
      <div class="selection-actions"><button class="button" id="addToAlbum" type="button">${icons.folder}加入图库</button><button class="button danger" id="deleteSelected" type="button">${icons.trash}永久删除</button></div>
    </div>` : ''}
    ${filtered.length ? `<div class="media-grid">${filtered.map(fileCard).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">${icons.image}</span><h2>${state.files.length ? '没有这种类型的文件' : '还没有上传文件'}</h2><p>${state.files.length ? '换一个筛选条件看看。' : '上传 JPG、PNG、GIF、WebP、AVIF 或 MP4，文件会安全归到当前账号。'}</p>${state.files.length ? '' : '<button class="button primary" id="emptyUploadButton" type="button">上传第一个文件</button>'}</div>`}
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
        <button class="button" type="button" data-edit-album>编辑</button>
        <button class="button danger" type="button" data-delete-album>删除图库</button>
      </div>
    </div>
  </article>`;
}

function renderAlbums() {
  syncNavigation();
  main.innerHTML = `<section>
    <header class="page-head">
      <div class="page-title"><h1>我的图库</h1><p>把文件整理成可分享的图库。删除图库只会拆掉收纳盒，原文件仍留在“我的文件”。</p></div>
      <button class="button primary" id="createAlbum" type="button">${icons.plus}新建图库</button>
    </header>
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
  return `<article class="moderation-row" data-file-id="${escapeHtml(file.id)}">
    <div class="moderation-thumb">${isVideo ? `<video src="${fileUrl(file)}" muted playsinline preload="metadata"></video>` : `<img src="${fileUrl(file)}" alt="${escapeHtml(file.file_name || file.id)}" loading="lazy">`}</div>
    <div class="moderation-copy"><strong>${escapeHtml(file.file_name || file.id)}</strong><span>${escapeHtml(file.owner_name || '旧文件 / 未绑定')} · ${formatBytes(file.file_size_bytes)} · ${formatDate(file.timestamp)}</span><small>${file.moderation_status === 'quarantined' ? '已撤下' : file.moderation_status === 'deleting' ? '删除处理中' : '正常'}</small></div>
    <div class="moderation-actions">${file.moderation_status === 'active' ? '<button class="button danger" type="button" data-quarantine>先撤下</button>' : ''}${file.moderation_status === 'quarantined' && canRestore ? '<button class="button" type="button" data-restore>恢复</button><button class="button danger" type="button" data-hard-delete>永久删除</button>' : ''}</div>
  </article>`;
}

function userRow(user) {
  if (user.discord_id === state.user.id) return `<article class="user-row"><div class="moderation-copy"><strong>${escapeHtml(user.username)}</strong><span>${escapeHtml(user.discord_id)} · 站主账号</span></div><span class="status-chip">站主权限固定</span></article>`;
  return `<article class="user-row" data-user-id="${escapeHtml(user.discord_id)}"><div class="moderation-copy"><strong>${escapeHtml(user.username)}</strong><span>${escapeHtml(user.discord_id)} · ${formatBytes(user.used_bytes)}</span></div><select class="select-control" data-user-role aria-label="${escapeHtml(user.username)} 的权限"><option value="member" ${user.role === 'member' ? 'selected' : ''}>成员</option><option value="manager" ${user.role === 'manager' ? 'selected' : ''}>协管</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option></select><select class="select-control" data-user-status aria-label="${escapeHtml(user.username)} 的状态"><option value="active" ${user.status === 'active' ? 'selected' : ''}>正常</option><option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>暂停上传</option></select><button class="button" type="button" data-save-user>保存</button></article>`;
}

function auditRow(entry) {
  return `<article class="audit-row"><div><strong>${escapeHtml(entry.action)}</strong><span>${escapeHtml(entry.actor_name || entry.actor_id)} → ${escapeHtml(entry.target_id)}</span></div><p>${escapeHtml(entry.reason || '未填写原因')}</p><time>${formatDate(entry.created_at)}</time></article>`;
}

function renderAdmin() {
  syncNavigation();
  const owner = state.user.role === 'owner';
  const sections = `<div class="segmented admin-sections"><button type="button" data-admin-section="content" class="${state.adminSection === 'content' ? 'active' : ''}">内容处理</button>${owner ? `<button type="button" data-admin-section="users" class="${state.adminSection === 'users' ? 'active' : ''}">成员权限</button>` : ''}<button type="button" data-admin-section="audit" class="${state.adminSection === 'audit' ? 'active' : ''}">操作记录</button></div>`;
  let body = '';
  if (state.adminSection === 'content') body = state.adminFiles.length ? `<div class="moderation-list">${state.adminFiles.map(moderationRow).join('')}</div>` : '<div class="empty-state"><h2>没有需要处理的内容</h2><p>最近文件会在这里出现。</p></div>';
  if (state.adminSection === 'users') body = `<div class="admin-tools"><button class="button" id="migrateLegacy" type="button">整理未归属的旧文件</button><small>将尚未关联账号的旧文件纳入成员文件列表。</small></div>${state.users.length ? `<div class="user-list">${state.users.map(userRow).join('')}</div>` : '<div class="empty-state"><h2>还没有成员记录</h2></div>'}`;
  if (state.adminSection === 'audit') body = state.audit.length ? `<div class="audit-list">${state.audit.map(auditRow).join('')}</div>` : '<div class="empty-state"><h2>还没有管理操作</h2></div>';
  main.innerHTML = `<section><header class="page-head"><div class="page-title"><h1>管理中心</h1><p>协管可以先撤下有问题的内容；管理员和站主负责恢复或永久删除。所有操作都会留下原因。</p></div></header>${sections}${body}</section>`;
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
  document.querySelectorAll('[data-admin-section]').forEach(button => button.addEventListener('click', () => { state.adminSection = button.dataset.adminSection; renderAdmin(); }));
  document.querySelectorAll('.moderation-row').forEach(row => {
    const fileId = row.dataset.fileId;
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
  dialogRoot.innerHTML = `<div class="dialog-backdrop" role="presentation"><section class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${content}</section></div>`;
  const backdrop = dialogRoot.firstElementChild;
  const close = () => { dialogRoot.innerHTML = ''; };
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
  document.querySelector('#uploadButton')?.addEventListener('click', () => uploadInput.click());
  document.querySelector('#emptyUploadButton')?.addEventListener('click', () => uploadInput.click());
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderFiles(); }));
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
  });
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  uploadInput.value = '';
  if (!files.length) return;
  if (files.length > MAX_BATCH_FILES) return toast(`一次最多选择 ${MAX_BATCH_FILES} 个文件。`, 'error');
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_REQUEST_BYTES) return toast('这批文件合计不能超过 95MB。', 'error');
  if (files.some(file => !ALLOWED_TYPES.has(file.type))) return toast('只支持 JPG、PNG、GIF、WebP、AVIF 和 MP4。', 'error');
  const used = state.files.reduce((sum, file) => sum + (Number(file.file_size_bytes) || 0), 0);
  if (state.user.role !== 'owner' && used + total > MEMBER_QUOTA_BYTES) return toast('上传后会超过 200MB 个人容量，请先删除不再需要的文件。', 'error');
  toast(`开始上传 ${files.length} 个文件。`);
  let uploaded = 0;
  for (const file of files) {
    const form = new FormData();
    form.append('file', file);
    try {
      await api('/upload?uploadChannel=discord&returnFormat=full&autoRetry=false', { method: 'POST', body: form });
      uploaded += 1;
    } catch (error) {
      toast(`${file.name} 上传失败：${error.message}`, 'error');
    }
  }
  await loadFiles();
  renderFiles();
  if (uploaded) toast(`已上传 ${uploaded} 个文件。`);
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
  document.querySelectorAll('.album-row').forEach(row => {
    const album = state.albums.find(item => item.id === row.dataset.albumId);
    row.querySelector('[data-edit-album]').addEventListener('click', () => albumDialog(album));
    row.querySelector('[data-delete-album]').addEventListener('click', () => confirmDeleteAlbum(album));
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

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', async () => {
  state.view = button.dataset.view;
  state.selected.clear();
  await showView();
}));

accountButton.addEventListener('click', () => {
  const expanded = accountButton.getAttribute('aria-expanded') === 'true';
  accountButton.setAttribute('aria-expanded', String(!expanded));
  accountMenu.hidden = expanded;
});

document.addEventListener('click', event => {
  if (!accountButton.contains(event.target) && !accountMenu.contains(event.target)) {
    accountButton.setAttribute('aria-expanded', 'false');
    accountMenu.hidden = true;
  }
});

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ authType: 'user' }) });
  location.href = '/';
});

uploadInput.addEventListener('change', () => uploadFiles(uploadInput.files));

async function init() {
  try {
    const data = await api('/api/user/me');
    state.user = data.user;
    setAccount(state.user);
    if (['manager', 'admin', 'owner'].includes(state.user.role)) {
      document.querySelector('#adminNav').hidden = false;
      document.querySelector('.sidebar').classList.add('staff');
    } else if (state.view === 'admin') state.view = 'files';
    await ensurePublicHandle();
    await showView();
  } catch (error) {
    if (error.status === 401) showLogin();
    else main.innerHTML = `<div class="error-state"><h2>账户暂时不可用</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
