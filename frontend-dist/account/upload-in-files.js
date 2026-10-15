const RECENT_UPLOADS_KEY = 'imgbed-recent-upload-results';
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
const ACCEPTED_FILE = /\.(?:jpe?g|png|gif|webp|avif|mp4|webm)$/i;

const uploadState = {
  busy: false,
  queue: [],
  recent: readRecentUploads(),
  dragDepth: 0,
  compressVideos: false,
  compressionController: null,
  videoDecision: null,
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
  input.accept = 'image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm';
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
  overlay.innerHTML = '<div class="integrated-upload-drop-card"><span aria-hidden="true">＋</span><strong>松开以上传到“我的文件”</strong><small>图片、动图、WebP、AVIF、MP4 与 WebM</small></div>';
  document.body.append(overlay);
  return overlay;
}

function queueMarkup() {
  if (!uploadState.queue.length) return '';
  const finished = uploadState.queue.filter(item => item.status === 'done').length;
  const failed = uploadState.queue.filter(item => item.status === 'error').length;
  return `<section class="integrated-upload-status" aria-live="polite">
    <div class="integrated-upload-status-head"><div><strong>${uploadState.busy ? '正在处理文件' : '上传结果'}</strong><small>${finished} 完成${failed ? ` · ${failed} 失败` : ''} · 共 ${uploadState.queue.length} 个</small></div>${uploadState.busy ? '' : '<button type="button" data-upload-clear>收起</button>'}</div>
    <div class="integrated-upload-list">${uploadState.queue.map(item => `<div class="integrated-upload-row ${item.status}" data-upload-id="${item.id}"><div class="integrated-upload-copy"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small data-upload-status>${escapeHtml(uploadStatus(item))}</small></div><div class="integrated-upload-progress" role="progressbar" aria-label="${escapeHtml(item.name)} 的处理进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(item.progress || 0)}" ${['review', 'skipped'].includes(item.status) ? 'hidden' : ''}><span style="width:${item.status === 'done' ? 100 : Math.max(2, Number(item.progress) || 0)}%"></span></div>${item.status === 'compressing' ? '<button type="button" data-cancel-compression>取消压缩</button>' : item.url ? `<button type="button" data-copy-upload-url="${escapeHtml(item.url)}">复制链接</button>` : ''}${item.status === 'review' ? `<div class="integrated-upload-review">${item.previewUrl ? `<video src="${escapeHtml(item.previewUrl)}" controls playsinline preload="metadata" aria-label="${escapeHtml(item.name)} 的压缩预览"></video>` : ''}<div><p>${escapeHtml(item.compressionNotice)}</p><p class="integrated-upload-review-hint">只保存你选择上传的版本，本机原文件不变。</p><div class="integrated-upload-review-actions">${item.previewUrl ? '<button type="button" class="upload-compressed" data-video-choice="compressed">上传压缩版</button>' : ''}<button type="button" data-video-choice="original">上传原片</button><button type="button" data-video-choice="skip">跳过</button></div></div></div>` : ''}</div>`).join('')}</div>
  </section>`;
}

function uploadStatus(item) {
  if (item.status === 'waiting') return '等待处理';
  if (item.status === 'compressing') return `本机压缩中 ${Math.round(item.progress || 0)}% · 请保持页面打开`;
  if (item.status === 'review') return '尚未上传，请选择上传版本';
  if (item.status === 'skipped') return '已跳过，未上传';
  if (item.status === 'uploading') return `上传中 ${Math.round(item.progress || 0)}%`;
  if (item.status === 'done') return item.notice || '已上传到我的文件';
  return item.error || '上传失败';
}

function updateUploadProgress(item) {
  const row = document.querySelector(`[data-upload-id="${item.id}"]`);
  if (!row) return;
  row.querySelector('[data-upload-status]').textContent = uploadStatus(item);
  const progress = row.querySelector('[role="progressbar"]');
  progress.setAttribute('aria-valuenow', String(Math.round(item.progress || 0)));
  progress.querySelector('span').style.width = `${Math.max(2, item.progress || 0)}%`;
}

