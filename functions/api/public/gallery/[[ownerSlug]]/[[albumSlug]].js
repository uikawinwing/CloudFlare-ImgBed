const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'If-None-Match',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env, params }) {
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const album = await env.img_d1.prepare("SELECT a.id, a.name, a.description, a.updated_at, u.discord_id, u.username, u.public_handle FROM albums a JOIN users u ON u.discord_id = a.owner_id WHERE u.public_handle = ? AND u.status = 'active' AND a.slug = ? AND a.visibility = 'public'").bind(params.ownerSlug, params.albumSlug).first();
    if (!album) return json({ error: 'Gallery not found' }, 404);
    const rows = await env.img_d1.prepare("SELECT f.id, f.file_name, f.timestamp FROM album_items ai JOIN files f ON f.id = ai.file_id WHERE ai.album_id = ? AND f.moderation_status = 'active' ORDER BY ai.position, ai.created_at").bind(album.id).all();
    const files = rows.results || [];
    const lastModifiedAt = Math.max(Number(album.updated_at) || 0, ...files.map((file) => Number(file.timestamp) || 0));
    const etag = makeEtag(album, files, lastModifiedAt);
    const headers = publicHeaders(etag, lastModifiedAt);
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
    return new Response(JSON.stringify(createGalleryPack(album, params.albumSlug, files, request.url)), { headers });
}

export function createGalleryPack(album, albumSlug, files, requestUrl) {
    return {
        format: 'char-info-gallery-pack',
        version: 1,
        packId: `${album.public_handle}/${albumSlug}`,
        profileId: album.public_handle,
        characterName: album.username,
        gallery: files.map((file) => ({
            title: file.file_name || file.id,
            sources: [absoluteFileUrl(requestUrl, file.id)],
        })),
    };
}

export function absoluteFileUrl(requestUrl, fileId) {
    const url = new URL(requestUrl);
    url.protocol = 'https:';
    url.pathname = `/file/${fileId.split('/').map(encodeURIComponent).join('/')}`;
    url.search = '';
    url.hash = '';
    return url.toString();
}

function makeEtag(album, files, lastModifiedAt) {
    const signature = files.map((file) => `${file.id}:${file.file_name || ''}:${file.timestamp || ''}`).join('|');
    return `W/"${album.id}:${lastModifiedAt}:${hashString(signature)}"`;
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16);
}

function publicHeaders(etag, lastModifiedAt) {
    return {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'ETag': etag,
        'Last-Modified': new Date(lastModifiedAt || 0).toUTCString(),
    };
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
}
