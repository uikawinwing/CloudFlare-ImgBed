import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { normalizeCharInfoCharacterName, validateCharInfoCharacterName } from '../../../utils/charInfoGallery.js';

export async function onRequest(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    if (context.request.method === 'GET') {
        const rows = await context.env.img_d1.prepare('SELECT id, slug, name, description, char_info_character_name AS charInfoCharacterName, created_at, updated_at FROM albums WHERE owner_id = ? ORDER BY updated_at DESC').bind(identity.id).all();
        return json({ albums: rows.results || [] });
    }
    if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const payload = await context.request.json();
    const name = String(payload.name || '').trim();
    const description = payload.description === undefined ? null : String(payload.description).trim();
    const id = crypto.randomUUID();
    const slug = payload.slug === undefined
        ? normalizeSlug(name) || `npc-${id}`
        : explicitSlug(payload.slug);
    const charInfoCharacterName = normalizeCharInfoCharacterName(payload.charInfoCharacterName);
    const charInfoCharacterNameError = validateCharInfoCharacterName(charInfoCharacterName);
    if (!name || !slug || (description !== null && description.length > 1000)) return json({ error: 'A valid album name, description and slug are required' }, 400);
    if (charInfoCharacterNameError) return json({ error: charInfoCharacterNameError }, 400);
    const now = Date.now();
    try {
        await context.env.img_d1.prepare('INSERT INTO albums (id, owner_id, slug, name, description, char_info_character_name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, identity.id, slug, name, description, charInfoCharacterName, 'public', now, now).run();
    } catch (error) {
        if (/UNIQUE constraint failed:\s*albums\.owner_id,\s*albums\.slug/i.test(String(error?.message || ''))) {
            return json({ error: 'Album slug is already in use' }, 409);
        }
        console.error('Album creation failed', error);
        return json({ error: 'Unable to create album' }, 500);
    }
    return json({ id, slug, name, description, charInfoCharacterName }, 201);
}

export function normalizeSlug(value) {
    return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function explicitSlug(value) {
    if (typeof value !== 'string') return null;
    const slug = value.trim().toLowerCase();
    return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
