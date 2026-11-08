import { charInfoVisualStorageKey } from '../../../utils/charInfoVisualConfig.js';
import { createCharInfoGalleryPack } from '../../../utils/charInfoVisualPack.js';
import { listSharedAlbumFiles } from '../../../utils/publicCatalog.js';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
};

export function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env, params }) {
    const albumId = params?.albumId;
    if (typeof albumId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(albumId)) {
        return json({ error: 'Invalid album UUID' }, 400);
    }
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);

    let album, files, visualRow;
    try {
        album = await env.img_d1.prepare(
            "SELECT a.id, a.char_info_character_name FROM albums a JOIN users u ON u.discord_id = a.owner_id WHERE a.id = ? AND u.status = 'active'",
        ).bind(albumId).first();
        if (!album) return json({ error: 'Gallery not found' }, 404);
        [files, visualRow] = await Promise.all([
            listSharedAlbumFiles(env, album.id),
            env.img_d1.prepare('SELECT value FROM other_data WHERE key = ?').bind(charInfoVisualStorageKey(album.id)).first(),
        ]);
    } catch {
        return json({ error: 'Gallery database is unavailable' }, 503);
    }

    let pack;
    try {
        pack = createCharInfoGalleryPack({
            album, files, storedVisualConfig: visualRow?.value, requestUrl: request.url, stableIdentity: true,
        });
    } catch (error) {
        return json({ error: error.message }, 409);
    }
    const body = JSON.stringify(pack);
    // Hash the representation, including ordered members, names and thumbnail
    // versions. Album timestamps alone do not cover all member mutations.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const etag = `"${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}"`;
    const headers = {
        ...CORS_HEADERS, 'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60', 'ETag': etag,
    };
    const candidates = (request.headers.get('If-None-Match') || '').split(',').map(value => value.trim().replace(/^W\//u, ''));
    if (candidates.includes('*') || candidates.includes(etag)) return new Response(null, { status: 304, headers });
    return new Response(body, { headers });
}

function json(body, status) {
    return new Response(JSON.stringify(body), {
        status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}
