import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { normalizeCharInfoCharacterName, validateCharInfoCharacterName } from '../../../utils/charInfoGallery.js';
import { normalizeSlug } from './index.js';

export async function onRequest(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const id = context.params.id;
    const album = await context.env.img_d1.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first();
    if (!album) return json({ error: 'Album not found' }, 404);
    if (album.owner_id !== identity.id && identity.role !== 'owner') return json({ error: 'Only the owner can change this album' }, 403);
    if (context.request.method === 'GET') {
        const items = await context.env.img_d1.prepare('SELECT f.id, f.file_name, f.file_type, f.file_size_bytes, f.timestamp, f.visibility, f.moderation_status, ai.position FROM album_items ai JOIN files f ON f.id = ai.file_id WHERE ai.album_id = ? ORDER BY ai.position, ai.created_at').bind(id).all();
        return json({ album: { ...album, charInfoCharacterName: normalizeCharInfoCharacterName(album.char_info_character_name) }, items: items.results || [] });
    }
    if (context.request.method === 'DELETE') {
        await context.env.img_d1.batch([
            context.env.img_d1.prepare('DELETE FROM album_items WHERE album_id = ?').bind(id),
            context.env.img_d1.prepare('DELETE FROM albums WHERE id = ?').bind(id),
        ]);
        return json({ success: true });
    }
    if (context.request.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);
    const payload = await context.request.json();
    const name = payload.name === undefined ? album.name : String(payload.name).trim();
    const description = payload.description === undefined ? album.description : String(payload.description).trim();
    const slug = payload.slug === undefined ? album.slug : normalizeSlug(payload.slug);
    const visibility = payload.visibility === undefined ? album.visibility : payload.visibility;
    const charInfoCharacterName = payload.charInfoCharacterName === undefined
        ? normalizeCharInfoCharacterName(album.char_info_character_name)
        : normalizeCharInfoCharacterName(payload.charInfoCharacterName);
    const charInfoCharacterNameError = validateCharInfoCharacterName(charInfoCharacterName);
    if (!name || (description !== null && description.length > 1000) || !slug || !['public', 'unlisted'].includes(visibility)) return json({ error: 'Invalid album data' }, 400);
    if (charInfoCharacterNameError) return json({ error: charInfoCharacterNameError }, 400);
    try {
        await context.env.img_d1.prepare('UPDATE albums SET slug = ?, name = ?, description = ?, char_info_character_name = ?, visibility = ?, updated_at = ? WHERE id = ?').bind(slug, name, description, charInfoCharacterName, visibility, Date.now(), id).run();
    } catch {
        return json({ error: 'Album slug is already in use' }, 409);
    }
    return json({ id, slug, name, description, charInfoCharacterName, visibility });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
