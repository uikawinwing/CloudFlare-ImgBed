import { charInfoVisualStorageKey } from '../../../utils/charInfoVisualConfig.js';
import { createCharInfoVisualPack } from '../../../utils/charInfoVisualPack.js';
import { listSharedAlbumFiles } from '../../../utils/publicCatalog.js';

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

    const albumId = normalizeAlbumId(params?.albumId) || albumIdFromRequest(request.url);
    if (!albumId) return json({ error: 'Gallery not found' }, 404);

    const album = await env.img_d1.prepare(
        "SELECT a.id, a.name, a.description, a.char_info_character_name, a.updated_at, u.discord_id, u.username, u.public_handle FROM albums a JOIN users u ON u.discord_id = a.owner_id WHERE a.id = ? AND u.status = 'active'",
    ).bind(albumId).first();
    if (!album) return json({ error: 'Gallery not found' }, 404);

    const [files, visualRow] = await Promise.all([
        listSharedAlbumFiles(env, album.id),
        env.img_d1.prepare('SELECT value FROM other_data WHERE key = ?').bind(charInfoVisualStorageKey(album.id)).first(),
    ]);
    const storedVisualConfig = typeof visualRow?.value === 'string' ? visualRow.value : null;

    let pack;
    try {
        pack = createCharInfoVisualPack({ album, files, storedVisualConfig, requestUrl: request.url });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }

    const etag = makeEtag(album, files, storedVisualConfig);
    const lastModifiedAt = Math.max(Number(album.updated_at) || 0, ...files.map((file) => Number(file.timestamp) || 0));
    const headers = publicHeaders(etag, lastModifiedAt);
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });

    return new Response(JSON.stringify(pack), { headers });
}

export function albumIdFromRequest(requestUrl) {
    const prefix = '/api/public/charinfo/';
    const pathname = new URL(requestUrl).pathname;
    if (!pathname.startsWith(prefix)) return null;
    const parts = pathname.slice(prefix.length).split('/').filter(Boolean);
    if (parts.length !== 1) return null;
    try {
        return normalizeAlbumId(decodeURIComponent(parts[0]));
    } catch {
        return null;
    }
}

function normalizeAlbumId(value) {
    if (Array.isArray(value)) return value.length === 1 ? normalizeAlbumId(value[0]) : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > 100 || normalized.includes('/')) return null;
    return normalized;
}

function makeEtag(album, files, storedVisualConfig) {
    const signature = [
        album.id || '',
        album.public_handle || '',
        album.char_info_character_name || '',
        album.name || '',
        album.description || '',
        storedVisualConfig || '',
        ...files.map((file) => `${file.id}:${file.file_name || ''}:${file.file_type || ''}:${file.timestamp || ''}`),
    ].join('|');
    return `W/\"${album.id}:${hashString(signature)}\"`;
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
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
}
