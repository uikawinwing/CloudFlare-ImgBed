const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
const ALLOWED_UPLOAD = /\.(?:jpe?g|png|gif|webp|avif|mp4|webm)$/i;
const DEFAULT_RACE_COLOR = '#A9DBC3';
const DEFAULT_TIER_COLOR = '#B7D9E8';

const state = {
  user: null,
  albums: [],
  album: null,
  items: [],
  config: emptyConfig(),
  dirty: false,
  busy: false,
};

const $ = selector => document.querySelector(selector);
const root = $('#studioRoot');
const editor = $('#editor');
const loadingCard = $('#loadingCard');

function emptyConfig() {
  return {
    version: 1,
    entranceQuote: '',
    raceColor: '',
    tierColor: '',
    mainFileId: null,
    avatarFileId: null,
    coverFileId: null,
    viewerHiddenFileIds: [],
    metadata: { author: '', version: '', author_note: '', sex: '', race: '', story_sections: [] },
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function encodeFilePath(id) {
  return String(id).split('/').map(encodeURIComponent).join('/');
}

function fileUrl(file) {
  return `/file/${encodeFilePath(file.id)}`;
}

function isVideo(file) {
  return String(file?.file_type || '').startsWith('video/');
}

function isImage(file) {
  return String(file?.file_type || '').startsWith('image/');
}

function mediaLabel(file, index = 0) {
  return file?.file_name || file?.id || `媒体 ${index + 1}`;
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  $('#toastRegion').append(node);
  setTimeout(() => node.remove(), 3600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(body && typeof body === 'object' ? body.error : body || '请求失败');
    error.status = response.status;
    throw error;
  }
  return body;
}

function normalizeConfig(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  return {
    version: 1,
    entranceQuote: String(raw.entranceQuote || ''),
    raceColor: String(raw.raceColor || ''),
    tierColor: String(raw.tierColor || ''),
    mainFileId: typeof raw.mainFileId === 'string' ? raw.mainFileId : null,
    avatarFileId: typeof raw.avatarFileId === 'string' ? raw.avatarFileId : null,
    coverFileId: typeof raw.coverFileId === 'string' ? raw.coverFileId : null,
    viewerHiddenFileIds: Array.isArray(raw.viewerHiddenFileIds) ? [...new Set(raw.viewerHiddenFileIds.filter(id => typeof id === 'string'))] : [],
    metadata: {
      author: String(metadata.author || ''),
      version: String(metadata.version || ''),
      author_note: String(metadata.author_note || ''),
      sex: String(metadata.sex || ''),
      race: String(metadata.race || ''),
      story_sections: Array.isArray(metadata.story_sections)
        ? metadata.story_sections.map(section => ({ title: String(section?.title || ''), content: String(section?.content || '') }))
        : [],
    },
  };
}

function setBusy(busy) {
  state.busy = busy;
  $('#saveButton').disabled = busy || !state.album;
  $('#uploadButton').disabled = busy || !state.album;
  $('#albumSelect').disabled = busy || !state.albums.length;
}

function setDirty(dirty = true) {
  state.dirty = dirty;
  const node = $('#saveState');
  node.textContent = dirty ? '有未保存修改' : '已保存';
  node.className = `save-state ${dirty ? 'dirty' : 'saved'}`;
  $('#saveButton').disabled = state.busy || !state.album || !dirty;
}

function readFieldsIntoState() {
  state.config.entranceQuote = $('#entranceQuote').value;
  state.config.metadata.sex = $('#sex').value;
  state.config.metadata.race = $('#race').value;
  state.config.metadata.author = $('#author').value;
  state.config.metadata.version = $('#profileVersion').value;
  state.config.metadata.author_note = $('#authorNote').value;
  state.config.raceColor = normalizeHexInput($('#raceColor').value);
  state.config.tierColor = normalizeHexInput($('#tierColor').value);
}

function normalizeHexInput(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : '';
}

function fillFields() {
  $('#characterName').value = state.album?.charInfoCharacterName || state.album?.char_info_character_name || '';
  $('#entranceQuote').value = state.config.entranceQuote;
  $('#sex').value = state.config.metadata.sex;
  $('#race').value = state.config.metadata.race;
  $('#author').value = state.config.metadata.author;
  $('#profileVersion').value = state.config.metadata.version;
  $('#authorNote').value = state.config.metadata.author_note;
  $('#raceColor').value = state.config.raceColor;
  $('#tierColor').value = state.config.tierColor;
  $('#raceColorPicker').value = state.config.raceColor || DEFAULT_RACE_COLOR;
  $('#tierColorPicker').value = state.config.tierColor || DEFAULT_TIER_COLOR;
  $('#worldbookEditorLink').href = `/charinfo/worldbook/?album=${encodeURIComponent(state.album?.id || '')}`;
}

function sanitizeConfigAgainstItems() {
  const ids = new Set(state.items.map(item => item.id));
  if (!ids.has(state.config.mainFileId)) state.config.mainFileId = null;
  if (!ids.has(state.config.avatarFileId)) state.config.avatarFileId = null;
  if (!ids.has(state.config.coverFileId)) state.config.coverFileId = null;
  state.config.viewerHiddenFileIds = state.config.viewerHiddenFileIds.filter(id => ids.has(id));
  if (!state.config.mainFileId) {
    state.config.mainFileId = state.items.find(item => !state.config.viewerHiddenFileIds.includes(item.id))?.id || state.items[0]?.id || null;
  }
  if (state.config.mainFileId) {
    state.config.viewerHiddenFileIds = state.config.viewerHiddenFileIds.filter(id => id !== state.config.mainFileId);
  }
  const firstImage = state.items.find(isImage);
  if (firstImage && !state.config.avatarFileId) state.config.avatarFileId = firstImage.id;
  if (firstImage && !state.config.coverFileId) state.config.coverFileId = state.config.avatarFileId;
}

function renderAlbumSelect(selectedId = state.album?.id) {
  const select = $('#albumSelect');
  if (!state.albums.length) {
    select.innerHTML = '<option value="">还没有 Album</option>';
    select.disabled = true;
    return;
  }
  select.innerHTML = state.albums.map(album => `<option value="${escapeHtml(album.id)}">${escapeHtml(album.name)}</option>`).join('');
  select.value = state.albums.some(album => album.id === selectedId) ? selectedId : state.albums[0].id;
  select.disabled = state.busy;
}

function optionMarkup(files, selectedId, { allowEmpty = false } = {}) {
  return `${allowEmpty ? '<option value="">自动 / 不设置</option>' : ''}${files.map((file, index) => `<option value="${escapeHtml(file.id)}" ${file.id === selectedId ? 'selected' : ''}>${index + 1}. ${escapeHtml(mediaLabel(file, index))}</option>`).join('')}`;
}

function renderRoleSelectors() {
  $('#mainFile').innerHTML = state.items.length ? optionMarkup(state.items, state.config.mainFileId) : '<option value="">没有媒体</option>';
  const images = state.items.filter(isImage);
  $('#avatarFile').innerHTML = optionMarkup(images, state.config.avatarFileId, { allowEmpty: true });
  $('#coverFile').innerHTML = optionMarkup(images, state.config.coverFileId, { allowEmpty: true });
  $('#mainFile').disabled = !state.items.length;
  $('#avatarFile').disabled = !images.length;
  $('#coverFile').disabled = !images.length;
}

function renderStories() {
  const list = $('#storyList');
  const stories = state.config.metadata.story_sections;
  if (!stories.length) {
    list.innerHTML = '<div class="empty-note">没有故事段落；这个字段是可选的。</div>';
    return;
  }
  list.innerHTML = stories.map((story, index) => `<article class="story-card" data-story-index="${index}">
    <div class="story-card-head"><strong>段落 ${index + 1}</strong><div class="story-actions"><button type="button" data-story-up ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-story-down ${index === stories.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-story-delete>×</button></div></div>
    <label class="field"><span>标题</span><input data-story-title maxlength="120" value="${escapeHtml(story.title)}"></label>
    <label class="field"><span>内容</span><textarea data-story-content maxlength="12000" rows="4">${escapeHtml(story.content)}</textarea></label>
  </article>`).join('');
  list.querySelectorAll('.story-card').forEach(card => {
    const index = Number(card.dataset.storyIndex);
    card.querySelector('[data-story-title]').addEventListener('input', event => { state.config.metadata.story_sections[index].title = event.currentTarget.value; setDirty(); });
    card.querySelector('[data-story-content]').addEventListener('input', event => { state.config.metadata.story_sections[index].content = event.currentTarget.value; setDirty(); });
    card.querySelector('[data-story-delete]').addEventListener('click', () => { state.config.metadata.story_sections.splice(index, 1); renderStories(); setDirty(); });
    card.querySelector('[data-story-up]')?.addEventListener('click', () => moveStory(index, -1));
    card.querySelector('[data-story-down]')?.addEventListener('click', () => moveStory(index, 1));
  });
}

function moveStory(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= state.config.metadata.story_sections.length) return;
  const stories = state.config.metadata.story_sections;
  [stories[index], stories[next]] = [stories[next], stories[index]];
  renderStories();
  setDirty();
}

function renderGallery() {
  renderRoleSelectors();
  const list = $('#galleryList');
  if (!state.items.length) {
    list.innerHTML = '<div class="empty-note">这个 Album 还没有媒体。直接在上方上传即可。</div>';
    renderPreview();
    return;
  }
  list.innerHTML = state.items.map((file, index) => {
    const hidden = state.config.viewerHiddenFileIds.includes(file.id);
    const media = isVideo(file)
      ? `<video src="${escapeHtml(fileUrl(file))}" muted loop playsinline preload="metadata"></video>`
      : `<img src="${escapeHtml(fileUrl(file))}" alt="${escapeHtml(mediaLabel(file, index))}" loading="lazy">`;
    return `<article class="gallery-item" data-file-id="${escapeHtml(file.id)}">
      <div class="gallery-thumb">${media}<span class="type-pill">${isVideo(file) ? String(file.file_type).toLowerCase() === 'video/webm' ? 'WEBM' : 'MP4' : 'IMAGE'}</span></div>
      <div class="gallery-copy"><strong title="${escapeHtml(mediaLabel(file, index))}">${escapeHtml(mediaLabel(file, index))}</strong><small>${escapeHtml(file.visibility === 'public' ? '发现页显示' : '发现页隐藏')} · ${escapeHtml(file.id)}</small><div class="gallery-options"><label><input type="checkbox" data-viewer-visible ${hidden ? '' : 'checked'}> Viewer 显示</label>${file.id === state.config.mainFileId ? '<span class="hint">主立绘</span>' : ''}${file.id === state.config.avatarFileId ? '<span class="hint">头像</span>' : ''}${file.id === state.config.coverFileId ? '<span class="hint">封面</span>' : ''}</div></div>
      <div class="gallery-actions"><button type="button" data-move-up ${index === 0 ? 'disabled' : ''} aria-label="上移">↑</button><button type="button" data-move-down ${index === state.items.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button><button type="button" data-remove aria-label="移出 Album">×</button></div>
    </article>`;
  }).join('');

  list.querySelectorAll('.gallery-item').forEach((row, index) => {
    const fileId = row.dataset.fileId;
    row.querySelector('[data-viewer-visible]').addEventListener('change', event => {
      if (!event.currentTarget.checked && fileId === state.config.mainFileId) {
        event.currentTarget.checked = true;
        toast('主立绘必须保留在 Viewer。', 'error');
        return;
      }
      if (event.currentTarget.checked) state.config.viewerHiddenFileIds = state.config.viewerHiddenFileIds.filter(id => id !== fileId);
      else if (!state.config.viewerHiddenFileIds.includes(fileId)) state.config.viewerHiddenFileIds.push(fileId);
      setDirty();
      renderPreview();
    });
    row.querySelector('[data-move-up]')?.addEventListener('click', () => reorderItem(index, -1));
    row.querySelector('[data-move-down]')?.addEventListener('click', () => reorderItem(index, 1));
    row.querySelector('[data-remove]').addEventListener('click', () => removeItem(fileId));
  });
  observeGalleryVideos();
  renderPreview();
}

function observeGalleryVideos() {
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.play().catch(() => {}); else entry.target.pause();
  }), { threshold: .5 });
  $('#galleryList').querySelectorAll('video').forEach(video => observer.observe(video));
}

