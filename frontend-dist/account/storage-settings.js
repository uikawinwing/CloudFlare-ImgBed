import { refreshSiteConfig } from '../site-config.js';

const allowedRoles = new Set(['admin', 'owner']);
const panels = {
  'system-upload': { title: '存储渠道', description: '管理 Telegram、Discord、R2 与 Hugging Face 的保存渠道。' },
  'system-others': { title: '其他设置', description: '管理站点功能与缓存清理。' },
  'system-wallpaper': { title: '欢迎页壁纸', description: '设置欢迎页的壁纸、播放顺序和裁切位置。' },
  'system-page': { title: '网站设置', description: '管理站点品牌、公开链接和工作区壁纸。' },
  'system-security': { title: '安全与自动化', description: '管理内容审查、文件访问与管理接口令牌。' },
};
const channelTypes = {
  telegram: { label: 'Telegram', fields: [['name', '渠道名称', 'text'], ['botToken', 'Bot Token', 'secret'], ['chatId', '聊天 ID', 'text'], ['proxyUrl', '代理域名（可选）', 'text']] },
  cfr2: { label: 'Cloudflare R2', fields: [['name', '渠道名称', 'text'], ['publicUrl', '公开访问地址', 'url'], ['quota', '容量限制', 'quota']] },
  discord: { label: 'Discord', fields: [['name', '渠道名称', 'text'], ['botToken', 'Bot Token', 'secret'], ['channelId', '频道 ID', 'text'], ['proxyUrl', '代理域名（可选）', 'text']] },
  huggingface: { label: 'Hugging Face', fields: [['name', '渠道名称', 'text'], ['token', 'Access Token', 'secret'], ['repo', '仓库名称', 'text']] },
};

const state = { host: null, user: null, upload: null, others: null, wallpaper: null, page: null, pageChanges: {}, security: null, securityChanges: {}, tokens: [], tokenDrafts: {}, createdToken: '', dirty: false, saving: false, activeKey: null, loadId: 0 };

const securityGroups = [
  { title: '图像审查', description: '上传时调用所选服务。审查结果会影响文件的公开访问；Discord 渠道审查失败时会隔离文件。', fields: [
    ['upload.moderate.enabled', '启用图像审查', 'boolean'],
    ['upload.moderate.channel', '审查服务', 'select', [['moderatecontent.com', 'ModerateContent'], ['nsfwjs', '自建 NSFW 服务']]],
    ['upload.moderate.moderateContentApiKey', 'ModerateContent API Key', 'secret'],
    ['upload.moderate.nsfwApiPath', '自建审查服务地址', 'url'],
  ] },
  { title: '上传地点记录', description: '通过自定义服务查询上传 IP 的地点；启用后会将上传 IP 发送给所配置的服务。', fields: [
    ['upload.ipQuery.enabled', '记录上传地点', 'boolean'],
    ['upload.ipQuery.customApi.url', '查询服务地址', 'url'],
    ['upload.ipQuery.customApi.responseFields', '地点字段', 'lines', '每行填写一个响应字段路径，例如 country 或 data.city。'],
  ] },
  { title: '文件访问', description: '设置文件防盗链、白名单和动态图片尺寸。', fields: [
    ['access.allowedDomains', '允许引用文件的域名', 'text', '多个域名用逗号分隔；留空不限制。'],
    ['access.whiteListMode', '公开访问仅限白名单文件（影响全部文件）', 'boolean'],
    ['access.imageTransformEnabled', '启用动态图片变换', 'boolean'],
    ['access.imageTransformAllowedSizes', '允许变换的尺寸', 'text', '用逗号分隔，例如 800x600,autox400；留空不限制尺寸组合。'],
  ] },
];
const tokenPermissions = [['list', '列出文件'], ['delete', '删除文件'], ['manage', '管理设置']];

function securityValue(path) {
  return Object.hasOwn(state.securityChanges, path) ? state.securityChanges[path] : path.split('.').reduce((value, key) => value?.[key], state.security);
}

function securityFieldMarkup([path, label, kind, help]) {
  const value = securityValue(path), id = `security-${path.replaceAll('.', '-')}`;
  const common = `id="${id}" data-security-field="${path}" aria-describedby="securitySettingsStatus ${id}-help"`;
  if (kind === 'boolean') return `<label class="native-check"><input ${common} type="checkbox"${value ? ' checked' : ''}> ${label}<small id="${id}-help"></small></label>`;
  let control;
  if (kind === 'select') control = `<select ${common}>${help.map(([key, title]) => `<option value="${key}"${value === key ? ' selected' : ''}>${title}</option>`).join('')}</select>`;
  else if (kind === 'lines') control = `<textarea ${common} rows="3">${escapeHtml((value || []).join('\n'))}</textarea>`;
  else control = `<span class="native-secret-field"><input ${common} type="${kind === 'secret' ? 'password' : kind}" value="${escapeHtml(value || '')}"${kind === 'secret' ? ' autocomplete="off"' : ''}>${kind === 'secret' ? '<button type="button" class="native-secret-toggle" data-secret-toggle aria-pressed="false" aria-label="显示审查服务密钥">显示</button>' : ''}</span>`;
  return `<label class="native-settings-field" for="${id}"><span>${label}</span>${control}<small id="${id}-help">${escapeHtml(typeof help === 'string' ? help : '')}</small></label>`;
}

function tokenEditorMarkup(token = {}) {
  const id = token.id || 'new', draft = state.tokenDrafts[id] || token;
  return `<form class="native-token-editor" data-token-editor="${escapeHtml(id)}"><div class="native-settings-fields site-settings-fields">${id === 'new' ? `<label class="native-settings-field"><span>令牌名称</span><input name="name" required maxlength="80" value="${escapeHtml(draft.name || '')}" autocomplete="off"></label>` : ''}<label class="native-settings-field"><span>到期时间（可选）</span><input name="expiresAt" type="datetime-local" value="${escapeHtml(draft.localExpiry ?? localExpiry(token.expiresAt))}"><small>留空表示长期有效。</small></label></div><fieldset class="native-token-permissions"><legend>管理接口权限</legend>${tokenPermissions.map(([permission, label]) => `<label class="native-check"><input type="checkbox" name="permission" value="${permission}"${draft.permissions?.includes(permission) ? ' checked' : ''}> ${label}</label>`).join('')}</fieldset><p>令牌用于管理接口，不能代替成员的 Discord 登录上传。</p><button class="button" type="submit">${id === 'new' ? '创建令牌' : '保存令牌权限'}</button></form>`;
}

