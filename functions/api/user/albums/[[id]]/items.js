import { getDiscordIdentity } from '../../../../utils/auth/discordIdentity.js';

export async function onRequestPost(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const { fileId, position = 0 } = await context.request.json();
    const album = await ownedAlbum(context.env, context.params.id, identity);
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
    const album = await ownedAlbum(context.env, context.params.id, identity);
    if (!album) return json({ error: 'Album not found' }, 404);
    await context.env.img_d1.prepare('DELETE FROM album_items WHERE album_id = ? AND file_id = ?').bind(album.id, fileId).run();
    return json({ success: true });
}

export async function onRequestPatch(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const { fileId, position } = await context.request.json();
    const album = await ownedAlbum(context.env, context.params.id, identity);
    if (!album) return json({ error: 'Album not found' }, 404);
    await context.env.img_d1.prepare('UPDATE album_items SET position = ? WHERE album_id = ? AND file_id = ?').bind(Number(position) || 0, album.id, fileId).run();
    return json({ success: true });
}

async function ownedAlbum(env, id, identity) {
    return env.img_d1.prepare('SELECT id FROM albums WHERE id = ? AND owner_id = ?').bind(id, identity.id).first();
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
