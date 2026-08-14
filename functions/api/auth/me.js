import { getDiscordIdentity } from '../../utils/auth/discordIdentity.js';

export async function onRequestGet({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity) return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const user = env.img_d1?.prepare ? await env.img_d1.prepare('SELECT public_handle FROM users WHERE discord_id = ?').bind(identity.id).first() : null;
    return new Response(JSON.stringify({ authenticated: true, user: { ...identity, publicHandle: user?.public_handle || null } }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