function localExpiry(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function securityMarkup() {
  const params = securityValue('upload.ipQuery.customApi.params') || [];
  return `<main class="native-settings-main"><section class="page-section native-settings-page"><header class="page-head"><div class="page-title"><h1>安全与自动化</h1><p>成员通过 Discord 登录；管理员权限在成员管理中分配。</p></div><button type="button" class="button primary" data-save-settings${state.dirty ? '' : ' disabled'}>保存更改</button></header>${renderTabNav()}<div id="securitySettingsStatus" class="native-settings-status" aria-live="polite"></div>${securityGroups.map(group => `<section class="native-settings-section"><h2>${group.title}</h2><p>${group.description}</p><div class="native-settings-fields site-settings-fields">${group.fields.filter(([path]) => !path.includes('moderateContentApiKey') || securityValue('upload.moderate.channel') === 'moderatecontent.com').filter(([path]) => !path.includes('nsfwApiPath') || securityValue('upload.moderate.channel') === 'nsfwjs').map(securityFieldMarkup).join('')}</div>${group.title === '上传地点记录' ? `<div class="native-ip-params"><h3>查询参数</h3><p>参数值中可用 {ip} 代入上传 IP；服务地址也支持 {ip}。</p>${params.map((param, index) => `<div class="native-ip-param" data-ip-param="${index}"><label class="native-settings-field"><span>参数名称</span><input data-ip-param-key value="${escapeHtml(param.key)}"></label><label class="native-settings-field"><span>参数值</span><input data-ip-param-value value="${escapeHtml(param.value)}"></label><button type="button" class="button" data-remove-ip-param="${index}" aria-label="移除查询参数 ${index + 1}">移除</button></div>`).join('')}<button type="button" class="button" data-add-ip-param>添加参数</button></div>` : ''}</section>`).join('')}<section class="native-settings-section"><h2>管理 API Token</h2><p>供脚本或外部工具调用管理接口。只授予需要的权限；完整令牌仅在创建后显示一次。</p><div class="native-channel-list">${state.tokens.length ? state.tokens.map(token => `<article class="native-channel-card"><header><div><h3>${escapeHtml(token.name)}</h3><p>${token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now() ? '已到期' : '有效'} · ${token.expiresAt ? escapeHtml(new Date(token.expiresAt).toLocaleString()) : '长期有效'}</p></div><button type="button" class="button danger" data-revoke-token="${escapeHtml(token.id)}">撤销令牌</button></header><code>${escapeHtml(token.token)}</code><details><summary>调整权限与到期时间</summary>${tokenEditorMarkup(token)}</details></article>`).join('') : '<div class="native-empty">尚未创建管理令牌。使用 Discord 网页功能无需创建令牌。</div>'}</div><details class="native-token-create"${state.tokenDrafts.new ? ' open' : ''}><summary>创建管理令牌</summary>${tokenEditorMarkup()}</details>${state.createdToken ? `<div class="native-token-result"><label class="native-settings-field"><span>新令牌，请立即复制并妥善保存</span><input data-created-token type="password" readonly autocomplete="off" value="${escapeHtml(state.createdToken)}"></label><button type="button" class="button" data-copy-created-token>复制令牌</button></div>` : ''}</section></section></main>`;
}

function validateSecuritySettings() {
  for (const path of ['upload.moderate.nsfwApiPath', 'upload.ipQuery.customApi.url']) {
    const value = securityValue(path);
    const active = path.includes('nsfwApiPath') ? securityValue('upload.moderate.enabled') && securityValue('upload.moderate.channel') === 'nsfwjs' : securityValue('upload.ipQuery.enabled');
    if (!active && !Object.hasOwn(state.securityChanges, path)) continue;
    if (value && !/^https?:\/\//i.test(value)) return { id: path, message: '服务地址须以 http:// 或 https:// 开头。' };
    if (value) { try { const url = new URL(value); if (url.username || url.password) throw new Error(); } catch { return { id: path, message: '服务地址格式不正确。' }; } }
  }
  if (securityValue('upload.moderate.enabled')) {
    const path = securityValue('upload.moderate.channel') === 'nsfwjs' ? 'upload.moderate.nsfwApiPath' : 'upload.moderate.moderateContentApiKey';
    if (!String(securityValue(path) || '').trim()) return { id: path, message: '启用审查前，请填写所选服务的地址或密钥。' };
  }
  if (securityValue('upload.ipQuery.enabled') && (!securityValue('upload.ipQuery.customApi.url') || !securityValue('upload.ipQuery.customApi.responseFields')?.length)) return { id: 'upload.ipQuery.customApi.url', message: '启用地点记录前，请填写查询服务地址与地点字段。' };
  return null;
}

function securityFieldError(error) {
  const input = state.host.querySelector(`[data-security-field="${error.id}"]`);
  input?.setAttribute('aria-invalid', 'true');
  input?.focus();
  setStatus(error.message, 'error');
}

async function changeToken(options) {
  if (state.saving) return;
  state.saving = true;
  saveButton(true);
  const loadId = state.loadId;
  try {
    const result = await api('/api/manage/apiTokens' + (options.id ? `?id=${encodeURIComponent(options.id)}` : ''), { method: options.method, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    if (result.error) throw new Error(result.error);
    if (loadId !== state.loadId) return;
    if (options.method === 'POST') {
      state.createdToken = result.token;
      state.tokens.push({ ...result, token: result.token.slice(0, 15) + '...' });
    } else if (options.method === 'DELETE') {
      state.createdToken = '';
      state.tokens = state.tokens.filter(token => token.id !== options.id);
    } else {
      Object.assign(state.tokens.find(token => token.id === options.id), options.body);
    }
    delete state.tokenDrafts[options.id || 'new'];
    render();
    setStatus('令牌已更新。', 'success');
  } catch (error) {
    if (loadId === state.loadId) setStatus(error.message || '令牌操作失败，请重试。', 'error');
  } finally { state.saving = false; saveButton(false); }
}

function bindSecurityEvents() {
  state.host.querySelectorAll('[data-security-field]').forEach(input => input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
    const path = input.dataset.securityField;
    state.securityChanges[path] = input.type === 'checkbox' ? input.checked : input.tagName === 'TEXTAREA' ? input.value.split('\n').map(line => line.trim()).filter(Boolean) : input.value;
    if (path.startsWith('upload.ipQuery.')) state.securityChanges['upload.ipQuery.channel'] = 'customApi';
    input.removeAttribute('aria-invalid');
    markDirty();
    if (path === 'upload.moderate.channel') { render(); state.host.querySelector(`[data-security-field="${path}"]`)?.focus(); }
  }));
  const changeParams = change => { const params = structuredClone(securityValue('upload.ipQuery.customApi.params') || []); change(params); state.securityChanges['upload.ipQuery.customApi.params'] = params; state.securityChanges['upload.ipQuery.channel'] = 'customApi'; markDirty(); };
  state.host.querySelectorAll('[data-ip-param]').forEach(row => row.querySelectorAll('input').forEach(input => input.addEventListener('input', () => changeParams(params => { params[Number(row.dataset.ipParam)] = { key: row.querySelector('[data-ip-param-key]').value, value: row.querySelector('[data-ip-param-value]').value }; }))));
  state.host.querySelector('[data-add-ip-param]')?.addEventListener('click', () => { changeParams(params => params.push({ key: '', value: '' })); render(); state.host.querySelectorAll('[data-ip-param-key]')[securityValue('upload.ipQuery.customApi.params').length - 1]?.focus(); });
  state.host.querySelectorAll('[data-remove-ip-param]').forEach(button => button.addEventListener('click', () => { changeParams(params => params.splice(Number(button.dataset.removeIpParam), 1)); render(); state.host.querySelector('[data-add-ip-param]')?.focus(); }));
  state.host.querySelectorAll('[data-token-editor]').forEach(form => {
    const draft = () => ({ name: form.elements.namedItem('name')?.value.trim(), permissions: [...form.querySelectorAll('[name="permission"]:checked')].map(input => input.value), localExpiry: form.elements.namedItem('expiresAt').value });
    form.addEventListener('input', () => { state.tokenDrafts[form.dataset.tokenEditor] = draft(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = draft(), id = form.dataset.tokenEditor;
      const existing = state.tokens.find(token => token.id === id);
      const permissions = [...value.permissions, ...(existing?.permissions?.includes('upload') ? ['upload'] : [])];
      if (!permissions.length) { setStatus('请至少选择一项令牌权限。', 'error'); return; }
      const expiresAt = value.localExpiry ? new Date(value.localExpiry).toISOString() : null;
      if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) { setStatus('请选择将来的到期时间。', 'error'); return; }
      changeToken({ method: id === 'new' ? 'POST' : 'PUT', ...(id === 'new' ? {} : { id }), body: { ...(id === 'new' ? { name: value.name, owner: state.user.id || state.user.discord_id } : { tokenId: id }), permissions, expiresAt, autoDelete: existing?.autoDelete || false } });
    });
  });
  state.host.querySelectorAll('[data-revoke-token]').forEach(button => button.addEventListener('click', () => { if (window.confirm('撤销后，使用此令牌的脚本将无法继续访问。确定撤销？')) changeToken({ method: 'DELETE', id: button.dataset.revokeToken }); }));
  state.host.querySelector('[data-copy-created-token]')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.createdToken); setStatus('令牌已复制。', 'success'); } catch { const input = state.host.querySelector('[data-created-token]'); input.type = 'text'; input.focus(); input.select(); setStatus('无法自动复制，请手动复制上方令牌。', 'error'); } });
}

