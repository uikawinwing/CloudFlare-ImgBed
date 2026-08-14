import { DISCORD_OWNER_ID, getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';

export async function onRequestGet({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity || identity.id !== DISCORD_OWNER_ID) return json({ error: 'Owner access is required' }, 403);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const rows = await env.img_d1.prepare('SELECT discord_id, username, avatar, public_handle, role, status, used_bytes, last_login_at, created_at FROM users ORDER BY created_at DESC LIMIT 200').all();
    return json({ users: rows.results || [] });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
