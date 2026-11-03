import { ALLOWED_UPLOAD_TYPES, canonicalExtensionForMediaType, matchesAllowedFileSignature, validateImageDimensions } from './fileSignature.js';
import { MAX_UPLOAD_BYTES, USER_QUOTA_BYTES } from './auth/discordIdentity.js';
import { validateCharInfoCharacterName } from './charInfoGallery.js';
import { legacyFileRestriction } from './files/fileAccess.js';
import { uploadAuthorizationGuard } from './charinfoUploadAuth.js';
import { createCharInfoGalleryPack, displaySourcesFor } from './charInfoVisualPack.js';
import { charInfoVisualStorageKey } from './charInfoVisualConfig.js';
import { getImageDimensions } from '../upload/uploadTools.js';
import { uploadPreparedCharInfoFile } from '../upload/index.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEASE_MS = 12 * 60 * 1000;
const SNAPSHOT = `(SELECT json_array(a.owner_id, a.slug, a.name, a.char_info_character_name,
    a.description, a.visibility, a.updated_at,
    (SELECT json_group_array(json_array(file_id, position, created_at)) FROM
        (SELECT file_id, position, created_at FROM album_items WHERE album_id = a.id ORDER BY position, created_at, file_id)))
    FROM albums a WHERE a.id = ?)`;
const ELIGIBLE_SQL = `f.owner_id = ? AND f.moderation_status = 'active'
    AND f.file_type IN ('image/png','image/jpeg','image/gif','image/webp','image/avif','video/mp4','video/webm')
    AND COALESCE(json_extract(f.metadata, '$.ModerationStatus'), 'active') = 'active'
    AND COALESCE(json_extract(f.metadata, '$.Channel'), f.channel, '') NOT IN ('S3','WebDAV')
    AND (COALESCE(json_extract(f.metadata, '$.ListType'), f.list_type, '') = 'White'
      OR (COALESCE(json_extract(f.metadata, '$.ListType'), f.list_type, '') <> 'Block'
        AND COALESCE(json_extract(f.metadata, '$.Label'), f.label, '') <> 'adult'))`;

function fail(code, message, fileId) {
    const error = Object.assign(new Error(message), { code });
    if (fileId) error.fileId = fileId;
    throw error;
}

