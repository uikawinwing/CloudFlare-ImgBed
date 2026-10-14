const allowedRoles = new Set(['admin', 'owner']);
const panels = {
  'system-upload': { title: '存储渠道', description: '管理 Telegram、Discord、R2 与 Hugging Face 的保存渠道。' },
  'system-others': { title: '其他设置', description: '管理站点功能与缓存清理。' },
};
const channelTypes = {
  telegram: { label: 'Telegram', fields: [['name', '渠道名称', 'text'], ['botToken', 'Bot Token', 'secret'], ['chatId', '聊天 ID', 'text'], ['proxyUrl', '代理域名（可选）', 'text']] },
  cfr2: { label: 'Cloudflare R2', fields: [['name', '渠道名称', 'text'], ['publicUrl', '公开访问地址', 'url'], ['quota', '容量限制', 'quota']] },
  discord: { label: 'Discord', fields: [['name', '渠道名称', 'text'], ['botToken', 'Bot Token', 'secret'], ['channelId', '频道 ID', 'text'], ['proxyUrl', '代理域名（可选）', 'text']] },
  huggingface: { label: 'Hugging Face', fields: [['name', '渠道名称', 'text'], ['token', 'Access Token', 'secret'], ['repo', '仓库名称', 'text']] },
};

const state = { host: null, user: null, upload: null, others: null, dirty: false, saving: false, activeKey: null, loadId: 0 };

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
  return `<nav class="native-settings-tabs" aria-label="系统设置"><a href="${currentToolUrl('system-upload')}" class="${state.activeKey === 'system-upload' ? 'active' : ''}"${state.activeKey === 'system-upload' ? ' aria-current="page"' : ''}>存储渠道</a><a href="${currentToolUrl('system-others')}" class="${state.activeKey === 'system-others' ? 'active' : ''}"${state.activeKey === 'system-others' ? ' aria-current="page"' : ''}>其他设置</a></nav>`;
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
  state.host?.querySelectorAll('input, button').forEach(control => { control.disabled = busy; });
  state.host?.querySelectorAll('[data-save-settings]').forEach(button => {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.textContent = busy ? '正在保存…' : '保存更改';
  });
}

async function save() {
  if (state.saving) return;
  const upload = state.activeKey === 'system-upload';
  const validationError = upload && validateUpload();
  if (validationError) { showFieldError(validationError); return; }
  state.saving = true;
  saveButton(true);
  setStatus('正在保存…', 'pending');
  try {
    const path = upload ? '/api/manage/sysConfig/upload' : '/api/manage/sysConfig/others';
    const result = await api(path, { method: 'POST', body: JSON.stringify(upload ? state.upload : state.others) });
    if (upload) state.upload = result;
    else state.others = result;
    state.dirty = false;
    render();
    setStatus('设置已保存。', 'success');
    notify('设置已保存。');
  } catch (error) {
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
  state.host.innerHTML = state.activeKey === 'system-others' ? othersMarkup() : uploadMarkup();
  bindPageEvents();
}

function bindPageEvents() {
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
  if (!state.dirty) return true;
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
    const path = state.activeKey === 'system-others' ? '/api/manage/sysConfig/others' : '/api/manage/sysConfig/upload';
    const data = await api(path);
    if (loadId !== state.loadId) return;
    if (state.activeKey === 'system-others') state.others = data;
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
  if (!state.dirty && !state.saving) return;
  event.preventDefault();
  event.returnValue = '';
});

const initialTool = new URL(location.href).searchParams.get('tool');
if (panels[initialTool]) show({ key: initialTool });
