import {
    absoluteFileUrl as catalogFileUrl,
    absoluteThumbnailUrl as catalogThumbnailUrl,
    listPublicAlbumFiles,
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

export async function onRequestGet({ request, env, params }) {
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const album = await env.img_d1.prepare("SELECT a.id, a.name, a.description, a.char_info_character_name, a.updated_at, u.discord_id, u.username, u.public_handle FROM albums a JOIN users u ON u.discord_id = a.owner_id WHERE u.public_handle = ? AND u.status = 'active' AND a.slug = ? AND a.visibility = 'public'").bind(params.ownerSlug, params.albumSlug).first();
    if (!album) return json({ error: 'Gallery not found' }, 404);
    try {
        requireCharInfoAlbumIdentity(album);
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
    const files = await listPublicAlbumFiles(env, album.id);
    const lastModifiedAt = Math.max(Number(album.updated_at) || 0, ...files.map((file) => Number(file.timestamp) || 0));
    const etag = makeEtag(album, files, lastModifiedAt);
    const headers = publicHeaders(etag, lastModifiedAt);
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
    return new Response(JSON.stringify(createGalleryPack(album, params.albumSlug, files, request.url)), { headers });
}

export function createGalleryPack(album, albumSlug, files, requestUrl) {
    const identity = requireCharInfoAlbumIdentity(album);
    return {
        format: 'char-info-gallery-pack',
        version: 1,
        packId: identity.packId,
        profileId: identity.profileId,
        characterName: identity.characterName,
        gallery: files.map((file) => ({
            title: file.file_name || file.id,
            sources: [absoluteFileUrl(requestUrl, file.id)],
            thumbnail: String(file.file_type || '').startsWith('image/')
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