async function sha256(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authorizeAccount({ env, identity, authorize }) {
    if (!env.img_d1?.batch || typeof authorize !== 'function' || !identity?.id) fail('AUTH_REQUIRED', 'An authorized account is required');
    uploadAuthorizationGuard(identity);
    const current = await authorize();
    if (!current || current.id !== identity.id) fail('AUTH_REQUIRED', 'The authorized account changed');
    uploadAuthorizationGuard(current);
    const user = await env.img_d1.prepare('SELECT discord_id, role, status, used_bytes FROM users WHERE discord_id = ?').bind(identity.id).first();
    if (!user || user.status !== 'active') fail('AUTH_REQUIRED', 'The account is unavailable');
    return user;
}

async function operationKey(identity, requestId) {
    if (typeof requestId !== 'string' || !ID.test(requestId)) fail('INPUT_REJECTED', 'A valid request ID is required');
    return `charinfo.upload:${await sha256(`${identity.id}\n${requestId}`)}`;
}

async function loadOperation(env, key) {
    const row = await env.img_d1.prepare('SELECT value FROM other_data WHERE key = ?').bind(key).first();
    return row ? { record: JSON.parse(row.value), raw: row.value } : null;
}

function publicOrigin(requestUrl) {
    const url = new URL(requestUrl);
    if (url.protocol !== 'https:' || url.username || url.password) fail('STORAGE_UNAVAILABLE', 'An HTTPS service origin is required');
    return url.origin;
}

function normalizeManifest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['requestId', 'albumId', 'characterName', 'files', 'order'].includes(key))) fail('INPUT_REJECTED', 'Invalid save input');
    if (typeof body.requestId !== 'string' || !ID.test(body.requestId)
        || (body.albumId !== null && (typeof body.albumId !== 'string' || !UUID.test(body.albumId)))) fail('INPUT_REJECTED', 'Invalid request or gallery ID');
    const characterName = typeof body.characterName === 'string' ? body.characterName.trim() : '';
    if (!characterName || validateCharInfoCharacterName(characterName)) fail('INPUT_REJECTED', 'A valid character name is required');
    if (!Array.isArray(body.files) || body.files.length > 100 || !Array.isArray(body.order) || !body.order.length || body.order.length > 500) fail('INPUT_REJECTED', 'Invalid file or member count');
    const ids = new Set();
    const files = body.files.map(file => {
        if (!file || typeof file !== 'object' || Array.isArray(file)
            || Object.keys(file).sort().join(',') !== 'id,name,size,title,type'
            || typeof file.id !== 'string' || !ID.test(file.id) || ids.has(file.id)
            || typeof file.title !== 'string' || file.title.length > 500 || /[\x00-\x1f\x7f]/.test(file.title)
            || typeof file.name !== 'string' || !file.name || file.name.length > 512 || /[\x00-\x1f\x7f]/.test(file.name)
            || !ALLOWED_UPLOAD_TYPES.has(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_UPLOAD_BYTES) fail('INPUT_REJECTED', 'Invalid new file', file?.id);
        ids.add(file.id);
        return { id: file.id, title: file.title, name: file.name, type: file.type, size: file.size };
    });
    const seen = new Set();
    const uploads = new Set();
    const order = body.order.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 1) fail('INPUT_REJECTED', 'Invalid member order');
        const key = Object.keys(item)[0];
        if (!['itemId', 'uploadId'].includes(key) || typeof item[key] !== 'string' || !ID.test(item[key]) || seen.has(`${key}:${item[key]}`)) fail('INPUT_REJECTED', 'Invalid or repeated member');
        if (key === 'uploadId') {
            if (!ids.has(item.uploadId)) fail('INPUT_REJECTED', 'Unknown new file');
            uploads.add(item.uploadId);
        }
        seen.add(`${key}:${item[key]}`);
        return { [key]: item[key] };
    });
    if (uploads.size !== files.length || (body.albumId === null && order.some(item => item.itemId))) fail('INPUT_REJECTED', 'Every new file must appear once in the final order');
    return { requestId: body.requestId, albumId: body.albumId, characterName, files, order };
}

async function albumSnapshot(env, albumId) {
    return (await env.img_d1.prepare(`SELECT ${SNAPSHOT} AS snapshot`).bind(albumId).first())?.snapshot ?? null;
}

async function ownedAlbum(env, identity, albumId, characterName) {
    const album = await env.img_d1.prepare('SELECT * FROM albums WHERE id = ? AND owner_id = ?').bind(albumId, identity.id).first();
    if (!album || album.char_info_character_name !== characterName) fail('GALLERY_UNAVAILABLE', 'The owned gallery or character name does not match');
    return album;
}

async function memberFiles(env, albumId) {
    return (await env.img_d1.prepare(`SELECT f.*, ai.position, ai.created_at AS member_created_at
        FROM album_items ai JOIN files f ON f.id = ai.file_id WHERE ai.album_id = ?
        ORDER BY ai.position, ai.created_at, ai.file_id`).bind(albumId).all()).results || [];
}

function eligible(file, ownerId) {
    let metadata;
    try { metadata = JSON.parse(file.metadata); } catch { return false; }
    return file.owner_id === ownerId && file.moderation_status === 'active' && ALLOWED_UPLOAD_TYPES.has(file.file_type)
        && /\.(?:png|jpe?g|gif|webp|avif|mp4|webm)$/i.test(file.id)
        && (metadata.ModerationStatus ?? 'active') === 'active'
        && !['S3', 'WebDAV'].includes(metadata.Channel ?? file.channel)
        && !legacyFileRestriction({ ListType: metadata.ListType ?? file.list_type, Label: metadata.Label ?? file.label });
}

async function visualValue(env, albumId) {
    return (await env.img_d1.prepare('SELECT value FROM other_data WHERE key = ?').bind(charInfoVisualStorageKey(albumId)).first())?.value ?? null;
}

