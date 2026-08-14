import { getDiscordIdentity } from '../../utils/auth/discordIdentity.js';

export async function onRequestGet({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity || !['manager', 'admin', 'owner'].includes(identity.role)) return json({ error: 'Manager access is required' }, 403);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const rows = await env.img_d1.prepare('SELECT a.id, a.actor_id, u.username AS actor_name, a.action, a.target_type, a.target_id, a.reason, a.details, a.created_at FROM audit_logs a LEFT JOIN users u ON u.discord_id = a.actor_id ORDER BY a.created_at DESC LIMIT 100').all();
    return json({ audit: rows.results || [] });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
