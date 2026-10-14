import { deleteFile } from '../../manage/delete/[[path]].js';
import { getDatabase } from '../../../utils/databaseAdapter.js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { removeFileFromIndex } from '../../../utils/indexManager.js';
import { resolveFilePublication } from '../../../utils/publicCatalog.js';
import {
    absoluteThumbnailUrl,
    ensurePermanentThumbnail,
    hasPermanentThumbnail,
    persistThumbnailResult,
    thumbnailContentVersion,
} from '../../../utils/thumbnail.js';

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
    const publication = resolveFilePublication(file.metadata, payload);
    if (!publication) return json({ error: 'Visibility must be private or public' }, 400);
    const { visibility } = publication;
    const discoverEligible = visibility === 'public' ? 1 : 0;
    const updated = await context.env.img_d1.prepare(`
        UPDATE files
        SET metadata = json_set(metadata, '$.Visibility', ?, '$.DiscoverEligible', ?),
            visibility = ?, discover_eligible = ?
        WHERE id = ?
          AND COALESCE(owner_id, json_extract(metadata, '$.OwnerId')) = ?
          AND COALESCE(NULLIF(moderation_status, ''), json_extract(metadata, '$.ModerationStatus'), 'active') = ?
        RETURNING metadata
    `).bind(visibility, discoverEligible, visibility, discoverEligible, fileId, identity.id, file.metadata.ModerationStatus || 'active').first();
    if (!updated) return json({ error: 'File changed or was removed; reload before trying again' }, 409);
    let metadata = JSON.parse(updated.metadata);

    let thumbnailReady = hasPermanentThumbnail(metadata);
    let thumbnailCreated = false;
    let thumbnailReason = null;
    if (String(metadata.FileType || '').startsWith('image/')) {
        const generated = await ensurePermanentThumbnail(context, fileId, metadata);
        const thumbnailResult = await persistThumbnailResult(context, fileId, metadata, generated);
        if (!thumbnailResult.metadata) return json({ error: 'File was removed while the thumbnail was being generated' }, 409);
        metadata = thumbnailResult.metadata;
        thumbnailReady = thumbnailResult.ready;
        thumbnailCreated = thumbnailResult.created;
        thumbnailReason = thumbnailResult.reason || null;
    }

    const thumbnailUrl = String(metadata.FileType || '').startsWith('image/')
        ? absoluteThumbnailUrl(context.request.url, fileId, 'gallery', thumbnailContentVersion(metadata))
        : null;

    return json({
        success: true,
        fileId,
        visibility: metadata.Visibility,
        thumbnailUrl,
        thumbnailReady,
        thumbnailCreated,
        ...(thumbnailReason ? { thumbnailReason } : {}),
    });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
