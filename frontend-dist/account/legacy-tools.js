const TOOL_ROUTES = {
  access: { key: 'access', frameKey: 'access', path: '/customerConfig', hash: '', title: '上传访问' },
  'system-upload': { key: 'system-upload', frameKey: 'system-upload', path: '/systemConfig', hash: '#upload', title: '存储渠道' },
  'system-page': { key: 'system-page', frameKey: 'system-page', path: '/systemConfig', hash: '#page', title: '网站设置' },
  'system-security': { key: 'system-security', frameKey: 'system-security', path: '/systemConfig', hash: '#security', title: '安全与自动化' },
  'system-status': { key: 'system-status', frameKey: 'system-status', path: '/systemConfig', hash: '#status', title: '维护工具' },
};

const TOOL_PREWARM_ORDER = ['access', 'system-upload', 'system-page', 'system-security', 'system-status'];
const main = document.querySelector('#mainContent');
const appShell = document.querySelector('.app-shell');
const frames = new Map();
let host = null;
let activeTool = TOOL_ROUTES[new URL(location.href).searchParams.get('tool')] || null;
let prewarmScheduled = false;
let prewarmStarted = false;

function toolFromHref(value) {
  let url;
  try { url = new URL(value, location.href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  if (url.pathname === '/customerConfig') return TOOL_ROUTES.access;
  if (url.pathname !== '/systemConfig') return null;
  const hash = url.hash || '#status';
  return Object.values(TOOL_ROUTES).find(tool => tool.path === '/systemConfig' && tool.hash === hash) || TOOL_ROUTES['system-status'];
}

function accountTargetFromHref(value) {
  let url;
  try { url = new URL(value, location.href); } catch { return null; }
  return url.origin === location.origin && /^\/account\/?$/.test(url.pathname) ? url : null;
}

function ensureHost() {
  if (host) return host;
  host = document.createElement('section');
  host.className = 'legacy-tool-host';
  host.id = 'legacyToolHost';
  host.hidden = true;
  host.setAttribute('aria-label', '管理工具');
  appShell?.append(host);
  return host;
}

function iframeSource(tool) {
  const url = new URL(tool.path, location.origin);
  url.searchParams.set('embedded', '1');
  url.hash = tool.hash;
  return `${url.pathname}${url.search}${url.hash}`;
}

function syncThemeIntoFrame(iframe) {
  try {
    const theme = document.documentElement.dataset.theme;
    if (theme) iframe.contentDocument?.documentElement?.setAttribute('data-theme', theme);
  } catch {}
}

function ensureFrame(tool) {
  if (frames.has(tool.frameKey)) return frames.get(tool.frameKey);

  const wrapper = document.createElement('div');
  wrapper.className = 'legacy-tool-frame';
  wrapper.dataset.toolFrame = tool.frameKey;
  wrapper.hidden = true;
  wrapper.innerHTML = '<div class="legacy-tool-first-load"><span></span><small>首次载入管理工具…</small></div>';

  const iframe = document.createElement('iframe');
  iframe.title = tool.title;
  iframe.loading = 'eager';
  iframe.src = iframeSource(tool);
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  iframe.addEventListener('load', () => {
    wrapper.classList.add('is-loaded');
    syncThemeIntoFrame(iframe);
  });

  wrapper.append(iframe);
  ensureHost().append(wrapper);
  const entry = { wrapper, iframe };
  frames.set(tool.frameKey, entry);
  return entry;
}

function hasToolNavigation() {
  return Boolean(document.querySelector('[data-shell-key="access"], [data-shell-key^="system-"]'));
}

function startToolPrewarm() {
  if (prewarmStarted || !hasToolNavigation()) return;
  prewarmStarted = true;

  TOOL_PREWARM_ORDER.forEach((key, index) => {
    window.setTimeout(() => {
      const tool = TOOL_ROUTES[key];
      if (tool) ensureFrame(tool);
    }, index * 140);
  });
}

function scheduleToolPrewarm() {
  if (prewarmStarted || prewarmScheduled || !hasToolNavigation()) return;
  prewarmScheduled = true;
  const run = () => {
    prewarmScheduled = false;
    startToolPrewarm();
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 450 });
  else window.setTimeout(run, 300);
}

function setActiveNav(key) {
  document.querySelectorAll('[data-shell-key]').forEach(link => {
    const active = link.dataset.shellKey === key;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function accountKeyFromUrl(url = new URL(location.href)) {
  const view = url.searchParams.get('view') || 'files';
  if (view !== 'admin') return view === 'albums' ? 'albums' : 'files';
  const section = url.searchParams.get('section') || 'content';
  return section === 'users' ? 'users' : section === 'audit' ? 'audit' : 'content';
}

function accountTitleFromUrl(url = new URL(location.href)) {
  const key = accountKeyFromUrl(url);
  return ({ files: '我的文件', albums: '我的图库', content: '内容管理', audit: '操作记录', users: '成员管理' })[key] || '我的文件';
}

function applyToolChrome(tool) {
  setActiveNav(tool.key);
  document.title = `${tool.title} · CloudFlare ImgBed`;
}

function restoreAccountChrome(url = new URL(location.href)) {
  setActiveNav(accountKeyFromUrl(url));
  document.title = `${accountTitleFromUrl(url)} · CloudFlare ImgBed`;
}

function buildParentToolUrl(tool) {
  const current = new URL(location.href);
  const url = new URL('/account/', location.origin);
  const view = ['files', 'albums', 'admin'].includes(current.searchParams.get('view')) ? current.searchParams.get('view') : 'files';
  url.searchParams.set('view', view);
  if (view === 'admin') {
    const section = ['content', 'users', 'audit'].includes(current.searchParams.get('section')) ? current.searchParams.get('section') : 'content';
    url.searchParams.set('section', section);
  }
  url.searchParams.set('tool', tool.key);
  return url;
}

function showTool(tool, { historyMode = 'push' } = {}) {
  if (!tool) return;
  activeTool = tool;
  const currentHost = ensureHost();
  const entry = ensureFrame(tool);
  frames.forEach(frame => { frame.wrapper.hidden = frame !== entry; });
  if (main) main.hidden = true;
  currentHost.hidden = false;
  applyToolChrome(tool);
  const url = buildParentToolUrl(tool);
  if (historyMode === 'push') nativePush(history.state, '', url);
  else if (historyMode === 'replace') nativeReplace(history.state, '', url);
}

function hideTool(url = new URL(location.href)) {
  activeTool = null;
  if (host) host.hidden = true;
  if (main) main.hidden = false;
  restoreAccountChrome(url);
}

const nativeReplace = history.replaceState.bind(history);
const nativePush = history.pushState.bind(history);
history.replaceState = (state, title, value) => {
  if (!activeTool || !value) return nativeReplace(state, title, value);
  try {
    const url = new URL(value, location.href);
    if (/^\/account\/?$/.test(url.pathname)) url.searchParams.set('tool', activeTool.key);
    return nativeReplace(state, title, url);
  } catch {
    return nativeReplace(state, title, value);
  }
};

document.addEventListener('pointerover', event => {
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  const tool = toolFromHref(link.href);
  if (tool) ensureFrame(tool);
}, true);

document.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href]');
  if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

  const tool = toolFromHref(link.href);
  if (tool) {
    event.preventDefault();
    showTool(tool);
    return;
  }

  if (activeTool) {
    const target = accountTargetFromHref(link.href);
    if (target) hideTool(target);
  }
}, true);

window.addEventListener('popstate', () => {
  const url = new URL(location.href);
  const tool = TOOL_ROUTES[url.searchParams.get('tool')];
  if (tool) showTool(tool, { historyMode: 'none' });
  else if (activeTool) hideTool(url);
});

window.addEventListener('storage', event => {
  if (event.key !== 'imgbed-theme') return;
  frames.forEach(({ iframe }) => syncThemeIntoFrame(iframe));
});

const shellObserver = new MutationObserver(() => {
  scheduleToolPrewarm();
  if (!activeTool) return;
  if (main) main.hidden = true;
  applyToolChrome(activeTool);
});
shellObserver.observe(document.body, { childList: true, subtree: true });

scheduleToolPrewarm();
if (activeTool) requestAnimationFrame(() => showTool(activeTool, { historyMode: 'replace' }));
