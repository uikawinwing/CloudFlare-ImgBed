const RECENT_UPLOADS_KEY = 'imgbed-recent-upload-results';
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
const ACCEPTED_FILE = /\.(?:jpe?g|png|gif|webp|avif|mp4)$/i;

const uploadState = {
  busy: false,
  queue: [],
  recent: readRecentUploads(),
  dragDepth: 0,
};

function isFilesView() {
  const params = new URLSearchParams(location.search);
  return (params.get('view') || 'files') === 'files';
}

function readRecentUploads() {
  try {
    const value = sessionStorage.getItem(RECENT_UPLOADS_KEY);
    sessionStorage.removeItem(RECENT_UPLOADS_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentUploads(items) {
  try {
    sessionStorage.setItem(RECENT_UPLOADS_KEY, JSON.stringify(items));
  } catch {}
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 2 : 1)} MB`;
}

function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
  return Promise.resolve();
}

function notify(message, type = '') {
  const region = document.querySelector('#toastRegion');
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  region.append(node);
  setTimeout(() => node.remove(), 3600);
}

function ensureFileInput() {
  let input = document.querySelector('#integratedUploadInput');
  if (input) return input;
  input = document.createElement('input');
  input.id = 'integratedUploadInput';
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4';
  input.hidden = true;
  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (files.length) uploadFiles(files);
  });
  document.body.append(input);
  return input;
}

function openFilePicker() {
  if (!isFilesView() || uploadState.busy) return;
  ensureFileInput().click();
}

function ensureDropOverlay() {
  let overlay = document.querySelector('#integratedUploadDropOverlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'integratedUploadDropOverlay';
  overlay.className = 'integrated-upload-drop-overlay';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="integrated-upload-drop-card"><span aria-hidden="true">＋</span><strong>松开以上传到“我的文件”</strong><small>图片、动图、WebP、AVIF 或 MP4</small></div>';
  document.body.append(overlay);
  return overlay;
}

function queueMarkup() {
  if (!uploadState.queue.length) return '';
  const finished = uploadState.queue.filter(item => item.status === 'done').length;
  const failed = uploadState.queue.filter(item => item.status === 'error').length;
  return `<section class="integrated-upload-status" aria-live="polite">
    <div class="integrated-upload-status-head"><div><strong>${uploadState.busy ? '正在上传' : '上传结果'}</strong><small>${finished} 完成${failed ? ` · ${failed} 失败` : ''} · 共 ${uploadState.queue.length} 个</small></div>${uploadState.busy ? '' : '<button type="button" data-upload-clear>收起</button>'}</div>
    <div class="integrated-upload-list">${uploadState.queue.map(item => `<div class="integrated-upload-row ${item.status}"><div class="integrated-upload-copy"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${item.status === 'waiting' ? '等待上传' : item.status === 'uploading' ? `上传中 ${Math.round(item.progress || 0)}%` : item.status === 'done' ? '已上传到我的文件' : escapeHtml(item.error || '上传失败')}</small></div><div class="integrated-upload-progress" aria-hidden="true"><span style="width:${item.status === 'done' ? 100 : Math.max(2, Number(item.progress) || 0)}%"></span></div>${item.url ? `<button type="button" data-copy-upload-url="${escapeHtml(item.url)}">复制链接</button>` : ''}</div>`).join('')}</div>
  </section>`;
}

function recentMarkup() {
  if (!uploadState.recent.length) return '';
  const success = uploadState.recent.filter(item => item.url);
  const failed = uploadState.recent.filter(item => !item.url);
  return `<section class="integrated-upload-status recent" aria-live="polite">
    <div class="integrated-upload-status-head"><div><strong>刚刚上传</strong><small>${success.length} 个已加入“我的文件”${failed.length ? ` · ${failed.length} 个失败` : ''}</small></div><button type="button" data-recent-upload-dismiss>关闭</button></div>
    <div class="integrated-upload-list">${uploadState.recent.map(item => `<div class="integrated-upload-row ${item.url ? 'done' : 'error'}"><div class="integrated-upload-copy"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${item.url ? '默认保持私密，可在文件卡中改为公开' : escapeHtml(item.error || '上传失败')}</small></div>${item.url ? `<button type="button" data-copy-upload-url="${escapeHtml(item.url)}">复制链接</button>` : ''}</div>`).join('')}</div>
  </section>`;
}

function patchFilesView() {
  if (!isFilesView()) return;
  const section = document.querySelector('#mainContent .page-section');
  if (!section) return;

  section.querySelectorAll('a[href="/studio"], a[href="/studio/"]').forEach(link => {
    link.href = '#';
    link.dataset.integratedUploadTrigger = 'true';
    if (link.textContent.includes('前往上传')) link.innerHTML = `${link.querySelector('svg')?.outerHTML || ''}上传文件`;
  });

  const headActions = section.querySelector('.head-actions');
  if (headActions && !headActions.querySelector('[data-integrated-upload-trigger]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button primary';
    button.dataset.integratedUploadTrigger = 'true';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>上传文件';
    headActions.append(button);
  }

  let helper = section.querySelector('.integrated-upload-helper');
  if (!helper) {
    helper = document.createElement('div');
    helper.className = 'integrated-upload-helper';
    const toolbar = section.querySelector('.file-toolbar');
    (toolbar || section.firstElementChild)?.insertAdjacentElement('beforebegin', helper);
  }
  if (helper) {
    helper.innerHTML = `<div><strong>上传就在这里</strong><span>点击“上传文件”，或把文件拖到页面；也可以直接 Ctrl+V 粘贴图片。</span></div><button type="button" data-integrated-upload-trigger ${uploadState.busy ? 'disabled' : ''}>选择文件</button>`;
  }

  section.querySelector('.integrated-upload-status')?.remove();
  section.querySelector('.integrated-upload-status.recent')?.remove();
  const anchor = helper || section.querySelector('.file-toolbar') || section.querySelector('.page-head');
  if (anchor) {
    const status = document.createElement('div');
    status.className = 'integrated-upload-status-slot';
    status.innerHTML = queueMarkup() || recentMarkup();
    if (status.firstElementChild) anchor.insertAdjacentElement('afterend', status);
  }
}

function renderUploadUi() {
  document.querySelectorAll('.integrated-upload-status-slot').forEach(node => node.remove());
  patchFilesView();
}

function normalizeSelectedFiles(files) {
  const accepted = [];
  for (const file of files) {
    if (!(file instanceof File) || !file.size) continue;
    if (!ACCEPTED_FILE.test(file.name) && !file.type.startsWith('image/') && file.type !== 'video/mp4') {
      notify(`${file.name}：目前“我的文件”只接收图片、动图与 MP4。`, 'error');
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      notify(`${file.name}：超过 95 MB 上传上限。`, 'error');
      continue;
    }
    accepted.push(file);
  }
  return accepted;
}

function parseUploadResponse(xhr, fileName) {
  let body = null;
  try { body = JSON.parse(xhr.responseText || ''); } catch {}
  if (xhr.status < 200 || xhr.status >= 300) {
    const message = typeof body === 'string'
      ? body
      : body?.error || (body && typeof body === 'object' ? Object.values(body).filter(Boolean).join(' · ') : '') || xhr.responseText || `上传失败 (${xhr.status})`;
    throw new Error(String(message).replace(/^Error:\s*/i, '').trim());
  }
  const result = Array.isArray(body) ? body[0] : body;
  const src = result?.src || result?.publicUrl;
  if (!src) throw new Error(`${fileName} 已上传，但服务器没有返回资源链接。`);
  return new URL(src, location.origin).href;
}

function uploadOne(file, item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload?returnFormat=full');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', event => {
      if (!event.lengthComputable) return;
      item.progress = Math.min(99, event.loaded / event.total * 100);
      renderUploadUi();
    });
    xhr.addEventListener('load', () => {
      try { resolve(parseUploadResponse(xhr, file.name)); }
      catch (error) { reject(error); }
    });
    xhr.addEventListener('error', () => reject(new Error('网络连接中断。')));
    xhr.addEventListener('abort', () => reject(new Error('上传已取消。')));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

async function uploadFiles(files) {
  if (uploadState.busy || !isFilesView()) return;
  const selected = normalizeSelectedFiles(files);
  if (!selected.length) return;

  uploadState.busy = true;
  uploadState.recent = [];
  uploadState.queue = selected.map((file, index) => ({ id: `${Date.now()}-${index}`, file, name: file.name, size: file.size, status: 'waiting', progress: 0, url: null, error: null }));
  renderUploadUi();

  for (const item of uploadState.queue) {
    item.status = 'uploading';
    item.progress = 1;
    renderUploadUi();
    try {
      item.url = await uploadOne(item.file, item);
      item.progress = 100;
      item.status = 'done';
    } catch (error) {
      item.status = 'error';
      item.error = error.message || '上传失败';
    }
    delete item.file;
    renderUploadUi();
  }

  uploadState.busy = false;
  const results = uploadState.queue.map(({ name, size, url, error }) => ({ name, size, url, error }));
  const succeeded = results.filter(item => item.url).length;
  renderUploadUi();
  if (succeeded) {
    saveRecentUploads(results);
    notify(`${succeeded} 个文件上传完成，正在刷新“我的文件”…`);
    setTimeout(() => location.reload(), 450);
  } else {
    notify('这批文件没有上传成功，请查看错误信息。', 'error');
  }
}

function hasFileTransfer(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-integrated-upload-trigger]');
  if (trigger) {
    event.preventDefault();
    openFilePicker();
    return;
  }
  const copy = event.target.closest('[data-copy-upload-url]');
  if (copy) {
    copyText(copy.dataset.copyUploadUrl).then(() => {
      const original = copy.textContent;
      copy.textContent = '已复制';
      setTimeout(() => { copy.textContent = original; }, 1400);
    }).catch(() => notify('复制链接失败。', 'error'));
    return;
  }
  if (event.target.closest('[data-upload-clear]')) {
    uploadState.queue = [];
    renderUploadUi();
  }
  if (event.target.closest('[data-recent-upload-dismiss]')) {
    uploadState.recent = [];
    renderUploadUi();
  }
});

document.addEventListener('dragenter', event => {
  if (!isFilesView() || !hasFileTransfer(event)) return;
  event.preventDefault();
  uploadState.dragDepth += 1;
  ensureDropOverlay().hidden = false;
});

document.addEventListener('dragover', event => {
  if (!isFilesView() || !hasFileTransfer(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', event => {
  if (!isFilesView() || !hasFileTransfer(event)) return;
  uploadState.dragDepth = Math.max(0, uploadState.dragDepth - 1);
  if (uploadState.dragDepth === 0) ensureDropOverlay().hidden = true;
});

document.addEventListener('drop', event => {
  if (!isFilesView() || !hasFileTransfer(event)) return;
  event.preventDefault();
  uploadState.dragDepth = 0;
  ensureDropOverlay().hidden = true;
  uploadFiles([...(event.dataTransfer?.files || [])]);
});

document.addEventListener('paste', event => {
  if (!isFilesView() || isEditableTarget(event.target) || uploadState.busy) return;
  const files = [...(event.clipboardData?.items || [])]
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  uploadFiles(files);
});

const observer = new MutationObserver(() => patchFilesView());
observer.observe(document.querySelector('#mainContent') || document.body, { childList: true, subtree: true });
ensureFileInput();
ensureDropOverlay();
patchFilesView();

if (new URLSearchParams(location.search).get('upload') === '1') {
  const clean = new URL(location.href);
  clean.searchParams.delete('upload');
  history.replaceState(null, '', clean);
  const focusUpload = () => {
    patchFilesView();
    const trigger = document.querySelector('[data-integrated-upload-trigger]');
    if (trigger) {
      trigger.focus();
      notify('选择文件，或直接拖拽 / Ctrl+V 粘贴上传。');
    } else {
      setTimeout(focusUpload, 120);
    }
  };
  setTimeout(focusUpload, 120);
}
