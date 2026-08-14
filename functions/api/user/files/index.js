import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';

export async function onRequestGet({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const rows = await env.img_d1.prepare('SELECT id, file_name, file_type, file_size_bytes, timestamp, visibility, moderation_status FROM files WHERE owner_id = ? ORDER BY timestamp DESC LIMIT 200').bind(identity.id).all();
    return json({ files: rows.results || [] });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
