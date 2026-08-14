import { deleteFile } from '../../manage/delete/[[path]].js';
import { getDatabase } from '../../../utils/databaseAdapter.js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { removeFileFromIndex } from '../../../utils/indexManager.js';

export async function onRequestDelete(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    const fileId = decodeURIComponent(context.params.path).split(',').join('/');
    const db = getDatabase(context.env);
    const file = await db.getWithMetadata(fileId);
    if (!file) return json({ error: 'File not found' }, 404);
    if (file.metadata?.OwnerId !== identity.id) return json({ error: 'Only the owner can delete this file' }, 403);
    const url = new URL(context.request.url);
    if (!await deleteFile(context.env, fileId, `${url.origin}/file/${fileId}`, url)) return json({ error: 'Delete failed' }, 502);
    await removeFileFromIndex(context, fileId);
    return json({ success: true, fileId });
}

export async function onRequestPatch(context) {
    const identity = await getDiscordIdentity(context.env, context.request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!context.env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const fileId = decodeURIComponent(context.params.path).split(',').join('/');
    const db = getDatabase(context.env);
    const file = await db.getWithMetadata(fileId);
    if (!file) return json({ error: 'File not found' }, 404);
    if (file.metadata?.OwnerId !== identity.id) return json({ error: 'Only the owner can change this file' }, 403);
    const payload = await context.request.json();
    const visibility = payload.visibility === undefined ? (file.metadata.Visibility || 'private') : payload.visibility;
    if (!['private', 'public'].includes(visibility)) return json({ error: 'Invalid visibility' }, 400);
    const metadata = { ...file.metadata, Visibility: visibility };
    await db.put(fileId, file.value || '', { metadata });
    await context.env.img_d1.prepare('UPDATE files SET metadata = ?, visibility = ? WHERE id = ?').bind(JSON.stringify(metadata), visibility, fileId).run();
    return json({ success: true, fileId, visibility });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
