import { getDiscordIdentity } from '../../utils/auth/discordIdentity.js';

export async function onRequestGet({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity || !['manager', 'admin', 'owner'].includes(identity.role)) return json({ error: 'Manager access is required' }, 403);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    const conditions = [];
    const params = [];
    if (['active', 'quarantined', 'deleting'].includes(status)) {
        conditions.push('f.moderation_status = ?');
        params.push(status);
    }
    if (query) {
        conditions.push('(f.file_name LIKE ? OR f.id LIKE ? OR u.username LIKE ?)');
        const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
        params.push(like, like, like);
    }
    let sql = 'SELECT f.id, f.file_name, f.file_type, f.file_size_bytes, f.timestamp, f.moderation_status, f.quarantined_by, f.quarantined_at, f.owner_id, u.username AS owner_name FROM files f LEFT JOIN users u ON u.discord_id = f.owner_id';
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ' ORDER BY f.timestamp DESC LIMIT 200';
    const rows = await env.img_d1.prepare(sql).bind(...params).all();
    return json({ files: rows.results || [] });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
