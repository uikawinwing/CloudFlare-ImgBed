import { getDatabase } from '../../../utils/databaseAdapter.js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { prepareAuditLog, readReason } from '../../../utils/auditLog.js';
import { purgeCFCache } from '../../../utils/purgeCache.js';
import { thumbnailContentVersion, thumbnailVariantUrls } from '../../../utils/thumbnail.js';

export async function onRequestPost(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity || !['manager', 'admin', 'owner'].includes(identity.role)) return json({ error: 'Manager access is required' }, 403);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const fileId = decodeURIComponent(context.params.path).split(',').join('/');
    const reason = readReason(await context.request.json().catch(() => ({})));
    if (!reason) return json({ error: 'A reason between 3 and 500 characters is required' }, 400);
    const db = getDatabase(context.env);
    const file = await db.getWithMetadata(fileId);
    if (!file) return json({ error: 'File not found' }, 404);
    const metadata = { ...file.metadata, ModerationStatus: 'quarantined' };
    await context.env.img_d1.batch([
        context.env.img_d1.prepare('UPDATE files SET metadata = ?, moderation_status = ?, quarantined_by = ?, quarantined_at = ? WHERE id = ?').bind(JSON.stringify(metadata), 'quarantined', identity.id, Date.now(), fileId),
        prepareAuditLog(context.env, { actorId: identity.id, action: 'file.quarantine', targetType: 'file', targetId: fileId, reason }),
    ]);
    await purgeCFCache(context.env, `${new URL(context.request.url).origin}/file/${fileId}`);
    for (const thumbnailUrl of thumbnailVariantUrls(context.request.url, fileId, thumbnailContentVersion(metadata))) {
        await purgeCFCache(context.env, thumbnailUrl);
    }
    return json({ success: true, fileId, moderationStatus: 'quarantined' });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