const siteGroups = [
  { title: '站点品牌', description: '应用于欢迎页、Discover、文件工作区和 CharInfo。', ids: ['siteTitle', 'ownerName', 'siteIcon', 'logoUrl', 'logoLink'] },
  { title: '上传与公开链接', description: '选择上传渠道，并设置复制文件链接时使用的地址。', ids: ['defaultUploadChannel', 'defaultChannelName', 'urlPrefix'] },
  { title: '工作区壁纸', description: '用于文件、图库及内容管理。欢迎页壁纸在独立队列中管理。', ids: ['wallpaperEnabled', 'uploadBkImg', 'adminBkImg', 'bkInterval', 'bkOpacity'] },
];

function siteFieldValue(field) {
  return Object.hasOwn(state.pageChanges, field.id) ? state.pageChanges[field.id] : field.value ?? field.default ?? '';
}

function wallpaperLines(value) {
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.join('\n'); } catch {}
  }
  return String(value || '');
}

function siteFieldMarkup(field) {
  const value = siteFieldValue(field), id = `site-setting-${field.id}`;
  const tooltip = String(field.tooltip || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '');
  const common = `id="${id}" data-site-setting="${field.id}" aria-describedby="${id}-help siteSettingsStatus"`;
  if (field.type === 'boolean') return `<label class="native-check"><input ${common} type="checkbox"${value === true || value === 'true' ? ' checked' : ''}> ${escapeHtml(field.label)}<small id="${id}-help">${escapeHtml(tooltip)}</small></label>`;
  let control;
  if (['uploadBkImg', 'adminBkImg'].includes(field.id)) {
    control = `<textarea ${common} rows="3" placeholder="每行填写一个公开图片地址">${escapeHtml(wallpaperLines(value))}</textarea>`;
  } else if (field.type === 'select') {
    control = `<select ${common}>${(field.options || []).map(option => `<option value="${escapeHtml(option.value)}"${String(value || field.placeholder) === String(option.value) ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
  } else {
    const number = ['bkInterval', 'bkOpacity'].includes(field.id);
    const type = number ? 'number' : ['siteIcon', 'logoUrl', 'logoLink', 'urlPrefix'].includes(field.id) ? 'url' : 'text';
    const constraints = field.id === 'bkInterval' ? ' min="1000" max="3600000" step="1000"' : field.id === 'bkOpacity' ? ' min="0" max="1" step="0.05"' : '';
    control = `<input ${common} type="${type}"${constraints} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}">`;
  }
  const help = ['uploadBkImg', 'adminBkImg'].includes(field.id) ? '每行一张，按顺序轮播；留空使用默认背景。' : tooltip;
  return `<label class="native-settings-field" for="${id}"><span>${escapeHtml(field.label)}</span>${control}<small id="${id}-help">${escapeHtml(help)}</small></label>`;
}

function pageMarkup() {
  const fields = new Map((state.page.config || []).map(field => [field.id, field]));
  return `<main class="native-settings-main"><section class="page-section native-settings-page"><header class="page-head"><div class="page-title"><h1>网站设置</h1><p>修改品牌、上传渠道、公开链接及工作区背景。</p></div><button type="button" class="button primary" data-save-settings${state.dirty ? '' : ' disabled'}>保存更改</button></header>${renderTabNav()}<div id="siteSettingsStatus" class="native-settings-status" aria-live="polite"></div>${siteGroups.map(group => `<section class="native-settings-section"><h2>${group.title}</h2><p>${group.description}</p><div class="native-settings-fields site-settings-fields">${group.ids.filter(id => fields.has(id)).map(id => siteFieldMarkup(fields.get(id))).join('')}</div></section>`).join('')}<a class="button" href="${currentToolUrl('system-wallpaper')}">管理欢迎页壁纸</a></section></main>`;
}

function validateSiteSettings() {
  for (const [id, value] of Object.entries(state.pageChanges)) {
    if (value === '') continue;
    let message = '';
    if (['siteIcon', 'logoUrl', 'logoLink', 'urlPrefix'].includes(id) && !wallpaperUrl(value)) message = '请填写 http://、https:// 或本站绝对路径。';
    if (id === 'urlPrefix' && /[?#]/.test(value)) message = '文件链接前缀不能包含查询参数或片段，请填写纯路径前缀。';
    if (['uploadBkImg', 'adminBkImg'].includes(id) && value.some(url => !wallpaperUrl(url))) message = '壁纸地址无效，请每行填写一个公开图片地址。';
    if (id === 'bkInterval' && (!Number.isFinite(value) || value < 1000 || value > 3600000)) message = '切换间隔须为 1000–3600000 毫秒。';
    if (id === 'bkOpacity' && (!Number.isFinite(value) || value < 0 || value > 1)) message = '不透明度须介于 0 和 1 之间。';
    if (message) return { id, message };
  }
  return null;
}

function siteFieldError(error) {
  const input = state.host.querySelector(`[data-site-setting="${error.id}"]`);
  input?.setAttribute('aria-invalid', 'true');
  input?.focus();
  setStatus(error.message, 'error');
}

function bindSiteEvents() {
  state.host.querySelectorAll('[data-site-setting]').forEach(input => input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (['uploadBkImg', 'adminBkImg'].includes(input.dataset.siteSetting)) value = input.value.split('\n').map(line => line.trim()).filter(Boolean);
    else if (input.type === 'number' && value !== '') value = Number(value);
    state.pageChanges[input.dataset.siteSetting] = value;
    input.removeAttribute('aria-invalid');
    markDirty();
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const body = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof body === 'object' ? body.error : body);
    error.status = response.status;
    error.field = typeof body === 'object' ? body.field : null;
    throw error;
  }
  return body;
}

function notify(message, type = '') {
  const region = document.querySelector('#toastRegion');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 3800);
}

function currentToolUrl(key) {
  const url = new URL('/account/', location.origin);
  const current = new URL(location.href);
  const view = ['files', 'albums', 'admin'].includes(current.searchParams.get('view')) ? current.searchParams.get('view') : 'files';
  url.searchParams.set('view', view);
  if (view === 'albums' && current.searchParams.get('album')) url.searchParams.set('album', current.searchParams.get('album'));
  if (view === 'admin' && current.searchParams.get('section')) url.searchParams.set('section', current.searchParams.get('section'));
  url.searchParams.set('tool', key);
  return url.pathname + url.search;
}

function renderLoading() {
  state.host.innerHTML = '<main class="native-settings-main"><div class="loading-state"><span class="spinner" aria-hidden="true"></span><p>正在读取设置…</p></div></main>';
}

function renderError(message, retry = true) {
  state.host.innerHTML = `<main class="native-settings-main"><div class="error-state"><h2>无法读取设置</h2><p>${escapeHtml(message || '请求失败，请稍后重试。')}</p>${retry ? '<button type="button" class="button primary" data-settings-retry>重新加载</button>' : ''}</div></main>`;
  state.host.querySelector('[data-settings-retry]')?.addEventListener('click', () => show({ key: state.activeKey, host: state.host }));
}

function renderTabNav() {
  return `<nav class="native-settings-tabs" aria-label="系统设置">${Object.entries(panels).map(([key, panel]) => `<a href="${currentToolUrl(key)}" class="${state.activeKey === key ? 'active' : ''}"${state.activeKey === key ? ' aria-current="page"' : ''}>${panel.title}</a>`).join('')}</nav>`;
}

function wallpaperUrl(value) {
  if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u001f\u007f]/.test(value)) return '';
  const url = value.trim();
  if (!/^https?:\/\//i.test(url) && (!url.startsWith('/') || url.startsWith('//'))) return '';
  try { return ['http:', 'https:'].includes(new URL(url, location.origin).protocol) ? url : ''; } catch { return ''; }
}