function recentMarkup() {
  if (!uploadState.recent.length) return '';
  const success = uploadState.recent.filter(item => item.url);
  const failed = uploadState.recent.filter(item => !item.url);
  return `<section class="integrated-upload-status recent" aria-live="polite">
    <div class="integrated-upload-status-head"><div><strong>刚刚上传</strong><small>${success.length} 个已加入“我的文件”${failed.length ? ` · ${failed.length} 个失败` : ''}</small></div><button type="button" data-recent-upload-dismiss>关闭</button></div>
    <div class="integrated-upload-list">${uploadState.recent.map(item => `<div class="integrated-upload-row ${item.url ? 'done' : 'error'}"><div class="integrated-upload-copy"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><small>${item.url ? escapeHtml(item.notice || '默认显示在发现页，可在文件卡中隐藏') : escapeHtml(item.error || '上传失败')}</small></div>${item.url ? `<button type="button" data-copy-upload-url="${escapeHtml(item.url)}">复制链接</button>` : ''}</div>`).join('')}</div>
  </section>`;
}

function patchFilesView() {
  if (!isFilesView()) return;
  const section = document.querySelector('#mainContent .page-section');
  if (!section) return;

  const trigger = section.querySelector('[data-integrated-upload-trigger]');
  if (trigger) trigger.disabled = uploadState.busy;

  const anchor = section.querySelector('.file-toolbar') || section.querySelector('.page-head');
  if (!anchor) return;
  let options = section.querySelector('.integrated-upload-options');
  if (!options) {
    options = document.createElement('div');
    options.className = 'integrated-upload-options';
    options.innerHTML = '<label><input type="checkbox" id="compressVideos" aria-describedby="compressVideosHint">上传前压缩视频</label><small id="compressVideosHint">可用时在本机压缩，预览后上传。图片不受影响。</small>';
    anchor.insertAdjacentElement('afterend', options);
  }
  const compressOption = options.querySelector('input');
  compressOption.checked = uploadState.compressVideos;
  compressOption.disabled = uploadState.busy;

  section.querySelectorAll('.integrated-upload-status-slot').forEach(node => node.remove());
  const markup = queueMarkup() || recentMarkup();
  if (anchor && markup) {
    const status = document.createElement('div');
    status.className = 'integrated-upload-status-slot';
    status.innerHTML = markup;
    options.insertAdjacentElement('afterend', status);
  }
}

function renderUploadUi() {
  patchFilesView();
}

