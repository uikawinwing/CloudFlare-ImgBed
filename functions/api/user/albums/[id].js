import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { normalizeCharInfoCharacterName, validateCharInfoCharacterName } from '../../../utils/charInfoGallery.js';
import { normalizeSlug } from './index.js';

export async function onRequest(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const id = context.params.id;
    const album = await context.env.img_d1.prepare(`SELECT a.*, c.file_id AS cover_file_id,
        c.position_x AS cover_position_x, c.position_y AS cover_position_y
        FROM albums a LEFT JOIN album_covers c ON c.album_id = a.id WHERE a.id = ?`).bind(id).first();
    if (!album) return json({ error: 'Album not found' }, 404);
    if (album.owner_id !== identity.id && identity.role !== 'owner') return json({ error: 'Only the owner can change this album' }, 403);
    if (context.request.method === 'GET') {
        const items = await context.env.img_d1.prepare('SELECT f.id, f.file_name, f.file_type, f.file_size_bytes, f.timestamp, f.visibility, f.moderation_status, ai.position FROM album_items ai JOIN files f ON f.id = ai.file_id WHERE ai.album_id = ? ORDER BY ai.position, ai.created_at').bind(id).all();
        return json({ album: presentAlbum(album), items: items.results || [] });
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
    const coverUpdateRequested = payload.coverFileId !== undefined || payload.coverPositionX !== undefined || payload.coverPositionY !== undefined;
    let coverFileId = album.cover_file_id || null;
    let coverPositionX = normalizeCoverPosition(payload.coverPositionX, album.cover_position_x ?? 50);
    let coverPositionY = normalizeCoverPosition(payload.coverPositionY, album.cover_position_y ?? 50);
    if (coverUpdateRequested) {
        coverFileId = payload.coverFileId === undefined ? coverFileId : normalizeCoverFileId(payload.coverFileId);
        if (coverFileId === undefined || coverPositionX === null || coverPositionY === null) return json({ error: 'Invalid album cover data' }, 400);
        if (coverFileId) {
            const coverFile = await context.env.img_d1.prepare(`SELECT f.id FROM album_items ai
                JOIN files f ON f.id = ai.file_id
                WHERE ai.album_id = ? AND f.id = ? AND f.file_type LIKE 'image/%' AND f.moderation_status = 'active'`).bind(id, coverFileId).first();
            if (!coverFile) return json({ error: 'Album cover must be an active image in this album' }, 400);
        } else {
            if (payload.coverPositionX !== undefined || payload.coverPositionY !== undefined) {
                return json({ error: 'Select an album cover before adjusting its position' }, 400);
            }
            coverPositionX = 50;
            coverPositionY = 50;
        }
    }
    try {
        const now = Date.now();
        const statements = [context.env.img_d1.prepare('UPDATE albums SET slug = ?, name = ?, description = ?, char_info_character_name = ?, visibility = ?, updated_at = ? WHERE id = ?').bind(slug, name, description, charInfoCharacterName, visibility, now, id)];
        if (coverUpdateRequested) {
            statements.push(coverFileId
                ? context.env.img_d1.prepare(`INSERT INTO album_covers (album_id, file_id, position_x, position_y, updated_at) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(album_id) DO UPDATE SET file_id = excluded.file_id, position_x = excluded.position_x, position_y = excluded.position_y, updated_at = excluded.updated_at`).bind(id, coverFileId, coverPositionX, coverPositionY, now)
                : context.env.img_d1.prepare('DELETE FROM album_covers WHERE album_id = ?').bind(id));
        }
        await context.env.img_d1.batch(statements);
    } catch (error) {
        if (/UNIQUE constraint failed:\s*albums\.owner_id,\s*albums\.slug/i.test(String(error?.message || ''))) {
            return json({ error: 'Album slug is already in use' }, 409);
        }
        console.error('Album update failed', error);
        return json({ error: 'Unable to update album' }, 500);
    }
    return json({ id, slug, name, description, charInfoCharacterName, visibility, coverFileId, coverPositionX, coverPositionY });
}

function presentAlbum(album) {
    return {
        ...album,
        charInfoCharacterName: normalizeCharInfoCharacterName(album.char_info_character_name),
        coverFileId: album.cover_file_id || null,
        coverPositionX: normalizeCoverPosition(album.cover_position_x, 50),
        coverPositionY: normalizeCoverPosition(album.cover_position_y, 50),
    };
}

function normalizeCoverFileId(value) {
    if (value === null || value === '') return null;
    return typeof value === 'string' && value.length <= 1024 ? value : undefined;
}

function normalizeCoverPosition(value, fallback) {
    const number = value === undefined || value === null || value === '' ? Number(fallback) : Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 100 ? number : null;
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