function renderPreview() {
  readFieldsIntoState();
  const raceColor = state.config.raceColor || DEFAULT_RACE_COLOR;
  const tierColor = state.config.tierColor || DEFAULT_TIER_COLOR;
  const main = state.items.find(item => item.id === state.config.mainFileId) || state.items.find(item => !state.config.viewerHiddenFileIds.includes(item.id));
  const media = main
    ? isVideo(main)
      ? `<video src="${escapeHtml(fileUrl(main))}" autoplay muted loop playsinline></video>`
      : `<img src="${escapeHtml(fileUrl(main))}" alt="${escapeHtml($('#characterName').value || '角色预览')}">`
    : '<div class="preview-placeholder">上传媒体后会在这里预览主立绘。</div>';
  $('#visualPreview').style.setProperty('--race', raceColor);
  $('#visualPreview').style.setProperty('--tier', tierColor);
  $('#visualPreview').innerHTML = `<div class="preview-media">${media}</div><div class="preview-copy"><span class="eyebrow">CHARINFO VISUAL</span><h3>${escapeHtml($('#characterName').value.trim() || '未命名角色')}</h3><div class="meta">${escapeHtml([state.config.metadata.sex, state.config.metadata.race].filter(Boolean).join(' · ') || 'Visual Profile')}</div>${state.config.entranceQuote.trim() ? `<blockquote>${escapeHtml(state.config.entranceQuote.trim())}</blockquote>` : ''}${state.config.metadata.author.trim() ? `<div class="author">作者 · ${escapeHtml(state.config.metadata.author.trim())}</div>` : ''}</div>`;
}

