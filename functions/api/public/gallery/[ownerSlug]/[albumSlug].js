import {
    absoluteFileUrl as catalogFileUrl,
    absoluteThumbnailUrl as catalogThumbnailUrl,
    listSharedAlbumFiles,
} from '../../../../utils/publicCatalog.js';
import { requireCharInfoAlbumIdentity } from '../../../../utils/charInfoGallery.js';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'If-None-Match',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const slugs = gallerySlugsFromRequest(request.url, '/api/public/gallery/');
    if (!slugs) return json({ error: 'Gallery not found' }, 404);
    const { ownerSlug, albumSlug } = slugs;
    const album = await env.img_d1.prepare("SELECT a.id, a.name, a.description, a.char_info_character_name, a.updated_at, u.discord_id, u.username, u.public_handle FROM albums a JOIN users u ON u.discord_id = a.owner_id WHERE u.public_handle = ? AND u.status = 'active' AND a.slug = ?").bind(ownerSlug, albumSlug).first();
    if (!album) return json({ error: 'Gallery not found' }, 404);
    const files = await listSharedAlbumFiles(env, album.id);
    const lastModifiedAt = Math.max(Number(album.updated_at) || 0, ...files.map((file) => Number(file.timestamp) || 0));
    const etag = makeEtag(album, files, lastModifiedAt);
    const headers = publicHeaders(etag, lastModifiedAt);
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
    return new Response(JSON.stringify(createGalleryPack(album, albumSlug, files, request.url)), { headers });
}

export function createGalleryPack(album, albumSlug, files, requestUrl) {
    let identity = null;
    try {
        identity = requireCharInfoAlbumIdentity(album);
    } catch {}
    return {
        format: identity ? 'char-info-gallery-pack' : 'imgbed-gallery',
        version: 1,
        ...(identity ? {
            packId: identity.packId,
            profileId: identity.profileId,
            characterName: identity.characterName,
        } : {}),
        gallery: files.map((file) => ({
            title: file.file_name || file.id,
            sources: [absoluteFileUrl(requestUrl, file.id)],
            thumbnail: file.visibility === 'public' && String(file.file_type || '').startsWith('image/')
                ? absoluteThumbnailUrl(requestUrl, file.id)
                : null,
        })),
    };
}

export function absoluteFileUrl(requestUrl, fileId) {
    return catalogFileUrl(requestUrl, fileId);
}

export function absoluteThumbnailUrl(requestUrl, fileId) {
    return catalogThumbnailUrl(requestUrl, fileId);
}

function gallerySlugsFromRequest(requestUrl, prefix) {
    const pathname = new URL(requestUrl).pathname;
    if (!pathname.startsWith(prefix)) return null;
    const parts = pathname.slice(prefix.length).split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    try {
        return { ownerSlug: decodeURIComponent(parts[0]), albumSlug: decodeURIComponent(parts[1]) };
    } catch {
        return null;
    }
}

function makeEtag(album, files, lastModifiedAt) {
    const signature = files.map((file) => `${file.id}:${file.file_name || ''}:${file.timestamp || ''}:${file.visibility || ''}`).join('|');
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
