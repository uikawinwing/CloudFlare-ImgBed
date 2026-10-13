import { getDiscordIdentity } from '../../../../utils/auth/discordIdentity.js';

export async function onRequestPost(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const { fileId, position = 0 } = await context.request.json();
    const albumId = normalizeAlbumIdParam(context.params.id);
    if (!albumId) return json({ error: 'Album not found' }, 404);
    const album = await ownedAlbum(context.env, albumId, identity);
    if (!album) return json({ error: 'Album not found' }, 404);
    const file = await context.env.img_d1.prepare('SELECT id FROM files WHERE id = ? AND owner_id = ?').bind(fileId, identity.id).first();
    if (!file) return json({ error: 'File not found' }, 404);
    await context.env.img_d1.prepare('INSERT INTO album_items (album_id, file_id, position, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(album_id, file_id) DO UPDATE SET position = excluded.position').bind(album.id, fileId, Number(position) || 0, Date.now()).run();
    return json({ success: true });
}

export async function onRequestDelete(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const fileId = new URL(context.request.url).searchParams.get('fileId');
    const albumId = normalizeAlbumIdParam(context.params.id);
    if (!albumId) return json({ error: 'Album not found' }, 404);
    const album = await ownedAlbum(context.env, albumId, identity);
    if (!album) return json({ error: 'Album not found' }, 404);
    await context.env.img_d1.batch([
        context.env.img_d1.prepare('DELETE FROM album_covers WHERE album_id = ? AND file_id = ?').bind(album.id, fileId),
        context.env.img_d1.prepare('DELETE FROM album_items WHERE album_id = ? AND file_id = ?').bind(album.id, fileId),
    ]);
    return json({ success: true });
}

export async function onRequestPatch(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const { fileId, swapWithFileId } = await context.request.json();
    const albumId = normalizeAlbumIdParam(context.params.id);
    if (!albumId) return json({ error: 'Album not found' }, 404);
    const album = await ownedAlbum(context.env, albumId, identity);
    if (!album) return json({ error: 'Album not found' }, 404);
    if (!validFileId(fileId) || !validFileId(swapWithFileId) || fileId === swapWithFileId) {
        return json({ error: 'Two different album items are required' }, 400);
    }
    const result = await context.env.img_d1.prepare(`WITH positions AS MATERIALIZED (
        SELECT file_id, position FROM album_items WHERE album_id = ? AND file_id IN (?, ?)
    ) UPDATE album_items SET position = CASE WHEN file_id = ?
        THEN (SELECT position FROM positions WHERE file_id = ?)
        ELSE (SELECT position FROM positions WHERE file_id = ?) END
        WHERE album_id = ? AND file_id IN (?, ?) AND (SELECT COUNT(*) FROM positions) = 2`)
        .bind(album.id, fileId, swapWithFileId, fileId, swapWithFileId, fileId, album.id, fileId, swapWithFileId).run();
    if (result.meta.changes !== 2) return json({ error: 'Album item not found' }, 404);
    return json({ success: true });
}

export function normalizeAlbumIdParam(value) {
    if (Array.isArray(value)) return value.length === 1 && typeof value[0] === 'string' && value[0] ? value[0] : null;
    if (typeof value !== 'string' || !value || value.includes('/')) return null;
    return value;
}

async function ownedAlbum(env, id, identity) {
    return env.img_d1.prepare('SELECT id FROM albums WHERE id = ? AND owner_id = ?').bind(id, identity.id).first();
}

function validFileId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 1024;
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
