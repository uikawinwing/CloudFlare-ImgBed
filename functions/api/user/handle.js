import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';

export async function onRequestPut({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const { publicHandle } = await request.json();
    const handle = String(publicHandle || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(handle)) return json({ error: 'Public handle must use 3-32 lowercase letters, numbers or hyphens' }, 400);
    const current = await env.img_d1.prepare('SELECT public_handle FROM users WHERE discord_id = ?').bind(identity.id).first();
    const publicAlbum = await env.img_d1.prepare("SELECT 1 FROM albums WHERE owner_id = ? AND visibility = 'public' LIMIT 1").bind(identity.id).first();
    if (publicAlbum && current?.public_handle !== handle) return json({ error: 'Public handle cannot change while public albums exist' }, 409);
    try {
        await env.img_d1.prepare('UPDATE users SET public_handle = ?, updated_at = ? WHERE discord_id = ?').bind(handle, Date.now(), identity.id).run();
    } catch {
        return json({ error: 'Public handle is already in use' }, 409);
    }
    return json({ publicHandle: handle });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