async function loadAlbums(preferredId = null) {
  const data = await api('/api/user/albums');
  state.albums = Array.isArray(data.albums) ? data.albums : [];
  renderAlbumSelect(preferredId);
  if (!state.albums.length) {
    state.album = null;
    state.items = [];
    state.config = emptyConfig();
    editor.hidden = true;
    loadingCard.hidden = false;
    loadingCard.innerHTML = '<div class="empty-note"><strong>还没有 Album</strong><p>点左侧“新建 CharInfo Album”开始。</p></div>';
    setBusy(false);
    return;
  }
  await loadAlbum(preferredId && state.albums.some(album => album.id === preferredId) ? preferredId : $('#albumSelect').value || state.albums[0].id);
}

async function loadAlbum(albumId) {
  setBusy(true);
  root.setAttribute('aria-busy', 'true');
  try {
    const [detail, visual] = await Promise.all([
      api(`/api/user/albums/${encodeURIComponent(albumId)}`),
      api(`/api/user/albums/${encodeURIComponent(albumId)}/charinfo`),
    ]);
    state.album = { ...(state.albums.find(album => album.id === albumId) || {}), ...(detail.album || {}) };
    state.items = Array.isArray(detail.items) ? [...detail.items].sort((a, b) => Number(a.position || 0) - Number(b.position || 0)) : [];
    state.config = normalizeConfig(visual.config);
    sanitizeConfigAgainstItems();
    renderAlbumSelect(albumId);
    fillFields();
    renderStories();
    renderGallery();
    loadingCard.hidden = true;
    editor.hidden = false;
    setDirty(false);
    const url = new URL(location.href);
    url.searchParams.set('album', albumId);
    history.replaceState(null, '', url);
  } catch (error) {
    toast(error.message || '读取 CharInfo Album 失败。', 'error');
  } finally {
    root.removeAttribute('aria-busy');
    setBusy(false);
  }
}

