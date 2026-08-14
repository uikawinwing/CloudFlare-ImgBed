import { getDatabase } from '../../../utils/databaseAdapter.js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { prepareAuditLog, readReason } from '../../../utils/auditLog.js';

export async function onRequestPost(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity || !['admin', 'owner'].includes(identity.role)) return json({ error: 'Admin access is required' }, 403);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const fileId = decodeURIComponent(context.params.path).split(',').join('/');
    const reason = readReason(await context.request.json().catch(() => ({})));
    if (!reason) return json({ error: 'A reason between 3 and 500 characters is required' }, 400);
    const db = getDatabase(context.env);
    const file = await db.getWithMetadata(fileId);
    if (!file) return json({ error: 'File not found' }, 404);
    const metadata = { ...file.metadata, ModerationStatus: 'active' };
    await context.env.img_d1.batch([
        context.env.img_d1.prepare('UPDATE files SET metadata = ?, moderation_status = ?, quarantined_by = NULL, quarantined_at = NULL WHERE id = ?').bind(JSON.stringify(metadata), 'active', fileId),
        prepareAuditLog(context.env, { actorId: identity.id, action: 'file.restore', targetType: 'file', targetId: fileId, reason }),
    ]);
    return json({ success: true, fileId, moderationStatus: 'active' });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