function normalizeSelectedFiles(files) {
  const accepted = [];
  for (const file of files) {
    if (!(file instanceof File) || !file.size) continue;
    if (!ACCEPTED_FILE.test(file.name) && !file.type.startsWith('image/') && file.type !== 'video/mp4' && file.type !== 'video/webm') {
      notify(`${file.name}：目前“我的文件”只接收图片、动图、MP4 与 WebM。`, 'error');
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
  const notices = [];
  if (result.moderationStatus && result.moderationStatus !== 'active') notices.push('原图已保存，正在等待审核');
  if (result.thumbnailReady === false) notices.push('原图已保存，缩略图尚未就绪');
  return { url: new URL(src, location.origin).href, notice: notices.join('；') };
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
      updateUploadProgress(item);
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
    try {
      let file = item.file;
      if (uploadState.compressVideos && (file.type.startsWith('video/') || /\.(?:mp4|webm)$/i.test(file.name))) {
        file = await prepareVideoUpload(item);
        if (!file) {
          item.status = 'skipped';
          delete item.file;
          renderUploadUi();
          continue;
        }
        item.name = file.name;
        item.size = file.size;
      }
      item.status = 'uploading';
      item.progress = 1;
      renderUploadUi();
      const result = await uploadOne(file, item);
      Object.assign(item, result);
      item.notice = [item.uploadNotice, result.notice].filter(Boolean).join('；');
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
  const results = uploadState.queue.filter(item => item.status !== 'skipped').map(({ name, size, url, error, notice }) => ({ name, size, url, error, notice }));
  const succeeded = results.filter(item => item.url).length;
  if (succeeded) {
    uploadState.recent = results;
    uploadState.queue = [];
    saveRecentUploads(results);
    renderUploadUi();
    notify(`${succeeded} 个文件上传完成，已加入“我的文件”。`);
    window.dispatchEvent(new CustomEvent('imgbed:files-changed', { detail: { results } }));
  } else {
    renderUploadUi();
    if (results.some(item => item.error)) notify('这批文件没有上传成功，请查看错误信息。', 'error');
  }
}

function formatVideoSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function prepareVideoUpload(item) {
  const controller = new AbortController();
  uploadState.compressionController = controller;
  item.status = 'compressing';
  item.progress = 0;
  renderUploadUi();
  let compressed = null;
  try {
    const { compressVideo } = await import('./video-compression.js');
    compressed = await compressVideo(item.file, {
      signal: controller.signal,
      onProgress(progress) {
        item.progress = Math.min(99, Math.max(0, progress * 100));
        updateUploadProgress(item);
      },
    });
    if (compressed.size >= item.file.size) {
      compressed = null;
      item.compressionNotice = '压缩结果没有比原片更小，建议上传原片。';
    } else {
      const saved = Math.round((1 - compressed.size / item.file.size) * 100);
      item.compressionNotice = `${formatVideoSize(item.file.size)} → ${formatVideoSize(compressed.size)}，减少 ${saved}%。播放预览后选择上传版本。`;
      item.previewUrl = URL.createObjectURL(compressed);
    }
  } catch (error) {
    item.compressionNotice = error.code === 'aborted' || error.name === 'AbortError'
      ? '已取消压缩。可以上传原片或跳过。'
      : error.code === 'unsupported'
        ? '当前浏览器或设备不支持压缩这个视频。可以上传原片。'
        : error.code === 'too_large'
          ? '当前设备无法处理这个大小的视频。可以上传原片。'
          : '压缩未完成。可以上传原片，或跳过这段视频。';
  } finally {
    uploadState.compressionController = null;
  }
  item.status = 'review';
  item.progress = 0;
  const choice = await new Promise(resolve => {
    uploadState.videoDecision = { id: item.id, resolve };
    renderUploadUi();
    document.querySelector(`[data-upload-id="${item.id}"] [data-video-choice]`)?.focus({ preventScroll: true });
  });
  uploadState.videoDecision = null;
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  delete item.previewUrl;
  if (choice === 'compressed' && compressed) {
    item.uploadNotice = `已上传压缩版（${formatVideoSize(item.file.size)} → ${formatVideoSize(compressed.size)}）`;
    return compressed;
  }
  return choice === 'original' ? item.file : null;
}

function hasFileTransfer(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-cancel-compression]')) {
    uploadState.compressionController?.abort();
    return;
  }
  const choice = event.target.closest('[data-video-choice]');
  if (choice && choice.closest('[data-upload-id]')?.dataset.uploadId === uploadState.videoDecision?.id) {
    uploadState.videoDecision.resolve(choice.dataset.videoChoice);
    return;
  }
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

document.addEventListener('change', event => {
  if (event.target.id === 'compressVideos' && !uploadState.busy) uploadState.compressVideos = event.target.checked;
});

window.addEventListener('beforeunload', event => {
  if (!uploadState.compressionController && !uploadState.videoDecision) return;
  event.preventDefault();
  event.returnValue = '';
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

const mainContent = document.querySelector('#mainContent');
const observer = new MutationObserver(() => patchFilesView());
if (mainContent) observer.observe(mainContent, { childList: true });
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