async function presentItems(albumId, files, requestUrl, characterName, visual) {
    const pack = createCharInfoGalleryPack({ album: { id: albumId, char_info_character_name: characterName },
        files, requestUrl, storedVisualConfig: visual, stableIdentity: true });
    if (pack.gallery.length !== files.length || pack.gallery.some((item, index) => item.sources[0] !== displaySourcesFor(files[index], requestUrl)[0]
        || item.title.length > 500) || !pack.gallery.some(item => item.viewerVisible !== false)) fail('PUBLICATION_BLOCKED', 'The complete gallery must contain displayable media');
    return Promise.all(pack.gallery.map(async (item, index) => ({
        id: await sha256(`${albumId}\n${files[index].id}`), title: item.title, url: item.sources[0],
        kind: files[index].file_type.startsWith('video/') ? 'video' : 'image',
    })));
}

function progress(record, fileId) {
    const result = { pending: true, completed: record.files.filter(file => file.state === 'uploaded').length, total: record.files.length,
        phase: record.files.every(file => file.state === 'uploaded') ? 'saving' : 'uploading' };
    if (fileId) result.fileId = fileId;
    return result;
}

async function withOperation(options, action) {
    await authorizeAccount(options);
    const { env, identity, requestId } = options;
    const key = await operationKey(identity, requestId);
    const loaded = await loadOperation(env, key);
    if (!loaded) fail('OPERATION_NOT_FOUND', 'Prepare the save operation first');
    const record = loaded.record;
    if (record.actor !== identity.id || record.requestId !== requestId) fail('AUTH_REQUIRED', 'The operation belongs to another account');
    if (record.status === 'rejected') fail('INPUT_REJECTED', 'This input was rejected before publishing any file');
    if (record.lease && record.lease.until > Date.now()) fail('OPERATION_BUSY', 'This operation is still running');
    const lease = crypto.randomUUID();
    record.lease = { id: lease, until: Date.now() + LEASE_MS };
    record.cancelled = false;
    let raw = JSON.stringify(record);
    const claimed = await env.img_d1.prepare('UPDATE other_data SET value = ? WHERE key = ? AND value = ?').bind(raw, key, loaded.raw).run();
    if (!claimed.meta.changes) fail('OPERATION_BUSY', 'This operation changed');
    const state = {
        record, key,
        async persist(statements = []) {
            const next = JSON.stringify(record);
            try {
                await env.img_d1.batch([
                    env.img_d1.prepare('UPDATE other_data SET value = CASE WHEN value = ? THEN ? ELSE NULL END WHERE key = ?').bind(raw, next, key),
                    ...statements,
                ]);
            } catch (error) {
                if (String(error.message).includes('NOT NULL constraint failed: other_data.value')) fail('OPERATION_BUSY', 'This operation was cancelled or changed');
                throw error;
            }
            raw = next;
        },
    };
    try {
        return await action(state);
    } catch (error) {
        if (error.code === 'INPUT_REJECTED') {
            if (record.quotaReserved) error.code = 'REQUEST_MISMATCH';
            else {
                record.status = 'rejected';
                // Establish the no-side-effects rejection durably before releasing the input lock.
                await state.persist();
            }
        }
        throw error;
    } finally {
        record.lease = null;
        // A cancelled request has a new durable value; the old worker must not overwrite it.
        await env.img_d1.prepare('UPDATE other_data SET value = ? WHERE key = ? AND value = ?').bind(JSON.stringify(record), key, raw).run();
    }
}

