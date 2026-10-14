import { getDatabase } from '../../../utils/databaseAdapter.js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { validateSession } from '../../../utils/auth/sessionManager.js';
import { validateApiToken } from '../../../utils/auth/tokenValidator.js';
import { rejectCrossSiteMutation } from '../../../utils/auth/mutationSecurity.js';
import { ensurePermanentThumbnail, hasPermanentThumbnail, persistThumbnailResult } from '../../../utils/thumbnail.js';

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
}

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;

    // Maintenance always requires actual credentials, including when ordinary admin authentication is disabled.
    const session = await validateSession(env, request, 'admin');
    const identity = session.valid ? null : await getDiscordIdentity(env, request);
    const token = session.valid || ['admin', 'owner'].includes(identity?.role)
        ? null : await validateApiToken(request, getDatabase(env), 'manage');
    if (!session.valid && !['admin', 'owner'].includes(identity?.role) && !token?.valid) {
        return json({ error: 'Administrator login required' }, 401);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }
    const fileIds = body?.fileIds;
    if (!Array.isArray(fileIds) || !fileIds.length || fileIds.length > 3
        || fileIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 2048 || /[\x00\r\n]/.test(id))
        || new Set(fileIds).size !== fileIds.length) {
        return json({ error: 'Provide 1 to 3 unique non-empty fileIds' }, 400);
    }
    if (!env.img_d1?.prepare) return json({ error: 'D1 database required' }, 503);

    const results = [];
    for (const fileId of fileIds) {
        try {
            const row = await env.img_d1.prepare('SELECT metadata, moderation_status FROM files WHERE id = ?').bind(fileId).first();
            const metadata = row ? JSON.parse(row.metadata) : null;
            const reason = !metadata ? 'file-not-found'
                : row.moderation_status !== 'active' || (metadata.ModerationStatus || 'active') !== 'active' ? 'file-not-active'
                : !String(metadata.FileType || '').startsWith('image/') ? 'not-image' : null;
            if (reason) {
                results.push({ fileId, ready: false, created: false, reason });
                continue;
            }
            if (hasPermanentThumbnail(metadata)) {
                results.push({ fileId, ready: true, created: false, reason: null });
                continue;
            }
            const generated = await ensurePermanentThumbnail(context, fileId, metadata);
            const result = await persistThumbnailResult(context, fileId, metadata, generated);
            results.push({ fileId, ready: result.ready, created: result.created, reason: result.reason || null });
        } catch (error) {
            console.error(`Thumbnail backfill failed for ${fileId}:`, error);
            results.push({ fileId, ready: false, created: false, reason: 'thumbnail-backfill-failed' });
        }
    }
    return json({ results });
}