async function saveVisual() {
  if (!state.album || state.busy) return;
  readFieldsIntoState();
  const characterName = $('#characterName').value.trim();
  if (!characterName) {
    toast('角色完整姓名不能为空。', 'error');
    $('#characterName').focus();
    return;
  }
  const incompleteStory = state.config.metadata.story_sections.find(section => !section.title.trim() || !section.content.trim());
  if (incompleteStory) {
    toast('故事段落的标题和内容必须同时填写。', 'error');
    return;
  }
  if ($('#raceColor').value.trim() && !state.config.raceColor) return toast('种族颜色必须使用 #RRGGBB。', 'error');
  if ($('#tierColor').value.trim() && !state.config.tierColor) return toast('阶层颜色必须使用 #RRGGBB。', 'error');

  setBusy(true);
  $('#saveState').textContent = '保存中…';
  try {
    const [albumResult, visualResult] = await Promise.all([
      api(`/api/user/albums/${encodeURIComponent(state.album.id)}`, { method: 'PATCH', body: JSON.stringify({ charInfoCharacterName: characterName }) }),
      api(`/api/user/albums/${encodeURIComponent(state.album.id)}/charinfo`, { method: 'PUT', body: JSON.stringify({ config: state.config }) }),
    ]);
    state.album = { ...state.album, ...albumResult };
    state.config = normalizeConfig(visualResult.config);
    const albumIndex = state.albums.findIndex(album => album.id === state.album.id);
    if (albumIndex >= 0) state.albums[albumIndex] = { ...state.albums[albumIndex], ...albumResult };
    setDirty(false);
    toast('Visual Profile 已保存。', 'success');
    renderGallery();
  } catch (error) {
    setDirty(true);
    toast(error.message || '保存失败。', 'error');
  } finally {
    setBusy(false);
  }
}