export async function prepareUploadOperation(options) {
    const { env, identity, body, requestUrl } = options;
    const user = await authorizeAccount(options);
    const origin = publicOrigin(requestUrl);
    const key = await operationKey(identity, body?.requestId);
    const existing = await loadOperation(env, key);
    let manifest;
    try { manifest = normalizeManifest(body); }
    catch (error) {
        if (existing && error.code === 'INPUT_REJECTED') fail('REQUEST_MISMATCH', 'The immutable request cannot be changed');
        throw error;
    }
    const digest = await sha256(JSON.stringify(manifest));
    if (existing) {
        if (existing.record.digest !== digest || existing.record.origin !== origin) fail('REQUEST_MISMATCH', 'The immutable request cannot be changed');
        if (existing.record.status === 'rejected') fail('INPUT_REJECTED', 'This input was rejected before publishing any file');
        return existing.record.result || { albumId: existing.record.albumId, ...progress(existing.record) };
    }
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
    if (user.role !== 'owner' && user.used_bytes + totalBytes > USER_QUOTA_BYTES) fail('INPUT_REJECTED', 'The complete operation exceeds the account quota');
    if (manifest.files.length && !env.CHARINFO_UPLOAD_STAGING?.put) fail('STORAGE_UNAVAILABLE', 'Private upload staging is unavailable');
    const albumId = manifest.albumId || crypto.randomUUID();
    const album = manifest.albumId ? await ownedAlbum(env, identity, albumId, manifest.characterName) : null;
    const existingFiles = album ? await memberFiles(env, albumId) : [];
    const mapping = new Map(await Promise.all(existingFiles.map(async file => [await sha256(`${albumId}\n${file.id}`), file])));
    const finalIds = manifest.order.map(item => {
        if (item.uploadId) return null;
        const file = mapping.get(item.itemId);
        if (!file || !eligible(file, identity.id)) fail('INPUT_REJECTED', 'An existing gallery member is unavailable');
        return file.id;
    });
    const now = Date.now();
    const files = manifest.files.map(file => ({ ...file, fileId: `users/${identity.id}/${crypto.randomUUID()}.${canonicalExtensionForMediaType(file.type)}`,
        stageKey: `${key.slice('charinfo.upload:'.length)}/${file.id}`, timestamp: now, state: 'prepared', digest: null, stageReady: false }));
    const uploads = new Map(files.map(file => [file.id, file.fileId]));
    const baseVisual = await visualValue(env, albumId);
    if (!files.length) {
        try { await presentItems(albumId, finalIds.map(id => existingFiles.find(file => file.id === id)), requestUrl, manifest.characterName, baseVisual); }
        catch (error) { if (error.code === 'PUBLICATION_BLOCKED') fail('INPUT_REJECTED', 'At least one final gallery member must be displayable'); throw error; }
    }
    const record = { actor: identity.id, requestId: manifest.requestId, digest, manifest, origin, albumId,
        albumSlug: album?.slug || `character-${albumId}`,
        baseVisual,
        baseSnapshot: manifest.albumId ? await albumSnapshot(env, albumId) : null,
        finalIds: manifest.order.map((item, index) => item.uploadId ? uploads.get(item.uploadId) : finalIds[index]),
        files, totalBytes, quotaReserved: false, status: 'prepared', createdAt: now, lease: null };
    await authorizeAccount(options);
    const inserted = await env.img_d1.prepare(`INSERT INTO other_data (key, value, type) VALUES (?, ?, 'charinfo_upload') ON CONFLICT(key) DO NOTHING`)
        .bind(key, JSON.stringify(record)).run();
    if (!inserted.meta.changes) {
        const concurrent = await loadOperation(env, key);
        if (concurrent.record.digest !== digest || concurrent.record.origin !== origin) fail('REQUEST_MISMATCH', 'The immutable request cannot be changed');
        return concurrent.record.result || { albumId: concurrent.record.albumId, ...progress(concurrent.record) };
    }
    return { albumId, ...progress(record) };
}