function readWallpaper(settings) {
  const value = settings.config?.find(item => item.id === 'welcomeWallpaper')?.value;
  const wallpaper = typeof value === 'string' ? JSON.parse(value) : value;
  if (!wallpaper || !Array.isArray(wallpaper.items)) throw new Error('欢迎页壁纸配置不完整，请重新加载。');
  return wallpaper;
}

function wallpaperCard(item, index) {
  const url = wallpaperUrl(item.url);
  const positions = [['positionX', '桌面水平位置'], ['positionY', '桌面垂直位置'], ['mobilePositionX', '手机水平位置'], ['mobilePositionY', '手机垂直位置']];
  return `<article class="native-channel-card wallpaper-card" data-wallpaper-card="${index}">
    <header><h3>壁纸 ${index + 1}</h3><div class="wallpaper-order"><button type="button" class="button" data-wallpaper-move="${index}" data-direction="-1" aria-label="上移壁纸 ${index + 1}"${index === 0 ? ' disabled' : ''}>上移</button><button type="button" class="button" data-wallpaper-move="${index}" data-direction="1" aria-label="下移壁纸 ${index + 1}"${index === state.wallpaper.items.length - 1 ? ' disabled' : ''}>下移</button><button type="button" class="button danger" data-wallpaper-remove="${index}" aria-label="移除壁纸 ${index + 1}">移除</button></div></header>
    <label class="native-settings-field wallpaper-url"><span>图片地址</span><input type="url" data-wallpaper-url="${index}" aria-describedby="wallpaperStatus" value="${escapeHtml(item.url)}" placeholder="https://example.com/wallpaper.jpg"><small>使用可公开访问的图片地址，或本站图片路径。</small></label>
    <details class="wallpaper-crop"><summary>预览与调整裁切</summary><div class="wallpaper-previews"><figure><figcaption>桌面</figcaption><div class="wallpaper-preview"><img data-wallpaper-preview="desktop" alt="壁纸 ${index + 1} 的桌面裁切预览"${url ? ` src="${escapeHtml(url)}"` : ' hidden'} loading="lazy" referrerpolicy="no-referrer" style="object-position:${Number(item.positionX)}% ${Number(item.positionY)}%"></div></figure><figure><figcaption>手机</figcaption><div class="wallpaper-preview is-mobile"><img data-wallpaper-preview="mobile" alt="壁纸 ${index + 1} 的手机裁切预览"${url ? ` src="${escapeHtml(url)}"` : ' hidden'} loading="lazy" referrerpolicy="no-referrer" style="object-position:${Number(item.mobilePositionX)}% ${Number(item.mobilePositionY)}%"></div></figure></div><p data-wallpaper-preview-error hidden>图片暂时无法载入，请检查地址与访问权限。</p><div class="native-settings-fields">${positions.map(([key, label]) => `<label class="native-settings-field"><span>${label} <output data-position-value="${key}">${Number(item[key])}%</output></span><input type="range" min="0" max="100" step="1" data-wallpaper-position="${key}" data-wallpaper-index="${index}" value="${Number(item[key])}"></label>`).join('')}</div></details>
  </article>`;
}

