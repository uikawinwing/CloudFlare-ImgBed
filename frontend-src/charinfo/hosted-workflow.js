import { getSiteConfig, publicFileUrl } from '../site-config.js';

const SUPPORTED_IMAGE_PATH = /\.(?:png|jpe?g|gif|apng|webp|avif)$/iu;
function supportedImageUrl(value) {
    try { return SUPPORTED_IMAGE_PATH.test(new URL(value, location.origin).pathname); } catch { return false; }
}

const ERROR_MESSAGES = {
    SIGN_IN_REQUIRED: '请先登录，再上传图片或保存图库。',
    STORAGE_UNAVAILABLE: '图片资料暂时无法保存，请稍后再试。',
    INVALID_INPUT: '请检查角色姓名及图片选择。',
    INVALID_CONFIG: '展示资料不完整，请检查头像、封面及角色图片。',
    FILES_UNAVAILABLE: '部分图片已不存在或不属于当前账号，请重新选择。',
    INVALID_MEDIA: '部分文件不是支持的角色图片。',
    ACCOUNT_UNAVAILABLE: '当前账号暂时无法建立公开图库。',
    PUBLIC_HANDLE_REQUIRED: '请填写公开用户名。',
    FILES_NOT_READY: '部分图片仍在审核或暂时不能公开，请处理后再完成。',
    COMPLETION_CONFLICT: '图库资料已发生变化，请重新打开后再保存。',
    ALBUM_NOT_FOUND: '找不到可以编辑的图库，请检查当前登录账号。',
    SAVE_FAILED: '图库暂时无法保存，当前资料和图片已保留。',
};

function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value, location.origin);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

function fileIdFromSrc(src) {
    const url = new URL(String(src || ''), location.origin);
    if (!url.pathname.startsWith('/file/')) throw new Error('上传响应没有返回有效的图片位置，请从“我的文件”确认上传结果。');
    const fileId = url.pathname.slice('/file/'.length).split('/').map(decodeURIComponent).join('/');
    if (!fileId || fileId.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('上传响应没有返回有效的图片位置，请从“我的文件”确认上传结果。');
    }
    return fileId;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    let body;
    try { body = await response.json(); } catch {
        const error = new Error('服务器没有返回可读取的结果，请保留草稿后重试。');
        error.code = 'RESPONSE_UNREADABLE';
        throw error;
    }
    if (!response.ok) {
        let handleError = '';
        if (url === '/api/user/handle' && response.status === 409) {
            handleError = body?.error === 'Public handle cannot change while shared album links exist'
                ? '已有图库时不能更改公开用户名，请重新检查账号资料。' : '这个公开用户名已被使用，请换一个。';
        }
        const error = new Error(ERROR_MESSAGES[body?.code] || handleError || (response.status === 401 ? ERROR_MESSAGES.SIGN_IN_REQUIRED : '请求未完成，请保留当前资料后再试。'));
        error.code = body?.code || '';
        error.status = response.status;
        throw error;
    }
    return body;
}

function jsonOptions(method, body) {
    return { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) };
}

function appendLink(parent, label, href) {
    const safe = safeUrl(href);
    if (!safe) return;
    const link = document.createElement('a');
    link.href = safe;
    link.textContent = label;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    parent.append(link);
}

