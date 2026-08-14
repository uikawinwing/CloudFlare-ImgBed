import { deleteFile } from '../../manage/delete/[[path]].js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { removeFileFromIndex } from '../../../utils/indexManager.js';
import { getDatabase } from '../../../utils/databaseAdapter.js';
import { readReason, writeAuditLog } from '../../../utils/auditLog.js';

export async function onRequestDelete(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity || !['admin', 'owner'].includes(identity.role)) return json({ error: 'Admin access is required' }, 403);
    const fileId = decodeURIComponent(context.params.path).split(',').join('/');
    const reason = readReason(await context.request.json().catch(() => ({})));
    if (!reason) return json({ error: 'A reason between 3 and 500 characters is required' }, 400);
    const file = await getDatabase(context.env).getWithMetadata(fileId);
    if (!file) return json({ error: 'File not found' }, 404);
    await writeAuditLog(context.env, { actorId: identity.id, action: 'file.delete.request', targetType: 'file', targetId: fileId, reason, details: { ownerId: file.metadata?.OwnerId || null } });
    const url = new URL(context.request.url);
    if (!await deleteFile(context.env, fileId, `${url.origin}/file/${fileId}`, url)) return json({ error: 'Delete failed' }, 502);
    await removeFileFromIndex(context, fileId);
    await writeAuditLog(context.env, { actorId: identity.id, action: 'file.delete', targetType: 'file', targetId: fileId, reason, details: { ownerId: file.metadata?.OwnerId || null } });
    return json({ success: true, fileId });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