function wallpaperMarkup() {
  const value = state.wallpaper;
  return `<main class="native-settings-main"><section class="page-section native-settings-page"><header class="page-head"><div class="page-title"><h1>欢迎页壁纸</h1><p>按列表顺序循环播放；只有一张时保持静止。这里的设置只影响欢迎页。</p></div><button type="button" class="button primary" data-save-settings>保存更改</button></header>${renderTabNav()}<div id="wallpaperStatus" class="native-settings-status" aria-live="polite"></div>
    <section class="native-settings-section"><h2>播放设置</h2><div class="native-settings-fields"><label class="native-check"><input type="checkbox" data-wallpaper-enabled${value.enabled ? ' checked' : ''}> 启用欢迎页壁纸</label><label class="native-settings-field"><span>切换间隔（秒）</span><input type="number" min="5" max="3600" step="1" inputmode="numeric" data-wallpaper-interval aria-describedby="wallpaperStatus" value="${escapeHtml(value.intervalSeconds)}"><small>可设置 5–3600 秒。</small></label><label class="native-settings-field"><span>壁纸不透明度 <output data-opacity-value>${Math.round(value.opacity * 100)}%</output></span><input type="range" min="0" max="100" step="1" data-wallpaper-opacity value="${Math.round(value.opacity * 100)}"><small>文字遮罩会保留，避免影响阅读。</small></label></div></section>
    <section class="native-settings-section"><div class="native-settings-section-head"><div><h2>壁纸队列</h2><p>最多 20 张。使用上移、下移调整顺序；清空队列或关闭壁纸会显示纯色背景。</p></div><button type="button" class="button" data-wallpaper-add${value.items.length >= 20 ? ' disabled' : ''}>添加壁纸</button></div><div class="native-channel-list">${value.items.length ? value.items.map(wallpaperCard).join('') : '<div class="native-empty">队列为空，欢迎页将使用纯色背景。</div>'}</div></section>
  </section></main>`;
}

function validateWallpaper() {
  if (!Number.isInteger(state.wallpaper.intervalSeconds) || state.wallpaper.intervalSeconds < 5 || state.wallpaper.intervalSeconds > 3600) return { selector: '[data-wallpaper-interval]', message: '切换间隔须为 5–3600 秒的整数。' };
  const index = state.wallpaper.items.findIndex(item => !wallpaperUrl(item.url));
  if (index !== -1) return { selector: `[data-wallpaper-url="${index}"]`, message: `壁纸 ${index + 1} 的地址无效，请使用 http://、https:// 或本站图片路径。` };
  return null;
}

function bindWallpaperEvents() {
  const focusItem = index => state.host.querySelector(`[data-wallpaper-url="${index}"]`)?.focus();
  state.host.querySelector('[data-wallpaper-enabled]')?.addEventListener('change', event => { state.wallpaper.enabled = event.target.checked; markDirty(); });
  state.host.querySelector('[data-wallpaper-interval]')?.addEventListener('input', event => { state.wallpaper.intervalSeconds = event.target.value === '' ? null : Number(event.target.value); event.target.removeAttribute('aria-invalid'); markDirty(); });
  state.host.querySelector('[data-wallpaper-opacity]')?.addEventListener('input', event => {
    state.wallpaper.opacity = Number(event.target.value) / 100;
    state.host.querySelector('[data-opacity-value]').textContent = `${event.target.value}%`;
    state.host.querySelectorAll('.wallpaper-preview img').forEach(image => { image.style.opacity = String(state.wallpaper.opacity); });
    markDirty();
  });
  state.host.querySelector('[data-wallpaper-add]')?.addEventListener('click', () => {
    if (state.wallpaper.items.length >= 20) return;
    state.wallpaper.items.push({ url: '', positionX: 50, positionY: 50, mobilePositionX: 60, mobilePositionY: 0 });
    markDirty(); render(); focusItem(state.wallpaper.items.length - 1);
  });
  state.host.querySelectorAll('[data-wallpaper-remove]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.wallpaperRemove);
    state.wallpaper.items.splice(index, 1);
    markDirty(); render();
    if (state.wallpaper.items.length) focusItem(Math.min(index, state.wallpaper.items.length - 1));
    else state.host.querySelector('[data-wallpaper-add]')?.focus();
  }));
  state.host.querySelectorAll('[data-wallpaper-move]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.wallpaperMove), target = index + Number(button.dataset.direction);
    if (target < 0 || target >= state.wallpaper.items.length) return;
    [state.wallpaper.items[index], state.wallpaper.items[target]] = [state.wallpaper.items[target], state.wallpaper.items[index]];
    markDirty(); render(); focusItem(target);
  }));
  state.host.querySelectorAll('[data-wallpaper-url]').forEach(input => input.addEventListener('input', () => {
    state.wallpaper.items[Number(input.dataset.wallpaperUrl)].url = input.value;
    input.removeAttribute('aria-invalid'); markDirty();
  }));
  state.host.querySelectorAll('[data-wallpaper-url]').forEach(input => input.addEventListener('change', () => {
    const card = input.closest('[data-wallpaper-card]'), url = wallpaperUrl(input.value);
    card.querySelector('[data-wallpaper-preview-error]').hidden = true;
    card.querySelectorAll('img').forEach(image => { image.hidden = !url; if (url) image.src = url; else image.removeAttribute('src'); });
  }));
  state.host.querySelectorAll('.wallpaper-preview img').forEach(image => {
    image.style.opacity = String(state.wallpaper.opacity);
    image.addEventListener('error', () => { image.closest('[data-wallpaper-card]').querySelector('[data-wallpaper-preview-error]').hidden = false; });
    image.addEventListener('load', () => { image.closest('[data-wallpaper-card]').querySelector('[data-wallpaper-preview-error]').hidden = true; });
  });
  state.host.querySelectorAll('[data-wallpaper-position]').forEach(input => input.addEventListener('input', () => {
    const item = state.wallpaper.items[Number(input.dataset.wallpaperIndex)], key = input.dataset.wallpaperPosition;
    item[key] = Number(input.value);
    const card = input.closest('[data-wallpaper-card]');
    card.querySelector(`[data-position-value="${key}"]`).textContent = `${item[key]}%`;
    card.querySelector('[data-wallpaper-preview="desktop"]').style.objectPosition = `${item.positionX}% ${item.positionY}%`;
    card.querySelector('[data-wallpaper-preview="mobile"]').style.objectPosition = `${item.mobilePositionX}% ${item.mobilePositionY}%`;
    markDirty();
  }));
}

function fixedField(type, field) {
  if (type === 'cfr2') return ['publicUrl', 'quota'].includes(field);
  if (type === 'huggingface') return field === 'isPrivate';
  return field === 'proxyUrl';
}

