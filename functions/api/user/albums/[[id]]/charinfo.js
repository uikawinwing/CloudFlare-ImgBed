import { getDiscordIdentity } from '../../../../utils/auth/discordIdentity.js';
import {
    charInfoVisualStorageKey,
    emptyCharInfoVisualConfig,
    parseStoredCharInfoVisualConfig,
    validateCharInfoVisualConfig,
} from '../../../../utils/charInfoVisualConfig.js';
import { normalizeAlbumIdParam } from './items.js';

export async function onRequestGet(context) {
    const access = await resolveAccess(context);
    if (access.response) return access.response;
    const row = await context.env.img_d1.prepare('SELECT value FROM other_data WHERE key = ?').bind(charInfoVisualStorageKey(access.album.id)).first();
    return json({ config: row?.value ? parseStoredCharInfoVisualConfig(row.value) : emptyCharInfoVisualConfig() });
}

export async function onRequestPut(context) {
    const access = await resolveAccess(context);
    if (access.response) return access.response;

    let body;
    try {
        body = await context.request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }
    const { config, errors } = validateCharInfoVisualConfig(body?.config ?? body);
    if (errors.length) return json({ error: errors[0], errors }, 400);

    const itemRows = await context.env.img_d1.prepare(
        'SELECT f.id, f.file_type FROM album_items ai JOIN files f ON f.id = ai.file_id WHERE ai.album_id = ?',
    ).bind(access.album.id).all();
    const itemTypes = new Map((itemRows.results || []).map(item => [item.id, String(item.file_type || '')]));
    const referencedIds = [config.mainFileId, config.avatarFileId, config.coverFileId, ...config.viewerHiddenFileIds].filter(Boolean);
    const missing = referencedIds.find(id => !itemTypes.has(id));
    if (missing) return json({ error: 'Visual config can only reference files inside this album' }, 400);
    if (config.avatarFileId && !itemTypes.get(config.avatarFileId).startsWith('image/')) {
        return json({ error: 'Avatar must be a static or animated image, not a video' }, 400);
    }
    if (config.coverFileId && !itemTypes.get(config.coverFileId).startsWith('image/')) {
        return json({ error: 'Cover must be a static or animated image, not a video' }, 400);
    }

    const key = charInfoVisualStorageKey(access.album.id);
    const stored = JSON.stringify(config);
    await context.env.img_d1.prepare(
        "INSERT INTO other_data (key, value, type, description, created_at, updated_at) VALUES (?, ?, 'charinfo_visual', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, description = excluded.description, updated_at = CURRENT_TIMESTAMP",
    ).bind(key, stored, `CharInfo visual config for album ${access.album.id}`).run();
    await context.env.img_d1.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').bind(Date.now(), access.album.id).run();
    return json({ config });
}

export async function onRequestDelete(context) {
    const access = await resolveAccess(context);
    if (access.response) return access.response;
    await context.env.img_d1.prepare('DELETE FROM other_data WHERE key = ?').bind(charInfoVisualStorageKey(access.album.id)).run();
    await context.env.img_d1.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').bind(Date.now(), access.album.id).run();
    return json({ success: true });
}

async function resolveAccess(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return { response: json({ error: 'Discord sign-in is required' }, 401) };
    if (!context.env.img_d1?.prepare) return { response: json({ error: 'D1 is required' }, 503) };
    const albumId = normalizeAlbumIdParam(context.params.id);
    if (!albumId) return { response: json({ error: 'Album not found' }, 404) };
    const album = await context.env.img_d1.prepare('SELECT id, owner_id FROM albums WHERE id = ?').bind(albumId).first();
    if (!album || album.owner_id !== identity.id) return { response: json({ error: 'Album not found' }, 404) };
    return { identity, album };
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}