export async function stageUploadOperationFile(options) {
    return withOperation(options, async state => {
        const { env, file, uploadId } = options;
        const { record } = state;
        if (record.result) return record.result;
        const entry = record.files.find(item => item.id === uploadId);
        if (!entry) fail('REQUEST_MISMATCH', 'Unknown upload ID');
        const bucket = env.CHARINFO_UPLOAD_STAGING;
        if (!bucket?.put) fail('STORAGE_UNAVAILABLE', 'Private upload staging is unavailable', uploadId);
        if (!file || (file.size !== undefined && file.size !== entry.size) || file.type !== entry.type
            || (file.name !== undefined && file.name !== entry.name) || typeof file.stream !== 'function') fail('INPUT_REJECTED', 'File metadata does not match the complete request', uploadId);
        const attemptKey = `${state.key.slice('charinfo.upload:'.length)}/${entry.id}/${crypto.randomUUID()}`;
        const digestStream = new crypto.DigestStream('SHA-256');
        const digestResult = digestStream.digest;
        digestResult.catch(() => {});
        const hasher = digestStream.getWriter();
        const fixed = new FixedLengthStream(entry.size);
        const output = fixed.writable.getWriter();
        const input = file.stream().getReader();
        const header = new Uint8Array(65536);
        let headerLength = 0;
        let size = 0;
        const pump = async () => {
            try {
                for (;;) {
                    const { value, done } = await input.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > entry.size) fail('INPUT_REJECTED', 'The file exceeds its declared size', uploadId);
                    const retained = value.subarray(0, header.length - headerLength);
                    header.set(retained, headerLength);
                    headerLength += retained.byteLength;
                    await Promise.all([hasher.write(value), output.write(value)]);
                }
                if (size !== entry.size) fail('INPUT_REJECTED', 'The file does not match its declared size', uploadId);
                await Promise.all([hasher.close(), output.close()]);
            } catch (error) {
                await Promise.allSettled([hasher.abort(error), output.abort(error), input.cancel(error)]);
                throw error;
            }
        };
        try {
            const [stored] = await Promise.all([
                bucket.put(attemptKey, fixed.readable, { httpMetadata: { contentType: entry.type } }), pump(),
            ]);
            const digest = [...new Uint8Array(await digestResult)].map(byte => byte.toString(16).padStart(2, '0')).join('');
            const headFile = new Blob([header.subarray(0, headerLength)], { type: entry.type });
            if (!await matchesAllowedFileSignature(headFile, entry.type)) fail('INPUT_REJECTED', 'The file signature does not match the complete request', uploadId);
            if (entry.type.startsWith('image/') && validateImageDimensions(getImageDimensions(await headFile.arrayBuffer(), entry.type))) fail('INPUT_REJECTED', 'The image dimensions are unsafe', uploadId);
            if (entry.digest && entry.digest !== digest) fail('REQUEST_MISMATCH', 'The immutable file bytes cannot be changed', uploadId);
            await authorizeAccount(options);
            if (entry.stageReady) {
                const previous = await bucket.head(entry.stageKey);
                if (previous && previous.size === entry.size && previous.etag === entry.stageEtag) {
                    await bucket.delete(attemptKey);
                    return progress(record);
                }
            }
            entry.digest = digest;
            entry.stageKey = attemptKey;
            entry.stageEtag = stored.etag;
            entry.stageReady = true;
            if (entry.state === 'prepared') entry.state = 'staged';
            await state.persist();
            return progress(record);
        } catch (error) {
            await bucket.delete(attemptKey).catch(() => {});
            throw error;
        }
    });
}

async function selectedFiles(env, record) {
    const rows = (await env.img_d1.prepare('SELECT f.* FROM files f JOIN json_each(?) ids ON ids.value = f.id').bind(JSON.stringify(record.finalIds)).all()).results || [];
    const byId = new Map(rows.map(file => [file.id, file]));
    const files = record.finalIds.map(id => byId.get(id));
    if (files.some(file => !file || !eligible(file, record.actor))) fail('PUBLICATION_BLOCKED', 'Every final member must be available in the public gallery');
    return files;
}

async function checkSnapshot(env, record) {
    if (await albumSnapshot(env, record.albumId) !== record.baseSnapshot
        || await visualValue(env, record.albumId) !== record.baseVisual) fail('GALLERY_CONFLICT', 'The gallery changed while this operation was pending');
}

async function reserveQuota(options, state) {
    const { record } = state;
    if (record.quotaReserved) return;
    const { env, identity } = options;
    for (const file of record.files) {
        if (!file.stageReady || !file.digest) fail('STAGING_INCOMPLETE', 'Stage every new file before committing', file.id);
        const head = await env.CHARINFO_UPLOAD_STAGING.head(file.stageKey);
        if (!head || head.size !== file.size || head.etag !== file.stageEtag) fail('STAGING_MISSING', 'A complete staged file is unavailable', file.id);
    }
    const user = await authorizeAccount(options);
    await checkSnapshot(env, record);
    if (user.role !== 'owner' && user.used_bytes + record.totalBytes > USER_QUOTA_BYTES) fail('INPUT_REJECTED', 'The complete operation exceeds the account quota');
    record.quotaReserved = true;
    record.status = 'uploading';
    try {
        await state.persist([
            env.img_d1.prepare(`UPDATE users SET used_bytes = CASE WHEN status = 'active'
                AND (role = 'owner' OR used_bytes + ? <= ?) THEN used_bytes + ? ELSE NULL END,
                updated_at = ? WHERE discord_id = ?`).bind(record.totalBytes, USER_QUOTA_BYTES, record.totalBytes, Date.now(), identity.id),
        ]);
    } catch (error) {
        record.quotaReserved = false;
        record.status = 'prepared';
        if (String(error.message).includes('NOT NULL constraint failed: users.used_bytes')) fail('INPUT_REJECTED', 'The complete operation exceeds the account quota');
        throw error;
    }
}

