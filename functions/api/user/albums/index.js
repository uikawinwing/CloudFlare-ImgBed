import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';

export async function onRequest(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    if (context.request.method === 'GET') {
        const rows = await context.env.img_d1.prepare('SELECT id, slug, name, description, visibility, created_at, updated_at FROM albums WHERE owner_id = ? ORDER BY updated_at DESC').bind(identity.id).all();
        return json({ albums: rows.results || [] });
    }
    if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const payload = await context.request.json();
    const name = String(payload.name || '').trim();
    const description = payload.description === undefined ? null : String(payload.description).trim();
    const slug = normalizeSlug(payload.slug || name);
    const visibility = payload.visibility || 'unlisted';
    if (!name || !slug || (description !== null && description.length > 1000) || !['public', 'unlisted'].includes(visibility)) return json({ error: 'A valid album name, description, slug and visibility are required' }, 400);
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
        await context.env.img_d1.prepare('INSERT INTO albums (id, owner_id, slug, name, description, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, identity.id, slug, name, description, visibility, now, now).run();
    } catch {
        return json({ error: 'Album slug is already in use' }, 409);
    }
    return json({ id, slug, name, description, visibility }, 201);
}

export function normalizeSlug(value) {
    return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