function fieldMarkup(type, channel, index, [field, label, kind]) {
  if (channel.fixed && !fixedField(type, field)) return '';
  if (field === 'proxyUrl') return `<label class="native-settings-field"><span>${label}</span><input data-channel-field="${field}" data-channel-type="${type}" data-channel-index="${index}" type="${kind}" value="${escapeHtml(channel[field] ?? '')}"><small>只填域名或主机加端口，例如 proxy.example.com:1080。</small></label>`;
  if (field === 'quota') return quotaMarkup(channel, index);
  const inputType = kind === 'secret' ? 'password' : kind;
  const secretToggle = kind === 'secret' ? '<button type="button" class="native-secret-toggle" data-secret-toggle aria-pressed="false">显示</button>' : '';
  return `<label class="native-settings-field"><span>${label}</span><span class="native-secret-field"><input data-channel-field="${field}" data-channel-type="${type}" data-channel-index="${index}" type="${inputType}"${kind === 'secret' ? ' autocomplete="off"' : ''} value="${escapeHtml(channel[field] ?? '')}">${secretToggle}</span></label>`;
}

function quotaMarkup(channel, index) {
  const quota = channel.quota && typeof channel.quota === 'object' ? channel.quota : { enabled: false, limitGB: 10, threshold: 95 };
  return `<fieldset class="native-quota-fields"><legend>R2 容量限制</legend><p>仅 R2 使用。使用量达到容量上限的设定百分比时，此渠道会从新的上传选择中排除。</p><label class="native-check"><input data-quota-field="enabled" data-channel-index="${index}" type="checkbox"${quota.enabled ? ' checked' : ''}> 启用容量限制</label><div><label class="native-settings-field"><span>容量上限（GB）</span><input data-quota-field="limitGB" data-channel-index="${index}" type="number" min="0" step="0.1" inputmode="decimal" value="${escapeHtml(quota.limitGB ?? '')}"></label><label class="native-settings-field"><span>使用阈值（%）</span><input data-quota-field="threshold" data-channel-index="${index}" type="number" min="0" max="100" step="1" inputmode="numeric" value="${escapeHtml(quota.threshold ?? '')}"></label></div></fieldset>`;
}

function channelMarkup(type, channel, index) {
  const config = channelTypes[type];
  const title = channel.name || `${config.label} 渠道 ${index + 1}`;
  const fields = config.fields.map(field => fieldMarkup(type, channel, index, field)).join('');
  const isHuggingFace = type === 'huggingface';
  return `<article class="native-channel-card${channel.fixed ? ' is-fixed' : ''}">
    <header><div><h3>${escapeHtml(title)}</h3><p>${isHuggingFace ? '仅维护已有文件所需凭据；新文件不会上传到 Hugging Face。' : channel.fixed ? '来自 Workers 环境变量；只可修改允许项。' : '保存后用于新的上传任务。'}</p></div>${isHuggingFace ? '<span class="native-channel-note">仅维护已有文件</span>' : `<label class="native-switch"><input data-channel-enabled data-channel-type="${type}" data-channel-index="${index}" type="checkbox"${channel.enabled !== false ? ' checked' : ''}><span>启用</span></label>`}</header>
    <div class="native-channel-fields">${fields}${isHuggingFace && (channel.fixed || channel.isPrivate !== undefined) ? `<label class="native-check"><input data-channel-field="isPrivate" data-channel-type="${type}" data-channel-index="${index}" type="checkbox"${channel.isPrivate ? ' checked' : ''}> 私有仓库</label>` : ''}</div>
    ${channel.fixed || isHuggingFace ? '' : `<footer><button type="button" class="button danger" data-remove-channel data-channel-type="${type}" data-channel-index="${index}">移除渠道</button></footer>`}
  </article>`;
}

function storageSection(type, value) {
  const config = channelTypes[type];
  const channels = Array.isArray(value?.channels) ? value.channels : [];
  const loadBalance = value?.loadBalance || { enabled: false, channels: [] };
  return `<section class="native-settings-section" data-channel-section="${type}">
    <div class="native-settings-section-head"><div><h2>${config.label}</h2><p>${type === 'huggingface' ? '已有文件仍可读取和删除；不接受新的上传。' : '仅已启用的渠道会参与新的上传。'}</p></div>${type === 'huggingface' ? '' : `<button type="button" class="button" data-add-channel="${type}">添加渠道</button>`}</div>
    ${type === 'huggingface' ? '' : `<label class="native-check native-balance"><input data-load-balance="${type}" type="checkbox"${loadBalance.enabled ? ' checked' : ''}> 在启用渠道间轮换保存</label>`}
    <div class="native-channel-list">${channels.length ? channels.map((channel, index) => channelMarkup(type, channel, index)).join('') : `<div class="native-empty">尚未配置 ${config.label} 渠道。</div>`}</div>
  </section>`;
}

function uploadMarkup() {
  return `<main class="native-settings-main"><section class="page-section native-settings-page"><header class="page-head"><div class="page-title"><h1>存储渠道</h1><p>配置实际可用的保存渠道。Discord 上传大小受服务器的上传限制约束，个人 Nitro 不会提高机器人的上传上限。</p></div><button type="button" class="button primary" data-save-settings>保存更改</button></header>${renderTabNav()}<div class="native-settings-status" aria-live="polite"></div>${['telegram', 'discord', 'cfr2', 'huggingface'].map(type => storageSection(type, state.upload[type])).join('')}</section></main>`;
}

function othersMarkup() {
  const settings = state.others || {};
  const random = settings.randomImageAPI || {};
  const browse = settings.publicBrowse || {};
  const cloudflare = settings.cloudflareApiToken || {};
  return `<main class="native-settings-main"><section class="page-section native-settings-page"><header class="page-head"><div class="page-title"><h1>其他设置</h1><p>管理站点功能与缓存清理。</p></div><button type="button" class="button primary" data-save-settings>保存更改</button></header>${renderTabNav()}<div class="native-settings-status" aria-live="polite"></div>
    <section class="native-settings-section"><h2>站点功能</h2><div class="native-settings-fields"><label class="native-check"><input data-other-field="telemetry.enabled" type="checkbox"${settings.telemetry?.enabled ? ' checked' : ''}> 允许遥测</label><label class="native-check"><input data-other-field="randomImageAPI.enabled" type="checkbox"${random.enabled ? ' checked' : ''}> 启用随机图片 API</label><label class="native-settings-field"><span>随机图片目录</span><input data-other-field="randomImageAPI.allowedDir" type="text" value="${escapeHtml(random.allowedDir || '')}"></label><label class="native-check"><input data-other-field="publicBrowse.enabled" type="checkbox"${browse.enabled ? ' checked' : ''}> 允许公开浏览</label><label class="native-settings-field"><span>公开浏览目录</span><input data-other-field="publicBrowse.allowedDir" type="text" value="${escapeHtml(browse.allowedDir || '')}"></label></div></section>
    <section class="native-settings-section"><div class="native-settings-section-head"><div><h2>Cloudflare 缓存清理</h2><p>仅在需要清理站点缓存时填写；环境变量配置也会显示在这里。</p></div></div><div class="native-settings-fields native-settings-secret-grid">${[['CF_ZONE_ID', 'Zone ID', 'text'], ['CF_EMAIL', '邮箱', 'email'], ['CF_API_KEY', 'API Token / Key', 'secret']].map(([field, label, kind]) => `<label class="native-settings-field"><span>${label}</span><span class="native-secret-field"><input data-other-field="cloudflareApiToken.${field}" type="${kind === 'secret' ? 'password' : kind}"${kind === 'secret' ? ' autocomplete="off"' : ''} value="${escapeHtml(cloudflare[field] || '')}">${kind === 'secret' ? '<button type="button" class="native-secret-toggle" data-secret-toggle aria-pressed="false">显示</button>' : ''}</span></label>`).join('')}</div></section>
  </section></main>`;
}