async function createAlbum(event) {
  event.preventDefault();
  const name = $('#newAlbumName').value.trim();
  const characterName = $('#newCharacterName').value.trim();
  if (!name || !characterName) return;
  setBusy(true);
  try {
    const created = await api('/api/user/albums', {
      method: 'POST',
      body: JSON.stringify({ name, description: '', charInfoCharacterName: characterName, visibility: 'public' }),
    });
    $('#newAlbumForm').hidden = true;
    $('#newAlbumName').value = '';
    $('#newCharacterName').value = '';
    await loadAlbums(created.id);
    toast('CharInfo Album 已创建。', 'success');
  } catch (error) {
    toast(error.message || '创建 Album 失败。', 'error');
  } finally {
    setBusy(false);
  }
}

function parseUploadedFileId(src) {
  const url = new URL(src, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/file/')) throw new Error('上传成功，但返回的文件地址格式无法识别。');
  const encoded = url.pathname.slice('/file/'.length);
  if (!encoded) throw new Error('上传成功，但没有返回文件 ID。');
  return encoded.split('/').map(part => decodeURIComponent(part)).join('/');
}

function uploadOne(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload?returnFormat=full');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    xhr.addEventListener('load', () => {
      let body;
      try { body = JSON.parse(xhr.responseText || ''); } catch { body = null; }
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(body?.error || xhr.responseText || `上传失败 (${xhr.status})`));
      const result = Array.isArray(body) ? body[0] : body;
      if (!result?.src) return reject(new Error('上传成功，但服务器没有返回资源地址。'));
      try { resolve({ fileId: parseUploadedFileId(result.src), src: result.src }); } catch (error) { reject(error); }
    });
    xhr.addEventListener('error', () => reject(new Error('上传网络连接中断。')));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

async function uploadFiles(files) {
  if (!state.album || state.busy) return;
  const accepted = [...files].filter(file => {
    const allowed = file instanceof File && file.size > 0 && file.size <= MAX_UPLOAD_BYTES && (ALLOWED_UPLOAD.test(file.name) || file.type.startsWith('image/') || ['video/mp4', 'video/webm'].includes(file.type));
    if (!allowed) toast(`${file.name || '文件'}：只支持图片、MP4、WebM，单个文件不超过 95 MB。`, 'error');
    return allowed;
  });
  if (!accepted.length) return;

  setBusy(true);
  let completed = 0;
  try {
    for (const file of accepted) {
      $('#uploadStatus').textContent = `正在上传 ${completed + 1}/${accepted.length}：${file.name}`;
      const uploaded = await uploadOne(file, progress => { $('#uploadStatus').textContent = `正在上传 ${completed + 1}/${accepted.length}：${file.name} · ${progress}%`; });
      await api(`/api/user/albums/${encodeURIComponent(state.album.id)}/items`, {
        method: 'POST',
        body: JSON.stringify({ fileId: uploaded.fileId, position: state.items.length + completed }),
      });
      completed += 1;
    }
    $('#uploadStatus').textContent = `${completed} 个文件已上传并加入当前 Album。`;
    await loadAlbum(state.album.id);
    setDirty(true);
    toast(`${completed} 个文件已加入 Gallery。`, 'success');
  } catch (error) {
    toast(error.message || '上传失败。', 'error');
    if (completed) await loadAlbum(state.album.id);
  } finally {
    setBusy(false);
    setTimeout(() => { if ($('#uploadStatus').textContent.includes('已')) $('#uploadStatus').textContent = ''; }, 3500);
  }
}

async function reorderItem(index, direction) {
  if (state.busy) return;
  const otherIndex = index + direction;
  if (otherIndex < 0 || otherIndex >= state.items.length) return;
  const current = state.items[index];
  const other = state.items[otherIndex];
  setBusy(true);
  try {
    await Promise.all([
      api(`/api/user/albums/${encodeURIComponent(state.album.id)}/items`, { method: 'PATCH', body: JSON.stringify({ fileId: current.id, position: otherIndex }) }),
      api(`/api/user/albums/${encodeURIComponent(state.album.id)}/items`, { method: 'PATCH', body: JSON.stringify({ fileId: other.id, position: index }) }),
    ]);
    [state.items[index], state.items[otherIndex]] = [state.items[otherIndex], state.items[index]];
    renderGallery();
    setDirty();
  } catch (error) {
    toast(error.message || '排序失败。', 'error');
  } finally {
    setBusy(false);
  }
}

