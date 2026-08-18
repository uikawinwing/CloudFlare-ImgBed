import { deleteFile } from '../../manage/delete/[[path]].js';
import { getDatabase } from '../../../utils/databaseAdapter.js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { removeFileFromIndex } from '../../../utils/indexManager.js';
import { resolveFilePublication } from '../../../utils/publicCatalog.js';
import { purgeCFCache } from '../../../utils/purgeCache.js';
import {
    absoluteThumbnailUrl,
    ensurePermanentThumbnail,
    hasPermanentThumbnail,
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
    if (!publication) return json({ error: 'Discover can only be enabled for public files' }, 400);
    const { visibility, discoverEligible } = publication;
    let metadata = { ...file.metadata, Visibility: visibility, DiscoverEligible: discoverEligible };

    let thumbnailReady = hasPermanentThumbnail(metadata);
    let thumbnailCreated = false;
    let thumbnailReason = null;
    if (visibility === 'public' && String(metadata.FileType || '').startsWith('image/')) {
        const thumbnailResult = await ensurePermanentThumbnail(context, fileId, metadata);
        metadata = thumbnailResult.metadata;
        thumbnailReady = thumbnailResult.ready;
        thumbnailCreated = thumbnailResult.created;
        thumbnailReason = thumbnailResult.reason || null;
    }

    await db.put(fileId, file.value || '', { metadata });
    await context.env.img_d1.prepare('UPDATE files SET metadata = ?, visibility = ?, discover_eligible = ? WHERE id = ?').bind(JSON.stringify(metadata), visibility, discoverEligible, fileId).run();

    const thumbnailUrl = visibility === 'public' && String(metadata.FileType || '').startsWith('image/')
        ? absoluteThumbnailUrl(context.request.url, fileId)
        : null;
    if (thumbnailUrl) {
        try {
            await purgeCFCache(context.env, thumbnailUrl);
        } catch (error) {
            console.warn('Failed to purge thumbnail cache after visibility update:', error.message);
        }
    }

    return json({
        success: true,
        fileId,
        visibility,
        discoverEligible: Boolean(discoverEligible),
        thumbnailUrl,
        thumbnailReady,
        thumbnailCreated,
        ...(thumbnailReason ? { thumbnailReason } : {}),
    });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
