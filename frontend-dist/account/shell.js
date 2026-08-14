const icon = (name) => ({
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  files: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 9.5v-3a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6.5 16 4-4 3 3 2-2 2.5 3"/><circle cx="16.5" cy="8.5" r="1.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.9 7.5-9.5V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 20c.5-3.4 2.4-5.2 5.5-5.2s5 1.8 5.5 5.2M16 5.5a3 3 0 0 1 0 5.8M17 14.9c2 .2 3.3 1.8 3.7 4.7"/></svg>',
  activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V8m8 10V4m8 14v-6"/><path d="M2 20h20"/></svg>',
  storage: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.1-2.1.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5v-3h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L8.4 5l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3.7h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.7 6.3 3-3a4 4 0 0 1-5 5L5.2 15.8a2.1 2.1 0 0 0 3 3l7.5-7.5a4 4 0 0 1 5-5l-3 3"/><path d="m4 4 4 4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></svg>',
  slider: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 14.5 5-5m-7 8H6a4 4 0 0 1 0-8h3m6 0h3a4 4 0 0 1 0 8h-3"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 5.5v4h4"/><path d="M12 7v5l3.5 2"/></svg>',
  language: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.2 2.5 3.3 5.5 3.3 9s-1.1 6.5-3.3 9c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 10a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 22h4"/></svg>',
})[name] || '';

const labels = { owner: '站点所有者', admin: '管理员', manager: '协管', member: '成员' };
const accountHref = (view, section = '') => `/account/?view=${view}${section ? `&section=${section}` : ''}`;
const isStaff = role => ['manager', 'admin', 'owner'].includes(role);
const isAdmin = role => ['admin', 'owner'].includes(role);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function navItem(item, active) {
  return `<a class="legacy-shell-nav-item${active ? ' is-active' : ''}" data-shell-key="${item.key}" href="${item.href}"${active ? ' aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span>${item.note ? `<small>${item.note}</small>` : ''}</a>`;
}

function activeKey() {
  const path = window.location.pathname;
  if (path.startsWith('/account')) {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view') || 'files';
    if (view === 'admin') return params.get('section') === 'users' ? 'users' : params.get('section') === 'audit' ? 'audit' : 'content';
    return view;
  }
  if (path === '/dashboard') return 'content';
  if (path === '/customerConfig') return 'access';
  if (path === '/systemConfig') return `system-${window.location.hash.slice(1) || 'status'}`;
  return 'upload';
}

function buildNavigation(role) {
  const active = activeKey();
  const member = [
    { key: 'upload', label: '上传', href: '/', icon: 'upload' },
    { key: 'files', label: '我的文件', href: accountHref('files'), icon: 'files' },
    { key: 'albums', label: '我的图库', href: accountHref('albums'), icon: 'gallery' },
  ];
  const staff = [
    { key: 'content', label: '内容管理', href: accountHref('admin', 'content'), icon: 'shield' },
    { key: 'audit', label: '操作记录', href: accountHref('admin', 'audit'), icon: 'activity' },
    ...(role === 'owner' ? [{ key: 'users', label: '成员管理', href: accountHref('admin', 'users'), icon: 'users' }] : []),
    ...(isAdmin(role) ? [
      { key: 'access', label: '上传访问', href: '/customerConfig', icon: 'activity' },
      { key: 'system-upload', label: '存储渠道', href: '/systemConfig#upload', icon: 'storage' },
      { key: 'system-page', label: '网站设置', href: '/systemConfig#page', icon: 'settings' },
      { key: 'system-security', label: '安全与自动化', href: '/systemConfig#security', icon: 'shield' },
      { key: 'system-status', label: '维护工具', href: '/systemConfig#status', icon: 'tools' },
    ] : []),
  ];
  return `<section class="legacy-shell-group"><p>工作区</p>${member.map(item => navItem(item, active === item.key)).join('')}</section>${isStaff(role) ? `<section class="legacy-shell-group legacy-shell-group-management"><p>管理</p>${staff.map(item => navItem(item, active === item.key)).join('')}</section>` : ''}`;
}