function setStatus(message, type = '') {
  const target = state.host?.querySelector('.native-settings-status');
  if (!target) return;
  target.className = `native-settings-status ${type}`;
  target.textContent = message;
}

function markDirty() {
  state.dirty = true;
  if (['system-page', 'system-security'].includes(state.activeKey) && !state.saving) state.host?.querySelector('[data-save-settings]')?.removeAttribute('disabled');
  setStatus('尚有未保存的更改。', 'pending');
}

function getChannel(type, index) {
  return state.upload?.[type]?.channels?.[Number(index)];
}

function addChannel(type) {
  const config = channelTypes[type];
  const channel = { name: `${config.label} 渠道`, enabled: true };
  config.fields.forEach(([field]) => { if (field !== 'name') channel[field] = ''; });
  if (type === 'huggingface') channel.isPrivate = true;
  state.upload[type] ||= { channels: [], loadBalance: { enabled: false, channels: [] } };
  state.upload[type].channels ||= [];
  state.upload[type].channels.push(channel);
  markDirty();
  render();
}

function validateUpload() {
  for (const [type, config] of Object.entries(channelTypes)) {
    const names = new Set();
    for (const [index, channel] of (state.upload[type]?.channels || []).entries()) {
      if (channel.fixed) continue;
      const name = String(channel.name || '').trim();
      if (!name) return { type, index, field: 'name', message: `${config.label} 渠道名称不能为空。` };
      if (names.has(name)) return { type, index, field: 'name', message: `${config.label} 渠道名称不能重复。` };
      names.add(name);
      if (type === 'cfr2' && channel.publicUrl) {
        try {
          const url = new URL(channel.publicUrl);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
        } catch {
          return { type, index, field: 'publicUrl', message: 'R2 公开访问地址必须以 http:// 或 https:// 开头。' };
        }
      }
      if (channel.enabled === false) continue;
      const required = type === 'cfr2' ? [] : type === 'huggingface' ? ['token', 'repo'] : type === 'discord' ? ['botToken', 'channelId'] : ['botToken', 'chatId'];
      const missing = required.find(field => !String(channel[field] || '').trim());
      if (missing) return { type, index, field: missing, message: `${config.label} 已启用渠道缺少必要信息。` };
    }
  }
  return null;
}

function showFieldError(error) {
  const selector = `[data-channel-type="${error.type}"][data-channel-index="${error.index}"][data-channel-field="${error.field}"]`;
  const input = state.host?.querySelector(selector);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  setStatus(error.message, 'error');
}

function saveButton(busy) {
  state.host?.querySelectorAll('input, button, select, textarea').forEach(control => {
    if (busy) {
      control.dataset.settingsDisabled = String(control.disabled);
      control.disabled = true;
    } else if (control.dataset.settingsDisabled !== undefined) {
      control.disabled = control.dataset.settingsDisabled === 'true';
      delete control.dataset.settingsDisabled;
    }
  });
  state.host?.querySelectorAll('[data-save-settings]').forEach(button => {
    button.disabled = busy || (['system-page', 'system-security'].includes(state.activeKey) && !state.dirty);
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy ? '正在保存…' : '保存更改';
  });
}

async function save() {
  if (state.saving) return;
  const upload = state.activeKey === 'system-upload';
  const wallpaper = state.activeKey === 'system-wallpaper';
  const page = state.activeKey === 'system-page';
  const security = state.activeKey === 'system-security';
  if (security) {
    if (!Object.keys(state.securityChanges).length) return;
    const error = validateSecuritySettings();
    if (error) { securityFieldError(error); return; }
  }
  if (page) {
    if (!Object.keys(state.pageChanges).length) return;
    const error = validateSiteSettings();
    if (error) { siteFieldError(error); return; }
  }
  if (wallpaper) {
    const error = validateWallpaper();
    if (error) {
      const input = state.host.querySelector(error.selector);
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
      setStatus(error.message, 'error');
      return;
    }
  }
  const validationError = upload && validateUpload();
  if (validationError) { showFieldError(validationError); return; }
  state.saving = true;
  saveButton(true);
  setStatus('正在保存…', 'pending');
  try {
    const path = security ? '/api/manage/sysConfig/security' : wallpaper || page ? '/api/manage/sysConfig/page' : upload ? '/api/manage/sysConfig/upload' : '/api/manage/sysConfig/others';
    const result = await api(path, { method: security || wallpaper || page ? 'PATCH' : 'POST', body: JSON.stringify(security ? { securityValues: state.securityChanges } : page ? { pageValues: state.pageChanges } : wallpaper ? { welcomeWallpaper: state.wallpaper } : upload ? state.upload : state.others) });
    if (upload) state.upload = result;
    else if (wallpaper) state.wallpaper = readWallpaper(result);
    else if (page) { state.page = result; state.pageChanges = {}; }
    else if (security) { state.security = result; state.securityChanges = {}; }
    else state.others = result;
    state.dirty = false;
    render();
    setStatus('设置已保存。', 'success');
    notify('设置已保存。');
    if (page) {
      try { await refreshSiteConfig(); }
      catch { setStatus('设置已保存，但当前页面未能更新显示，请刷新页面。', 'error'); }
    }
  } catch (error) {
    if (security && error.field?.startsWith('securityValues.')) { securityFieldError({ id: error.field.slice('securityValues.'.length), message: error.message }); return; }
    if (page && error.field?.startsWith('pageValues.')) { siteFieldError({ id: error.field.split('.')[1], message: error.message }); return; }
    if (error.status === 401 || error.status === 403) setStatus('当前账户没有保存系统设置的权限。', 'error');
    else setStatus(error.message || '保存失败，请检查网络后重试。', 'error');
  } finally {
    state.saving = false;
    saveButton(false);
  }
}

function setOtherField(path, value) {
  const [section, field] = path.split('.');
  state.others[section] ||= {};
  state.others[section][field] = value;
}

function render() {
  if (!state.host || !state.user || !allowedRoles.has(state.user.role)) return;
  state.host.innerHTML = state.activeKey === 'system-security' ? securityMarkup() : state.activeKey === 'system-page' ? pageMarkup() : state.activeKey === 'system-wallpaper' ? wallpaperMarkup() : state.activeKey === 'system-others' ? othersMarkup() : uploadMarkup();
  bindPageEvents();
}