async function promoteFile(options, state, entry) {
    const { record } = state;
    const { env, identity } = options;
    let stored = await env.img_d1.prepare('SELECT * FROM files WHERE id = ?').bind(entry.fileId).first();
    if (!stored && ['inflight', 'uncertain'].includes(entry.state) && entry.target?.channel !== 'cfr2') {
        entry.state = 'uncertain';
        await state.persist();
        fail('UPLOAD_UNCERTAIN', 'The upstream upload result cannot be verified; it will not be resent automatically', entry.id);
    }
    if (!stored) {
        const object = await env.CHARINFO_UPLOAD_STAGING.get(entry.stageKey);
        if (!object?.body || object.etag !== entry.stageEtag || object.size !== entry.size) fail('STAGING_MISSING', 'The immutable staged file is unavailable', entry.id);
        const file = new File([await object.blob()], entry.name, { type: entry.type });
        await authorizeAccount(options);
        try {
            const response = await uploadPreparedCharInfoFile({ env, identity, file, fileId: entry.fileId, requestUrl: record.origin,
                target: entry.target, timestamp: entry.timestamp, authorize: () => authorizeAccount(options),
                beforeUpload: async target => {
                    await authorizeAccount(options);
                    entry.target = { channel: target.channel, channelName: target.channelName };
                    entry.state = 'inflight';
                    await state.persist();
                } });
            stored = await env.img_d1.prepare('SELECT * FROM files WHERE id = ?').bind(entry.fileId).first();
            if (!stored && !response.ok) fail(entry.state === 'inflight' && entry.target?.channel !== 'cfr2' ? 'UPLOAD_UNCERTAIN' : 'UPLOAD_FAILED', 'The upload did not finish', entry.id);
        } catch (error) {
            if (error.code === 'AUTH_REQUIRED' || error.code === 'OPERATION_BUSY') throw error;
            stored = await env.img_d1.prepare('SELECT * FROM files WHERE id = ?').bind(entry.fileId).first();
            if (!stored) {
                if (entry.state === 'inflight' && entry.target?.channel !== 'cfr2') entry.state = 'uncertain';
                await state.persist();
                fail(entry.state === 'uncertain' ? 'UPLOAD_UNCERTAIN' : 'UPLOAD_FAILED', 'The upload did not finish', entry.id);
            }
        }
    }
    await authorizeAccount(options);
    if (!stored || stored.owner_id !== identity.id || stored.file_size_bytes !== entry.size) fail('UPLOAD_UNCERTAIN', 'The stored file could not be verified', entry.id);
    entry.state = 'uploaded';
    await state.persist();
    if (!eligible(stored, identity.id)) fail('PUBLICATION_BLOCKED', 'The uploaded file is unavailable for public sharing', entry.id);
    return progress(record, entry.id);
}