function activateLegacyControl(command) {
  const click = selector => document.querySelector(selector)?.click();
  const menuCommand = labels => {
    click('.more-dropdown .el-button');
    window.setTimeout(() => [...document.querySelectorAll('.el-dropdown-menu__item, [role="menuitem"]')]
      .find(node => labels.some(label => node.textContent.replace(/\s+/g, '').includes(label)))?.click(), 80);
  };
  if (command === 'language') {
    const languageSwitcher = document.querySelector('.language-switcher');
    if (languageSwitcher) languageSwitcher.click();
    else menuCommand(['English', '简体中文']);
  }
  if (command === 'theme') click('#themeToggle, .toggle-dark-button');
}

function openLocalImageOptions() {
  const settingsButton = document.querySelector('.quick-toolbar > .quick-toolbar-button:not(.quick-toolbar-more)');
  settingsButton?.click();
  window.setTimeout(() => {
    const dialog = document.querySelector('.upload-settings-dialog');
    const title = dialog?.querySelector('.el-dialog__title');
    if (title) title.textContent = '图片处理选项';
    dialog?.closest('[role="dialog"], .el-dialog')?.setAttribute('aria-label', '图片处理选项');
  }, 80);
}

function mountUploadFlow() {
  if (window.location.pathname !== '/') return;
  const uploadHome = document.querySelector('.upload-home');
  const title = uploadHome?.querySelector('h1.title');
  const folderContainer = uploadHome?.querySelector('.upload-folder-container');
  if (!uploadHome || !title || !folderContainer) return;

  let destination = uploadHome.querySelector('.legacy-upload-destination');
  if (!destination) {
    destination = document.createElement('div');
    destination.className = 'legacy-upload-destination';
    destination.setAttribute('role', 'group');
    destination.setAttribute('aria-label', '文件保存位置');
    destination.innerHTML = '<span class="legacy-upload-destination-label">保存到</span><span class="legacy-upload-destination-name" aria-live="polite">默认位置</span>';
    title.insertAdjacentElement('afterend', destination);
  }
  if (!destination.contains(folderContainer)) destination.append(folderContainer);

  const folderInput = folderContainer.querySelector('input[placeholder="上传目录"], .upload-folder input, input.inner-folder-input, input');
  const folderName = destination.querySelector('.legacy-upload-destination-name');
  const syncFolderName = () => {
    const value = folderInput?.value?.trim() || '默认位置';
    if (folderName && folderName.textContent !== value) folderName.textContent = value;
  };
  if (folderInput && !folderInput.dataset.legacyFolderNameBound) {
    folderInput.dataset.legacyFolderNameBound = 'true';
    folderInput.addEventListener('input', syncFolderName);
    folderInput.addEventListener('change', syncFolderName);
  }
  syncFolderName();

  const folderTrigger = folderContainer.querySelector('.directory-tree-trigger');
  destination.classList.toggle('has-folder-picker', Boolean(folderTrigger));
  if (!folderTrigger && folderInput) folderInput.setAttribute('aria-label', '保存位置路径');
  if (folderTrigger && !folderTrigger.dataset.legacyLabelled) {
    folderTrigger.dataset.legacyLabelled = 'true';
    folderTrigger.setAttribute('aria-label', '更改保存位置');
    folderTrigger.setAttribute('title', '更改保存位置');
    folderTrigger.replaceChildren(Object.assign(document.createElement('span'), { textContent: '更改' }));
  }

  if (!uploadHome.querySelector('.legacy-image-processing')) {
    const imageProcessing = document.createElement('section');
    imageProcessing.className = 'legacy-image-processing';
    imageProcessing.innerHTML = `<button class="legacy-image-processing-button" type="button" aria-haspopup="dialog"><span><strong>图片处理选项</strong><small>WebP 转换与上传前压缩</small></span>${icon('chevron')}</button>`;
    imageProcessing.querySelector('button').addEventListener('click', openLocalImageOptions);
    destination.insertAdjacentElement('afterend', imageProcessing);
  }
}