export function initializeHostedWorkflow({ getProfile, getMedia, addMedia, onSaved, showStatus, persist, setBusy, validate }) {
    const mediaSection = document.getElementById('hostedMediaSection');
    const completeSection = document.getElementById('hostedCompleteSection');
    let draftId = crypto.randomUUID(), albumId = '', ownerId = '', savedFileIds = [], removedFileIds = [], result = null;
    let identity = null, identityError = '', busy = false, identityVersion = 0;
    let pickerController = null, pickerVersion = 0, pickerCursor = null;
    const knownFiles = new Map(), selectedFiles = new Set();
    let pickerOpener = null;

    mediaSection.innerHTML = `<h3>上传角色图片</h3>
      <p class="hint">在这里上传或选择已有图片，完成时会自动建立图库。图片上传后已有直链，尚未完成的图片仍保留在“我的文件”。</p>
      <div class="gallery-toolbar"><button type="button" class="primary" data-hosted-upload>上传图片</button><button type="button" data-hosted-select>从我的文件选择</button><input type="file" accept=".png,.jpg,.jpeg,.gif,.apng,.webp,.avif" multiple hidden data-hosted-input></div>
      <p class="hint">支持 PNG、JPEG、GIF、APNG、WebP、AVIF，每张小于 95 MB。</p>
      <div class="hosted-auth hint" data-hosted-auth></div><div class="status" role="status" aria-live="polite" data-hosted-upload-status></div><ul class="hosted-upload-results" data-hosted-upload-results></ul>`;
    completeSection.innerHTML = `<h3>完成角色资料</h3>
      <p class="hint">完成后将创建公开图库，并显示在发现页；图库包含你填写的展示资料。原始人物正文和 JSON 只保存在此浏览器，不会自动公开。</p>
      <p class="hint" data-hosted-summary></p>
      <div class="field" data-hosted-handle-field hidden><label for="hostedPublicHandle">公开用户名</label><input id="hostedPublicHandle" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="例如 snow-gallery"><span class="hint">首次建立图库时设置，使用 3–32 位小写字母、数字或短横线。</span></div>
      <button type="button" class="primary" data-hosted-complete>生成导出内容</button>
      <div class="status" role="status" aria-live="polite" data-hosted-complete-status></div><div class="hosted-result" data-hosted-result></div>`;
    const uploadButton = mediaSection.querySelector('[data-hosted-upload]');
    const selectButton = mediaSection.querySelector('[data-hosted-select]');
    const fileInput = mediaSection.querySelector('[data-hosted-input]');
    const authStatus = mediaSection.querySelector('[data-hosted-auth]');
    const uploadStatus = mediaSection.querySelector('[data-hosted-upload-status]');
    const uploadResults = mediaSection.querySelector('[data-hosted-upload-results]');
    const summary = completeSection.querySelector('[data-hosted-summary]');
    const handleField = completeSection.querySelector('[data-hosted-handle-field]');
    const handleInput = completeSection.querySelector('#hostedPublicHandle');
    const completeButton = completeSection.querySelector('[data-hosted-complete]');
    const completeStatus = completeSection.querySelector('[data-hosted-complete-status]');
    const resultContainer = completeSection.querySelector('[data-hosted-result]');

    const picker = document.createElement('dialog');
    picker.className = 'hosted-file-picker';
    picker.setAttribute('aria-labelledby', 'hostedPickerTitle');
    picker.innerHTML = `<div class="hosted-picker-header"><h3 id="hostedPickerTitle">从我的文件选择图片</h3><button type="button" data-picker-close aria-label="关闭图片选择器">关闭</button></div>
      <div class="gallery-toolbar"><label class="field">搜索文件或标签<input type="search" maxlength="200" data-picker-query></label><button type="button" data-picker-clear hidden>清空搜索</button><button type="button" data-picker-search>搜索</button></div>
      <div class="status" role="status" aria-live="polite" data-picker-status></div><div class="hosted-file-grid" data-picker-list></div>
      <div class="gallery-toolbar"><button type="button" data-picker-more hidden>加载更多</button><button type="button" class="primary" data-picker-add disabled>添加所选图片</button></div>`;
    document.body.append(picker);
    const pickerQuery = picker.querySelector('[data-picker-query]');
    const pickerClear = picker.querySelector('[data-picker-clear]');
    const pickerSearch = picker.querySelector('[data-picker-search]');
    const pickerStatus = picker.querySelector('[data-picker-status]');
    const pickerList = picker.querySelector('[data-picker-list]');
    const pickerMore = picker.querySelector('[data-picker-more]');
    const pickerAdd = picker.querySelector('[data-picker-add]');

    function hostedMedia() {
        return getMedia().filter(image => image.fileId && image.hostedUrl && image.sources?.includes(image.hostedUrl));
    }

    function wrongOwner() { return Boolean(identity && ownerId && ownerId !== identity.id); }

    function setOperationBusy(value) {
        busy = value;
        setBusy(value);
        renderSummary();
    }

    function setStatus(target, text, kind = '') {
        target.textContent = text;
        target.className = `status${kind ? ` ${kind}` : ''}`;
    }

    async function saveDraft() {
        if (await persist() === false) throw new Error('浏览器未能保存草稿，请保留当前页面后重试。');
    }

    function renderAuth() {
        authStatus.replaceChildren();
        if (wrongOwner()) {
            authStatus.textContent = '此草稿的图片属于另一个账号。请切回原账号，或使用“新建角色”重新开始。';
        } else if (identity) {
            authStatus.textContent = '已登录，可以上传或选择自己的图片。';
        } else {
            authStatus.append(document.createTextNode(identityError || '上传或建立图库需要先登录；仍可填写资料和生成 EJS。'));
            const login = document.createElement('a');
            login.href = '/api/auth/discord?returnTo=%2Fcharinfo%2F';
            login.textContent = '登录';
            login.addEventListener('click', async event => {
                event.preventDefault();
                try { await saveDraft(); location.assign(login.href); } catch (error) { showStatus(error.message, 'bad'); }
            });
            authStatus.append(document.createTextNode(' '), login);
            if (identityError) {
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.textContent = '重新检查登录';
                retry.addEventListener('click', () => { void loadIdentity(); });
                authStatus.append(document.createTextNode(' '), retry);
            }
        }
    }

    function renderResult() {
        resultContainer.replaceChildren();
        if (!result?.album?.id) return;
        const links = document.createElement('div');
        links.className = 'gallery-toolbar';
        appendLink(links, '查看公开图库', result.albumUrl);
        appendLink(links, '打开图库数据', result.remoteGalleryUrl);
        appendLink(links, '在我的文件中查看', `/account/?view=albums&album=${encodeURIComponent(result.album.id)}`);
        resultContainer.append(links);
        for (const image of hostedMedia()) {
            const row = document.createElement('div');
            row.className = 'hosted-link-row';
            const label = document.createElement('label');
            label.textContent = `${image.title || '角色图片'}直链`;
            const input = document.createElement('input');
            input.type = 'url'; input.readOnly = true; input.value = safeUrl(image.hostedUrl);
            label.append(input);
            const copy = document.createElement('button');
            copy.type = 'button'; copy.textContent = '复制';
            copy.addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(input.value); copy.textContent = '已复制'; }
                catch { input.focus(); input.select(); showStatus('请复制已选中的图片链接。', ''); }
            });
            row.append(label, copy);
            resultContainer.append(row);
        }
    }

    function renderSummary() {
        const media = hostedMedia();
        const count = new Set(media.map(image => image.fileId)).size;
        summary.textContent = count ? `已选择 ${count} 张本站图片，完成时会自动${albumId ? '更新' : '建立'}图库。` : `未选择本站图片时，只生成导出内容；外部图片链接会保留在 EJS 中。${albumId ? '现有公开图库不会更改。' : ''}`;
        completeButton.textContent = busy ? '正在处理…' : count ? `完成并${albumId ? '更新' : '创建'}公开图库` : '生成导出内容';
        uploadButton.disabled = busy || wrongOwner();
        selectButton.disabled = busy || wrongOwner();
        completeButton.disabled = busy || wrongOwner();
        handleField.hidden = !count || !identity || Boolean(identity.publicHandle) || wrongOwner();
        renderAuth();
        renderResult();
    }

    async function loadIdentity() {
        const version = ++identityVersion;
        try {
            const response = await fetch('/api/user/me', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
            const body = await response.json();
            if (version !== identityVersion) return identity;
            identity = response.ok && body.authenticated && body.user?.id ? body.user : null;
            identityError = '';
        } catch {
            if (version !== identityVersion) return identity;
            identity = null; identityError = '暂时无法检查登录状态，上传前请重新检查。';
        }
        renderSummary();
        return identity;
    }
    void loadIdentity();

    async function requireIdentity() {
        await loadIdentity();
        if (!identity) { showStatus(identityError || ERROR_MESSAGES.SIGN_IN_REQUIRED, 'bad'); return false; }
        if (wrongOwner()) { showStatus('当前账号与草稿图片的所属账号不同，请切回原账号或新建角色。', 'bad'); return false; }
        if (!ownerId) { ownerId = identity.id; await saveDraft(); }
        return true;
    }

    async function uploadFiles(files) {
        if (busy || !files.length) return;
        const invalid = files.find(file => !SUPPORTED_IMAGE_PATH.test(file.name) || (file.type && !file.type.startsWith('image/')) || !file.size || file.size >= 95 * 1024 * 1024);
        if (invalid) { setStatus(uploadStatus, '请选择小于 95 MB 的 PNG、JPEG、GIF、APNG、WebP 或 AVIF 图片。', 'bad'); return; }
        setOperationBusy(true);
        uploadResults.replaceChildren();
        let success = 0;
        try {
            const siteConfig = await getSiteConfig();
            for (const [index, file] of files.entries()) {
                if (!await requireIdentity()) return;
                setStatus(uploadStatus, `正在上传 ${index + 1}/${files.length}：${file.name}`);
                const form = new FormData();
                form.append('file', file);
                let body;
                try { body = await requestJson('/upload?returnFormat=default', { method: 'POST', body: form }); }
                catch (error) {
                    if (error instanceof TypeError || error.code === 'RESPONSE_UNREADABLE' || error.status >= 500) throw new Error('上传结果未能确认，服务器可能已收到文件。请先从“我的文件”查找，避免重复上传。');
                    throw error;
                }
                const uploaded = Array.isArray(body) ? body[0] : null;
                if (!uploaded?.src) throw new Error('无法确认上传结果。请先从“我的文件”查找这张图片，避免重复上传。');
                const fileId = fileIdFromSrc(uploaded.src);
                const url = safeUrl(uploaded.publicUrl) || publicFileUrl(fileId, siteConfig);
                addMedia({ fileId, url, title: file.name, moderationStatus: uploaded.moderationStatus || 'active' });
                success += 1;
                await saveDraft();
                const row = document.createElement('li');
                const pending = uploaded.moderationStatus && uploaded.moderationStatus !== 'active';
                row.textContent = `${file.name}：${pending ? '已上传，审核通过后才能加入公开图库' : '上传成功'}${uploaded.warning ? `；${String(uploaded.warning)}` : uploaded.thumbnailReady === false ? '；缩略图暂未就绪，原图已保留' : ''}`;
                uploadResults.append(row);
            }
            setStatus(uploadStatus, `已上传 ${success} 张图片，可继续填写资料。`, 'ok');
        } catch (error) { setStatus(uploadStatus, `${success ? `已保留 ${success} 张成功上传的图片。` : ''}${error.message || '上传未完成，请保留草稿。'}`, 'bad'); }
        finally { setOperationBusy(false); }
    }

    function updatePickerSelection() {
        pickerAdd.disabled = selectedFiles.size === 0;
        pickerAdd.textContent = selectedFiles.size ? `添加所选 ${selectedFiles.size} 张图片` : '添加所选图片';
    }

    async function loadPickerPage(reset) {
        pickerController?.abort();
        pickerController = new AbortController();
        const version = ++pickerVersion;
        if (reset) { pickerCursor = null; pickerList.replaceChildren(); }
        pickerMore.hidden = true;
        pickerSearch.disabled = true;
        setStatus(pickerStatus, '正在读取图片…');
        try {
            const params = new URLSearchParams({ filter: 'image', limit: '30', query: pickerQuery.value.trim() });
            if (pickerCursor) params.set('cursor', pickerCursor);
            const body = await requestJson(`/api/user/files?${params}`, { signal: pickerController.signal });
            const config = await getSiteConfig();
            if (version !== pickerVersion || !picker.open) return;
            if (!Array.isArray(body.files)) throw new Error('暂时无法读取图片列表。');
            const existing = new Set(hostedMedia().map(image => image.fileId));
            for (const file of body.files) {
                if (!file.id || !String(file.file_type || '').startsWith('image/')) continue;
                knownFiles.set(file.id, { ...file, publicUrl: publicFileUrl(file.id, config) });
                const label = document.createElement('label');
                label.className = 'hosted-file-choice';
                const input = document.createElement('input');
                input.type = 'checkbox'; input.checked = selectedFiles.has(file.id);
                const supported = supportedImageUrl(file.publicUrl || publicFileUrl(file.id, config));
                input.disabled = existing.has(file.id) || file.moderation_status !== 'active' || !supported;
                input.addEventListener('change', () => { if (input.checked) selectedFiles.add(file.id); else selectedFiles.delete(file.id); updatePickerSelection(); });
                const image = document.createElement('img');
                image.src = safeUrl(file.thumbnail_url) || publicFileUrl(file.id, config);
                image.alt = ''; image.loading = 'lazy';
                const name = document.createElement('span');
                name.textContent = file.file_name || file.id;
                const status = document.createElement('span');
                status.className = 'hint';
                status.textContent = existing.has(file.id) ? '已加入' : !supported ? '角色展示暂不支持此格式' : file.moderation_status !== 'active' ? '暂时不能公开' : '';
                label.append(input, image, name, status); pickerList.append(label);
            }
            pickerCursor = body.nextCursor || null;
            pickerMore.hidden = !pickerCursor;
            setStatus(pickerStatus, pickerList.children.length ? '勾选图片后添加，可继续搜索或加载更多。' : '没有找到图片，可调整搜索或直接上传。');
        } catch (error) { if (error.name !== 'AbortError' && version === pickerVersion) setStatus(pickerStatus, error.message, 'bad'); }
        finally { if (version === pickerVersion) pickerSearch.disabled = false; }
    }

    async function openPicker() {
        if (busy) return;
        try { if (!await requireIdentity()) return; } catch (error) { showStatus(error.message, 'bad'); return; }
        pickerOpener = document.activeElement;
        selectedFiles.clear(); knownFiles.clear(); updatePickerSelection();
        pickerQuery.value = ''; pickerClear.hidden = true;
        picker.showModal(); pickerQuery.focus();
        void loadPickerPage(true);
    }

    function imageReferenceId(url, media) {
        if (!url) return null;
        const match = media.find(image => image.hostedUrl === url || image.sources?.includes(url) || image.thumbnail === url);
        if (match) return match.fileId;
        try {
            const target = new URL(url, location.origin);
            if (target.origin !== location.origin || !/^\/(?:file|thumb)\//u.test(target.pathname)) return null;
            const fileId = target.pathname.replace(/^\/(?:file|thumb)\//u, '').split('/').map(decodeURIComponent).join('/');
            return media.some(image => image.fileId === fileId) ? fileId : null;
        } catch { return null; }
    }

    async function complete() {
        if (busy) return;
        const errors = validate?.() || [];
        if (errors.length) { setStatus(completeStatus, errors[0], 'bad'); showStatus(errors[0], 'bad'); return; }
        const profile = getProfile();
        const media = hostedMedia();
        const fileIds = [...new Set(media.map(image => image.fileId))];
        setOperationBusy(true);
        if (!fileIds.length) {
            if (albumId && removedFileIds.length) {
                setStatus(completeStatus, '请至少保留一张本站图片再更新图库；原文件不会删除。', 'bad');
                setOperationBusy(false);
                return;
            }
            try { await onSaved({ exportOnly: true }); await saveDraft(); setStatus(completeStatus, '导出内容已生成，可在下方复制或下载。', 'ok'); }
            catch (error) { setStatus(completeStatus, error.message || '导出未完成，请检查资料。', 'bad'); }
            finally { setOperationBusy(false); }
            return;
        }
        let saved = false;
        try {
            if (!await requireIdentity()) return;
            if (!identity.publicHandle) {
                const publicHandle = handleInput.value.trim().toLowerCase();
                if (!/^[a-z0-9][a-z0-9-]{2,31}$/u.test(publicHandle)) throw new Error('公开用户名需为 3–32 位小写字母、数字或短横线。');
                const handle = await requestJson('/api/user/handle', jsonOptions('PUT', { publicHandle }));
                identity.publicHandle = handle.publicHandle;
            }
            const activeIds = new Set(fileIds);
            const config = {
                mainFileId: media.find(image => image.viewerVisible !== false)?.fileId || media[0].fileId,
                avatarFileId: imageReferenceId(profile.avatarUrl, media),
                coverFileId: imageReferenceId(profile.coverUrl, media),
                viewerHiddenFileIds: [...new Set(media.filter(image => image.viewerVisible === false).map(image => image.fileId))],
                entranceQuote: profile.entranceQuote || '', raceColor: profile.raceColor || '', tierColor: profile.tierColor || '',
                ...(profile.metadata ? { metadata: profile.metadata } : {}),
            };
            await saveDraft();
            if (!await requireIdentity()) return;
            setStatus(completeStatus, '正在保存角色资料和公开图库…');
            const response = await requestJson('/api/user/charinfo/complete', jsonOptions('POST', {
                draftId, ...(albumId ? { albumId } : {}), characterName: profile.characterName,
                fileIds, removedFileIds: removedFileIds.filter(id => !activeIds.has(id)), config,
            }));
            if (!response?.album?.id || !safeUrl(response.remoteGalleryUrl)) throw new Error('无法确认图库结果，请保留草稿后重新检查。');
            albumId = response.album.id; savedFileIds = fileIds; removedFileIds = []; result = response; saved = true;
            await saveDraft();
            await onSaved(response);
            await saveDraft();
            setStatus(completeStatus, '公开图库已保存，原稿与 EJS 导出内容已更新。', 'ok');
            showStatus('角色资料和图库已保存，可以复制或下载最终内容。', 'ok');
        } catch (error) {
            const message = saved ? `公开图库已经保存，但本机草稿或导出更新未完成。${error.message || '请保留当前页面后重试。'}` : error.message || '保存未完成，当前资料和图片已保留。';
            setStatus(completeStatus, message, 'bad'); showStatus(message, 'bad');
        } finally { setOperationBusy(false); }
    }

    uploadButton.addEventListener('click', () => { if (!busy) fileInput.click(); });
    fileInput.addEventListener('change', () => { const files = [...fileInput.files]; fileInput.value = ''; void uploadFiles(files); });
    selectButton.addEventListener('click', () => { void openPicker(); });
    completeButton.addEventListener('click', () => { void complete(); });
    picker.querySelector('[data-picker-close]').addEventListener('click', () => picker.close());
    picker.addEventListener('close', () => { pickerController?.abort(); pickerVersion += 1; if (pickerOpener?.isConnected) pickerOpener.focus(); });
    pickerQuery.addEventListener('input', () => { pickerClear.hidden = !pickerQuery.value; });
    pickerQuery.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void loadPickerPage(true); } });
    pickerSearch.addEventListener('click', () => { void loadPickerPage(true); });
    pickerClear.addEventListener('click', () => { pickerQuery.value = ''; pickerClear.hidden = true; pickerQuery.focus(); void loadPickerPage(true); });
    pickerMore.addEventListener('click', () => { void loadPickerPage(false); });
    pickerAdd.addEventListener('click', async () => {
        if (busy) return;
        setOperationBusy(true);
        pickerAdd.disabled = true;
        try {
            if (!await requireIdentity()) {
                setStatus(pickerStatus, identity ? '当前登录账号已变化，请关闭选择器后切回原账号或新建角色。' : '登录已失效，请关闭选择器后重新登录。', 'bad');
                return;
            }
            const existing = new Set(hostedMedia().map(image => image.fileId));
            for (const id of [...selectedFiles]) {
                const file = knownFiles.get(id);
                if (!file || existing.has(id)) continue;
                addMedia({ fileId: id, url: file.publicUrl, title: file.file_name || id, moderationStatus: file.moderation_status });
                existing.add(id);
                await saveDraft();
            }
            picker.close(); renderSummary();
        } catch (error) { setStatus(pickerStatus, error.message || '图片已保留，请勿关闭页面。', 'bad'); }
        finally { setOperationBusy(false); updatePickerSelection(); }
    });
    renderSummary();

    return {
        snapshot: () => ({ draftId, albumId, ownerId, savedFileIds: [...savedFileIds], removedFileIds: [...removedFileIds], result }),
        restore(data = {}) {
            if (busy) return;
            draftId = typeof data.draftId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(data.draftId) ? data.draftId.toLowerCase() : crypto.randomUUID();
            albumId = typeof data.albumId === 'string' ? data.albumId : '';
            ownerId = typeof data.ownerId === 'string' ? data.ownerId : '';
            savedFileIds = Array.isArray(data.savedFileIds) ? data.savedFileIds.filter(id => typeof id === 'string') : [];
            removedFileIds = Array.isArray(data.removedFileIds) ? data.removedFileIds.filter(id => typeof id === 'string') : [];
            result = data.result && typeof data.result === 'object' ? data.result : null;
            renderSummary();
        },
        bindAlbum(id) { albumId = String(id || ''); removedFileIds = []; result = null; savedFileIds = [...new Set(hostedMedia().map(image => image.fileId))]; if (identity) ownerId = identity.id; renderSummary(); },
        removeMedia(image) { if (image.fileId && savedFileIds.includes(image.fileId) && !removedFileIds.includes(image.fileId)) removedFileIds.push(image.fileId); },
        reset() { if (busy) return; draftId = crypto.randomUUID(); albumId = ''; ownerId = ''; savedFileIds = []; removedFileIds = []; result = null; uploadResults.replaceChildren(); setStatus(uploadStatus, ''); setStatus(completeStatus, ''); renderSummary(); },
        isBusy: () => busy,
        renderSummary,
        complete,
    };
}