export async function commitUploadOperation(options) {
    return withOperation(options, async state => {
        const { env, identity, requestUrl } = options;
        const { record } = state;
        if (publicOrigin(requestUrl) !== record.origin) fail('REQUEST_MISMATCH', 'The service origin changed');
        if (record.result) return record.result;
        await reserveQuota(options, state);
        const pending = record.files.find(file => file.state !== 'uploaded');
        if (pending) return promoteFile(options, state, pending);
        await authorizeAccount(options);
        await checkSnapshot(env, record);
        const files = await selectedFiles(env, record);
        const now = Date.now();
        const finalIds = JSON.stringify(record.finalIds);
        const result = { albumId: record.albumId, characterName: record.manifest.characterName,
            remoteGalleryUrl: `${record.origin}/api/public/album-gallery/${record.albumId}`,
            items: await presentItems(record.albumId, files, requestUrl, record.manifest.characterName, record.baseVisual) };
        record.result = result;
        record.finalVersion = await sha256(JSON.stringify({ albumId: record.albumId, fileIds: record.finalIds, savedAt: now }));
        record.status = 'completed';
        const updating = record.manifest.albumId !== null;
        const albumGuard = updating ? `${SNAPSHOT} = ?` : 'NOT EXISTS (SELECT 1 FROM albums WHERE id = ?)';
        const guardArgs = updating ? [record.albumId, record.baseSnapshot] : [record.albumId];
        const authorization = uploadAuthorizationGuard(identity);
        try {
            await state.persist([
                env.img_d1.prepare(`INSERT INTO albums (id, owner_id, slug, name, char_info_character_name, visibility, created_at, updated_at)
                    VALUES (?, ?, ?, CASE WHEN ${albumGuard}
                        AND ${authorization.sql}
                        AND (SELECT value FROM other_data WHERE key = ?) IS ?
                        AND EXISTS (SELECT 1 FROM users WHERE discord_id = ? AND status = 'active')
                        AND (SELECT COUNT(*) FROM files f JOIN json_each(?) ids ON ids.value = f.id WHERE ${ELIGIBLE_SQL}) = ?
                        THEN ? ELSE NULL END, ?, 'public', ?, ?)
                    ON CONFLICT(id) DO UPDATE SET char_info_character_name = excluded.char_info_character_name, updated_at = excluded.updated_at
                    WHERE albums.owner_id = excluded.owner_id`)
                    .bind(record.albumId, identity.id, record.albumSlug, ...guardArgs, ...authorization.bindings,
                        charInfoVisualStorageKey(record.albumId), record.baseVisual,
                        identity.id, finalIds, identity.id, record.finalIds.length,
                        record.manifest.characterName, record.manifest.characterName, now, now),
                env.img_d1.prepare(`DELETE FROM album_items WHERE album_id = ? AND file_id NOT IN (SELECT value FROM json_each(?))`).bind(record.albumId, finalIds),
                env.img_d1.prepare(`INSERT INTO album_items (album_id, file_id, position, created_at)
                    SELECT ?, value, CAST(key AS INTEGER), ? FROM json_each(?) WHERE 1
                    ON CONFLICT(album_id,file_id) DO UPDATE SET position = excluded.position`).bind(record.albumId, now, finalIds),
            ]);
        } catch (error) {
            delete record.result;
            delete record.finalVersion;
            record.status = 'uploading';
            const permitted = await env.img_d1.prepare(`SELECT ${authorization.sql} AS allowed`).bind(...authorization.bindings).first();
            if (!permitted?.allowed) fail('AUTH_REQUIRED', 'Upload authorization expired or was revoked before saving');
            if (String(error.message).includes('NOT NULL constraint failed: albums.name') || String(error.message).includes('UNIQUE constraint failed')) fail('GALLERY_CONFLICT', 'The gallery or file permissions changed before saving');
            throw error;
        }
        return result;
    });
}

export async function readUploadGallery(options) {
    const { env, identity, albumId, characterName, requestUrl } = options;
    await authorizeAccount(options);
    publicOrigin(requestUrl);
    if (typeof albumId !== 'string' || !UUID.test(albumId) || typeof characterName !== 'string' || !characterName || characterName !== characterName.trim() || validateCharInfoCharacterName(characterName)) fail('INPUT_REJECTED', 'Invalid gallery identity');
    await ownedAlbum(env, identity, albumId, characterName);
    const files = await memberFiles(env, albumId);
    if (files.length > 500 || files.some(file => !eligible(file, identity.id))) fail('GALLERY_UNAVAILABLE', 'A gallery member is unavailable');
    await authorizeAccount(options);
    return { albumId, characterName, items: await presentItems(albumId, files, requestUrl, characterName, await visualValue(env, albumId)) };
}

export async function cancelUploadOperation(options) {
    await authorizeAccount(options);
    const { env, identity, requestId } = options;
    const key = await operationKey(identity, requestId);
    const loaded = await loadOperation(env, key);
    if (!loaded || loaded.record.result) return { cancelled: true };
    loaded.record.cancelled = true;
    loaded.record.lease = null;
    const changed = await env.img_d1.prepare('UPDATE other_data SET value = ? WHERE key = ? AND value = ?')
        .bind(JSON.stringify(loaded.record), key, loaded.raw).run();
    if (!changed.meta.changes) fail('OPERATION_BUSY', 'The operation changed during cancellation');
    return { cancelled: true };
}