function bindUtilities(shell) {
  shell.querySelectorAll('[data-legacy-command]').forEach(button => {
    button.addEventListener('click', () => activateLegacyControl(button.dataset.legacyCommand));
  });
}

function syncLegacyPresentation() {
  if (window.location.pathname !== '/') return;
  document.title = '上传 · CloudFlare ImgBed';
  const title = document.querySelector('h1.title');
  if (title && title.textContent.trim() !== '上传文件') title.textContent = '上传文件';
}

function syncActiveNavigation(shell) {
  const current = activeKey();
  shell.querySelectorAll('[data-shell-key]').forEach(link => {
    const active = link.dataset.shellKey === current;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function shellMarkup(identity) {
  const role = identity.role || 'member';
  const avatarStyle = identity.avatar ? ` style="background-image:url('${String(identity.avatar).replace(/["\\]/g, '')}')"` : '';
  return `<button class="legacy-shell-toggle" type="button" aria-label="打开导航" aria-controls="legacyShell" aria-expanded="false">${icon('menu')}</button><div class="legacy-shell-backdrop" hidden></div><aside class="legacy-shell" id="legacyShell" aria-label="主导航"><div class="legacy-shell-brand"><a href="/" aria-label="CloudFlare ImgBed 上传首页"><span class="legacy-shell-mark" aria-hidden="true">${icon('upload')}</span><span>CloudFlare <strong>ImgBed</strong></span></a><button class="legacy-shell-close" type="button" aria-label="关闭导航">${icon('close')}</button></div><nav>${buildNavigation(role)}</nav><section class="legacy-shell-utilities legacy-shell-preferences" aria-label="显示偏好"><p>显示</p><button type="button" data-legacy-command="theme">${icon('slider')}切换主题</button><button type="button" data-legacy-command="language">${icon('language')}切换语言</button></section><div class="legacy-shell-account"><button class="legacy-shell-account-button" type="button" aria-controls="legacyAccountMenu" aria-haspopup="true" aria-expanded="false"><span class="legacy-shell-avatar"${avatarStyle}></span><span><strong>${escapeHtml(identity.username || 'Discord 账户')}</strong><small>${labels[role] || labels.member}</small></span>${icon('chevron')}</button><div class="legacy-shell-account-menu" id="legacyAccountMenu" role="menu" hidden><a href="${accountHref('files')}" role="menuitem">我的文件</a><button type="button" role="menuitem" data-legacy-logout>${icon('logout')}退出登录</button></div></div></aside>`;
}

function bindAccountMenu(shell) {
  const accountButton = shell.querySelector('.legacy-shell-account-button');
  const menu = shell.querySelector('.legacy-shell-account-menu');
  accountButton.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    accountButton.setAttribute('aria-expanded', String(open));
  });
  shell.querySelector('[data-legacy-logout]').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authType: 'user' }) });
    window.location.assign('/login');
  });
}

function bindDrawer(shell) {
  const toggle = shell.querySelector('.legacy-shell-toggle');
  const close = shell.querySelector('.legacy-shell-close');
  const backdrop = shell.querySelector('.legacy-shell-backdrop');
  const setOpen = open => {
    document.documentElement.classList.toggle('legacy-shell-drawer-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
  };
  toggle.addEventListener('click', () => setOpen(!document.documentElement.classList.contains('legacy-shell-drawer-open')));
  close.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  shell.querySelectorAll('.legacy-shell a').forEach(link => link.addEventListener('click', () => setOpen(false)));
}

export function mountLegacyShell(identity) {
  if (document.querySelector('#legacyShell')) return;
  const shell = document.createElement('div');
  shell.className = 'legacy-shell-root';
  shell.innerHTML = shellMarkup(identity);
  document.body.prepend(shell);
  document.documentElement.classList.add('legacy-shell-active');
  bindUtilities(shell);
  bindAccountMenu(shell);
  bindDrawer(shell);
  syncActiveNavigation(shell);
  syncLegacyPresentation();
  mountUploadFlow();
  const presentationObserver = new MutationObserver(() => {
    syncLegacyPresentation();
    mountUploadFlow();
  });
  presentationObserver.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => syncActiveNavigation(shell));
}
