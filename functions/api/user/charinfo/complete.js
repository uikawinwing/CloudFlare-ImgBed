import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { CHAR_INFO_ID_PATTERN, validateCharInfoCharacterName } from '../../../utils/charInfoGallery.js';
import { charInfoVisualStorageKey, validateCharInfoVisualConfig } from '../../../utils/charInfoVisualConfig.js';
import { legacyFileRestriction } from '../../../utils/files/fileAccess.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ALLOWED_MEDIA_SQL = "(f.file_type LIKE 'image/%' OR f.file_type IN ('video/mp4', 'video/webm'))";
const AVAILABLE_FILE_SQL = `COALESCE(json_extract(f.metadata, '$.ModerationStatus'), 'active') = 'active'
    AND COALESCE(json_extract(f.metadata, '$.Channel'), f.channel, '') NOT IN ('S3', 'WebDAV')
    AND (COALESCE(json_extract(f.metadata, '$.ListType'), f.list_type, '') = 'White'
        OR (COALESCE(json_extract(f.metadata, '$.ListType'), f.list_type, '') <> 'Block'
            AND COALESCE(json_extract(f.metadata, '$.Label'), f.label, '') <> 'adult'))`;

export async function onRequestPost(context) {
    const { request, env } = context;
    const identity = await getDiscordIdentity(env, request);
    if (!identity) return json({ error: 'Discord sign-in is required', code: 'SIGN_IN_REQUIRED' }, 401);
    if (!env.img_d1?.batch) return json({ error: 'D1 is required', code: 'STORAGE_UNAVAILABLE' }, 503);

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body', code: 'INVALID_INPUT' }, 400);
    }
    const draftId = typeof body?.draftId === 'string' ? body.draftId.toLowerCase() : '';
    const albumId = body?.albumId === undefined || body.albumId === null ? draftId : body.albumId;
    const updating = body?.albumId !== undefined && body.albumId !== null;
    const characterName = typeof body?.characterName === 'string' ? body.characterName.trim() : '';
    if (!UUID_PATTERN.test(draftId) || typeof albumId !== 'string' || !CHAR_INFO_ID_PATTERN.test(albumId)
        || !characterName || validateCharInfoCharacterName(characterName)) {
        return json({ error: 'A valid draft ID and character name are required', code: 'INVALID_INPUT' }, 400);
    }
    if (!Array.isArray(body.fileIds) || !body.fileIds.length || body.fileIds.length > 500
        || body.fileIds.some(id => typeof id !== 'string' || !id || id.length > 512 || id.trim() !== id)) {
        return json({ error: 'Choose between 1 and 500 uploaded media files', code: 'INVALID_INPUT' }, 400);
    }
    const fileIds = [...new Set(body.fileIds)];
    const removedFileIds = body.removedFileIds ?? [];
    if (!Array.isArray(removedFileIds) || removedFileIds.length > 500
        || removedFileIds.some(id => typeof id !== 'string' || !id || id.length > 512 || id.trim() !== id || fileIds.includes(id))) {
        return json({ error: 'Removed files must be different from the selected files', code: 'INVALID_INPUT' }, 400);
    }
    const { config, errors } = validateCharInfoVisualConfig(body.config);
    if (errors.length) return json({ error: errors[0], code: 'INVALID_CONFIG', errors }, 400);
    const references = [config.mainFileId, config.avatarFileId, config.coverFileId, ...config.viewerHiddenFileIds].filter(Boolean);
    if (references.some(id => !fileIds.includes(id))) {
        return json({ error: 'Display settings can only reference the selected files', code: 'INVALID_CONFIG' }, 400);
    }

    const user = await env.img_d1.prepare('SELECT public_handle, status FROM users WHERE discord_id = ?').bind(identity.id).first();
    if (user?.status !== 'active') return json({ error: 'An active account is required', code: 'ACCOUNT_UNAVAILABLE' }, 403);
    if (!CHAR_INFO_ID_PATTERN.test(user.public_handle || '')) {
        return json({ error: 'Choose a public handle before creating the gallery', code: 'PUBLIC_HANDLE_REQUIRED' }, 409);
    }
    const album = await env.img_d1.prepare('SELECT id, owner_id, slug FROM albums WHERE id = ?').bind(albumId).first();
    if ((updating && !album) || (album && album.owner_id !== identity.id)) {
        return json({ error: 'Album not found', code: 'ALBUM_NOT_FOUND' }, 404);
    }
    const serializedIds = JSON.stringify(fileIds);
    const serializedRemovedIds = JSON.stringify([...new Set(removedFileIds)]);
    const files = await env.img_d1.prepare(
        'SELECT f.id, f.file_type, f.moderation_status, f.metadata, f.channel, f.list_type, f.label FROM files f JOIN json_each(?) selected ON selected.value = f.id WHERE f.owner_id = ?',
    ).bind(serializedIds, identity.id).all();
    if (files.results.length !== fileIds.length) {
        return json({ error: 'One or more selected files are unavailable', code: 'FILES_UNAVAILABLE' }, 400);
    }
    if (files.results.some(file => file.moderation_status !== 'active')) {
        return json({ error: 'Selected files must finish review before publishing', code: 'FILES_NOT_READY' }, 409);
    }
    if (files.results.some(file => !isMedia(file.file_type))) {
        return json({ error: 'Only images and supported videos can be added', code: 'INVALID_MEDIA' }, 400);
    }
    if (files.results.some(file => !isAvailable(file))) {
        return json({ error: 'One or more selected files cannot be shared', code: 'FILES_UNAVAILABLE' }, 400);
    }
    const imageIds = new Set(files.results.filter(file => String(file.file_type).startsWith('image/')).map(file => file.id));
    if ([config.avatarFileId, config.coverFileId].some(id => id && !imageIds.has(id))) {
        return json({ error: 'Avatar and cover must be images', code: 'INVALID_CONFIG' }, 400);
    }

    const slug = album?.slug || `character-${draftId}`;
    const now = Date.now();
    const db = env.img_d1;
    const albumGuard = updating
        ? 'EXISTS (SELECT 1 FROM albums WHERE id = ? AND owner_id = ? AND slug = ?)'
        : 'NOT EXISTS (SELECT 1 FROM albums WHERE id = ? AND (owner_id <> ? OR slug <> ?))';
    try {
        await db.batch([
            // A failed guard produces an invalid name, so the NOT NULL constraint aborts the entire batch.
            // Recheck all mutable permissions here: the earlier reads only provide useful error messages.
            db.prepare(`INSERT INTO albums (id, owner_id, slug, name, char_info_character_name, visibility, created_at, updated_at)
                VALUES (?, ?, ?, CASE WHEN
                    EXISTS (SELECT 1 FROM users WHERE discord_id = ? AND status = 'active' AND public_handle = ?)
                    AND ${albumGuard}
                    AND (SELECT COUNT(*) FROM files f JOIN json_each(?) selected ON selected.value = f.id
                        WHERE f.owner_id = ? AND f.moderation_status = 'active' AND ${ALLOWED_MEDIA_SQL} AND ${AVAILABLE_FILE_SQL}) = ?
                    AND NOT EXISTS (SELECT 1 FROM files f WHERE f.id IN (?, ?) AND f.file_type NOT LIKE 'image/%')
                    THEN ? ELSE NULL END, ?, 'public', ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, char_info_character_name = excluded.char_info_character_name,
                    updated_at = excluded.updated_at WHERE albums.owner_id = excluded.owner_id`)
                .bind(albumId, identity.id, slug, identity.id, user.public_handle, albumId, identity.id, slug,
                    serializedIds, identity.id, fileIds.length, config.avatarFileId, config.coverFileId, characterName, characterName, now, now),
            db.prepare('DELETE FROM album_covers WHERE album_id = ? AND file_id IN (SELECT value FROM json_each(?))')
                .bind(albumId, serializedRemovedIds),
            db.prepare('DELETE FROM album_items WHERE album_id = ? AND file_id IN (SELECT value FROM json_each(?))')
                .bind(albumId, serializedRemovedIds),
            db.prepare(`WITH remaining AS MATERIALIZED (
                SELECT file_id, ROW_NUMBER() OVER (ORDER BY position, created_at, file_id) AS item_order
                FROM album_items WHERE album_id = ? AND file_id NOT IN (SELECT value FROM json_each(?))
            ) UPDATE album_items SET position = ? + (SELECT item_order FROM remaining WHERE remaining.file_id = album_items.file_id)
                WHERE album_id = ? AND file_id IN (SELECT file_id FROM remaining)`)
                .bind(albumId, serializedIds, fileIds.length - 1, albumId),
            db.prepare(`INSERT INTO album_items (album_id, file_id, position, created_at)
                SELECT ?, value, CAST(key AS INTEGER), ? FROM json_each(?) WHERE 1
                ON CONFLICT(album_id, file_id) DO UPDATE SET position = excluded.position`)
                .bind(albumId, now, serializedIds),
            db.prepare(`INSERT INTO other_data (key, value, type, description, created_at, updated_at)
                VALUES (?, ?, 'charinfo_visual', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type,
                    description = excluded.description, updated_at = CURRENT_TIMESTAMP`)
                .bind(charInfoVisualStorageKey(albumId), JSON.stringify(config), `CharInfo visual config for album ${albumId}`),
        ]);
    } catch (error) {
        const message = String(error?.message || '');
        if (message.includes('NOT NULL constraint failed: albums.name') || message.includes('UNIQUE constraint failed')) {
            return json({ error: 'The gallery or selected files changed. Reload before publishing again.', code: 'COMPLETION_CONFLICT' }, 409);
        }
        console.error('CharInfo completion could not be saved');
        return json({ error: 'The gallery could not be saved. Your draft can be retried.', code: 'SAVE_FAILED' }, 503);
    }

    return json({
        album: { id: albumId, name: characterName, slug },
        remoteGalleryUrl: publicUrl(request.url, `/api/public/charinfo/${encodeURIComponent(albumId)}?view=gallery`),
        albumUrl: publicUrl(request.url, `/gallery/${encodeURIComponent(user.public_handle)}/${encodeURIComponent(slug)}`),
        config,
    });
}

function isMedia(type) {
    return typeof type === 'string' && (type.startsWith('image/') || ['video/mp4', 'video/webm'].includes(type));
}

function isAvailable(file) {
    let metadata;
    try {
        metadata = JSON.parse(file.metadata);
    } catch {
        return false;
    }
    const accessMetadata = { ListType: metadata?.ListType ?? file.list_type, Label: metadata?.Label ?? file.label };
    return (metadata?.ModerationStatus ?? 'active') === 'active'
        && !legacyFileRestriction(accessMetadata) && !['S3', 'WebDAV'].includes(metadata?.Channel ?? file.channel);
}

function publicUrl(requestUrl, pathname) {
    const url = new URL(pathname, requestUrl);
    url.protocol = 'https:';
    return url.toString();
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}
