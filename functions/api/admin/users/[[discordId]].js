import { DISCORD_OWNER_ID, getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { prepareAuditLog, readReason } from '../../../utils/auditLog.js';

export async function onRequestPatch({ request, env, params }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity || identity.id !== DISCORD_OWNER_ID) return json({ error: 'Owner access is required' }, 403);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const payload = await request.json();
    const { role, status } = payload;
    const reason = readReason(payload);
    if (!reason) return json({ error: 'A reason between 3 and 500 characters is required' }, 400);
    if (params.discordId === DISCORD_OWNER_ID) return json({ error: 'The owner account cannot be changed' }, 400);
    if (role !== undefined && !['member', 'manager', 'admin'].includes(role)) return json({ error: 'Invalid role change' }, 400);
    if (status !== undefined && !['active', 'suspended'].includes(status)) return json({ error: 'Invalid account status' }, 400);
    if (role === undefined && status === undefined) return json({ error: 'No change requested' }, 400);
    const current = await env.img_d1.prepare('SELECT role, status FROM users WHERE discord_id = ?').bind(params.discordId).first();
    if (!current) return json({ error: 'User not found' }, 404);
    const nextRole = role ?? current.role;
    const nextStatus = status ?? current.status;
    await env.img_d1.batch([
        env.img_d1.prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE discord_id = ?').bind(nextRole, nextStatus, Date.now(), params.discordId),
        prepareAuditLog(env, { actorId: identity.id, action: role !== undefined ? 'user.role' : 'user.status', targetType: 'user', targetId: params.discordId, reason, details: { before: current, after: { role: nextRole, status: nextStatus } } }),
    ]);
    return json({ discordId: params.discordId, role: nextRole, status: nextStatus });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
