import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { absoluteThumbnailUrl, hasPermanentThumbnail } from '../../../utils/thumbnail.js';

export async function onRequestGet({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const rows = await env.img_d1.prepare('SELECT id, file_name, file_type, file_size_bytes, timestamp, width, height, visibility, moderation_status, metadata FROM files WHERE owner_id = ? ORDER BY timestamp DESC LIMIT 200').bind(identity.id).all();
    const files = (rows.results || []).map((row) => {
        const metadata = parseMetadata(row.metadata);
        const isPublicImage = row.visibility === 'public' && String(row.file_type || '').startsWith('image/');
        const { metadata: _metadata, ...file } = row;
        return {
            ...file,
            thumbnail_url: isPublicImage ? absoluteThumbnailUrl(request.url, row.id) : null,
            thumbnail_ready: isPublicImage && hasPermanentThumbnail(metadata),
        };
    });
    return json({ files });
}

function parseMetadata(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