function bindPageEvents() {
  if (state.activeKey === 'system-security') bindSecurityEvents();
  if (state.activeKey === 'system-page') bindSiteEvents();
  if (state.activeKey === 'system-wallpaper') bindWallpaperEvents();
  state.host.querySelectorAll('[data-channel-field]').forEach(input => input.addEventListener('change', event => {
    const channel = getChannel(event.target.dataset.channelType, event.target.dataset.channelIndex);
    if (!channel) return;
    channel[event.target.dataset.channelField] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    event.target.removeAttribute('aria-invalid');
    markDirty();
  }));
  state.host.querySelectorAll('[data-channel-enabled]').forEach(input => input.addEventListener('change', event => {
    const channel = getChannel(event.target.dataset.channelType, event.target.dataset.channelIndex);
    if (!channel) return;
    channel.enabled = event.target.checked;
    markDirty();
  }));
  state.host.querySelectorAll('[data-load-balance]').forEach(input => input.addEventListener('change', event => {
    const setting = state.upload[event.target.dataset.loadBalance] ||= { channels: [], loadBalance: { enabled: false, channels: [] } };
    setting.loadBalance ||= { channels: [] };
    setting.loadBalance.enabled = event.target.checked;
    markDirty();
  }));
  state.host.querySelectorAll('[data-quota-field]').forEach(input => input.addEventListener('change', event => {
    const channel = getChannel('cfr2', event.target.dataset.channelIndex);
    if (!channel) return;
    if (!channel.quota || typeof channel.quota !== 'object') channel.quota = { enabled: false, limitGB: 10, threshold: 95 };
    const field = event.target.dataset.quotaField;
    channel.quota[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value === '' ? undefined : Number(event.target.value);
    markDirty();
  }));
  state.host.querySelectorAll('[data-other-field]').forEach(input => input.addEventListener('change', event => {
    setOtherField(event.target.dataset.otherField, event.target.type === 'checkbox' ? event.target.checked : event.target.value);
    markDirty();
  }));
  state.host.querySelectorAll('[data-add-channel]').forEach(button => button.addEventListener('click', () => addChannel(button.dataset.addChannel)));
  state.host.querySelectorAll('[data-remove-channel]').forEach(button => button.addEventListener('click', () => {
    const channels = state.upload[button.dataset.channelType]?.channels;
    if (!channels) return;
    channels.splice(Number(button.dataset.channelIndex), 1);
    markDirty();
    render();
  }));
  state.host.querySelectorAll('[data-save-settings]').forEach(button => button.addEventListener('click', save));
  state.host.querySelectorAll('[data-secret-toggle]').forEach(button => button.addEventListener('click', () => {
    const input = button.parentElement.querySelector('input');
    const revealed = input.type === 'text';
    input.type = revealed ? 'password' : 'text';
    button.textContent = revealed ? '显示' : '隐藏';
    button.setAttribute('aria-pressed', String(!revealed));
    button.setAttribute('aria-label', revealed ? '显示敏感信息' : '隐藏敏感信息');
    input.focus();
  }));
}

function discardDialog(continueAction) {
  const root = document.querySelector('#dialogRoot');
  if (!root || root.querySelector('[data-settings-discard-dialog]')) return;
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.dataset.settingsDiscardDialog = 'true';
  backdrop.innerHTML = '<section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="settingsDiscardTitle"><div class="dialog-head"><div><h2 id="settingsDiscardTitle">放弃未保存的更改？</h2><p>离开后，本页尚未保存的设置会丢失。</p></div></div><div class="dialog-actions"><button type="button" class="button" data-keep-editing>继续编辑</button><button type="button" class="button danger" data-discard-settings>放弃更改</button></div></section>';
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    trigger?.focus?.();
  };
  const dialog = backdrop.querySelector('[role="alertdialog"]');
  const onKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not([disabled])')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeydown);
  backdrop.querySelector('[data-keep-editing]').addEventListener('click', close);
  backdrop.querySelector('[data-discard-settings]').addEventListener('click', () => {
    state.dirty = false;
    state.tokenDrafts = {};
    close();
    continueAction();
  });
  root.append(backdrop);
  backdrop.querySelector('[data-keep-editing]').focus();
}

function requestLeave(continueAction) {
  if (state.saving) {
    setStatus('正在保存设置，请稍候。', 'pending');
    return false;
  }
  if (!state.dirty && !Object.keys(state.tokenDrafts).length) return true;
  discardDialog(continueAction);
  return false;
}

async function show(detail) {
  const key = detail?.tool?.key || detail?.key || new URL(location.href).searchParams.get('tool');
  state.activeKey = panels[key] ? key : 'system-upload';
  state.host = detail?.host || state.host || document.querySelector('#nativeToolHost');
  if (!state.host) return;
  const loadId = ++state.loadId;
  renderLoading();
  try {
    const userResponse = state.user ? { user: state.user } : await api('/api/user/me');
    state.user = userResponse.user || userResponse.identity || userResponse;
    if (!allowedRoles.has(state.user?.role)) {
      state.host.innerHTML = '<main class="native-settings-main"><div class="error-state"><h2>无权访问系统设置</h2><p>只有站点管理员和所有者可以读取或修改这些设置。</p></div></main>';
      return;
    }
    const path = ['system-wallpaper', 'system-page'].includes(state.activeKey) ? '/api/manage/sysConfig/page' : state.activeKey === 'system-others' ? '/api/manage/sysConfig/others' : '/api/manage/sysConfig/upload';
    const security = state.activeKey === 'system-security';
    const [data, tokenData] = await Promise.all([api(security ? '/api/manage/sysConfig/security?view=modern' : path), security ? api('/api/manage/apiTokens') : Promise.resolve(null)]);
    if (loadId !== state.loadId) return;
    if (security) { state.security = data; state.securityChanges = {}; state.tokens = tokenData.tokens || []; state.tokenDrafts = {}; }
    else if (state.activeKey === 'system-others') state.others = data;
    else if (state.activeKey === 'system-wallpaper') {
      state.wallpaper = readWallpaper(data);
    } else if (state.activeKey === 'system-page') { state.page = data; state.pageChanges = {}; }
    else state.upload = data;
    state.dirty = false;
    render();
  } catch (error) {
    if (loadId !== state.loadId) return;
    if (error.status === 401 || error.status === 403) renderError('当前账户没有读取系统设置的权限。', false);
    else renderError(error.message || '网络请求失败。');
  }
}

window.ImgBedStorageSettings = { requestLeave, show };
window.addEventListener('imgbed:native-tool-show', event => show(event.detail));
window.addEventListener('beforeunload', event => {
  if (!state.dirty && !state.saving && !Object.keys(state.tokenDrafts).length) return;
  event.preventDefault();
  event.returnValue = '';
});

const initialTool = new URL(location.href).searchParams.get('tool');
if (panels[initialTool]) show({ key: initialTool });