async function removeItem(fileId) {
  if (state.busy || !confirm('只把这个文件移出当前 CharInfo Album？原文件仍保留在“我的文件”。')) return;
  setBusy(true);
  try {
    await api(`/api/user/albums/${encodeURIComponent(state.album.id)}/items?fileId=${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    state.items = state.items.filter(item => item.id !== fileId);
    sanitizeConfigAgainstItems();
    renderGallery();
    setDirty();
    toast('已移出 Album；原文件没有删除。', 'success');
  } catch (error) {
    toast(error.message || '移出 Album 失败。', 'error');
  } finally {
    setBusy(false);
  }
}

function bindStaticEvents() {
  $('#saveButton').addEventListener('click', saveVisual);
  $('#newAlbumToggle').addEventListener('click', () => { $('#newAlbumForm').hidden = !$('#newAlbumForm').hidden; if (!$('#newAlbumForm').hidden) $('#newAlbumName').focus(); });
  $('#cancelNewAlbum').addEventListener('click', () => { $('#newAlbumForm').hidden = true; });
  $('#newAlbumForm').addEventListener('submit', createAlbum);
  $('#albumSelect').addEventListener('change', async event => {
    const nextId = event.currentTarget.value;
    if (!nextId || nextId === state.album?.id) return;
    if (state.dirty && !confirm('当前 Visual Profile 还有未保存修改。确定切换 Album 并放弃这些修改？')) {
      event.currentTarget.value = state.album.id;
      return;
    }
    await loadAlbum(nextId);
  });

  ['characterName', 'entranceQuote', 'sex', 'race', 'author', 'profileVersion', 'authorNote', 'raceColor', 'tierColor'].forEach(id => {
    $(`#${id}`).addEventListener('input', () => { readFieldsIntoState(); setDirty(); renderPreview(); });
  });
  [['raceColorPicker', 'raceColor'], ['tierColorPicker', 'tierColor']].forEach(([pickerId, textId]) => {
    $(`#${pickerId}`).addEventListener('input', event => { $(`#${textId}`).value = event.currentTarget.value.toUpperCase(); readFieldsIntoState(); setDirty(); renderPreview(); });
    $(`#${textId}`).addEventListener('change', event => { const color = normalizeHexInput(event.currentTarget.value); if (color) $(`#${pickerId}`).value = color; });
  });

  $('#addStory').addEventListener('click', () => { state.config.metadata.story_sections.push({ title: '', content: '' }); renderStories(); setDirty(); });
  $('#mainFile').addEventListener('change', event => { state.config.mainFileId = event.currentTarget.value || null; state.config.viewerHiddenFileIds = state.config.viewerHiddenFileIds.filter(id => id !== state.config.mainFileId); renderGallery(); setDirty(); });
  $('#avatarFile').addEventListener('change', event => { state.config.avatarFileId = event.currentTarget.value || null; renderGallery(); setDirty(); });
  $('#coverFile').addEventListener('change', event => { state.config.coverFileId = event.currentTarget.value || null; renderGallery(); setDirty(); });

  const input = $('#fileInput');
  $('#uploadButton').addEventListener('click', () => input.click());
  $('#uploadDrop').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const files = [...(input.files || [])]; input.value = ''; uploadFiles(files); });
  $('#uploadDrop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; event.currentTarget.classList.add('dragging'); });
  $('#uploadDrop').addEventListener('dragleave', event => event.currentTarget.classList.remove('dragging'));
  $('#uploadDrop').addEventListener('drop', event => { event.preventDefault(); event.currentTarget.classList.remove('dragging'); uploadFiles([...(event.dataTransfer?.files || [])]); });

  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function init() {
  bindStaticEvents();
  try {
    const me = await api('/api/user/me');
    state.user = me.user;
    const preferred = new URLSearchParams(location.search).get('album');
    await loadAlbums(preferred);
  } catch (error) {
    if (error.status === 401) {
      location.replace(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }
    loadingCard.innerHTML = `<div class="empty-note"><strong>暂时无法打开 Visual Studio</strong><p>${escapeHtml(error.message)}</p></div>`;
    toast(error.message || '加载失败。', 'error');
  } finally {
    root.removeAttribute('aria-busy');
  }
}

init();
