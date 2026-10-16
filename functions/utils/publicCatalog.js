import { absoluteThumbnailUrl, thumbnailContentVersion } from './thumbnail.js';

const MAX_PAGE_SIZE = 48;

export const PUBLIC_FILE_SQL = "f.visibility = 'public' AND f.moderation_status = 'active' AND u.status = 'active'";
export const SHARED_ALBUM_FILE_SQL = "f.moderation_status = 'active' AND u.status = 'active'";

export function isPublicCatalogFile(file, owner) {
    return file?.visibility === 'public'
        && file?.moderation_status === 'active'
        && owner?.status === 'active';
}

export function resolveFilePublication(metadata, payload) {
    const visibility = payload.visibility === undefined ? (metadata.Visibility || 'private') : payload.visibility;
    if (!['private', 'public'].includes(visibility)) return null;
    return { visibility };
}

export function parseDiscoverQuery(url) {
    const requestedLimit = Number(url.searchParams.get('limit') || 24);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE) : 24;
    const sort = url.searchParams.get('sort') || 'recent';
    if (!['recent', 'featured'].includes(sort)) throw new CatalogRequestError('Invalid sort order');
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    return { limit, sort, cursor };
}

export function encodeCursor(cursor) {
    if (!cursor || !Number.isFinite(Number(cursor.value)) || !cursor.id) return null;
    const value = JSON.stringify({ value: Number(cursor.value), id: String(cursor.id) });
    return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeCursor(rawCursor) {
    if (!rawCursor) return null;
    try {
        const padded = rawCursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - rawCursor.length % 4) % 4);
        const value = JSON.parse(atob(padded));
        if (!Number.isFinite(Number(value?.value)) || typeof value?.id !== 'string' || !value.id) throw new Error('Invalid cursor');
        return { value: Number(value.value), id: value.id };
    } catch {
        throw new CatalogRequestError('Invalid cursor');
    }
}

export async function listDiscoverAlbums(env, query, requestUrl) {
    const bindings = [];
    let cursorCondition = '';
    if (query.cursor) {
        cursorCondition = 'AND (a.updated_at, a.id) < (?, ?)';
        bindings.push(query.cursor.value, query.cursor.id);
    }
    bindings.push(query.limit + 1);
    // CROSS JOIN keeps SQLite from scanning all files or memberships before this page's albums.
    const sql = `WITH selected_albums AS (
        SELECT a.id, a.slug, a.name, a.description, a.char_info_character_name, a.updated_at,
            u.username AS creator_name, u.public_handle AS creator_handle
        FROM albums a JOIN users u ON u.discord_id = a.owner_id
        WHERE u.status = 'active' AND u.public_handle IS NOT NULL ${cursorCondition}
        ORDER BY a.updated_at DESC, a.id DESC LIMIT ?
    ), ranked_items AS (
        SELECT ai.album_id, f.id AS fallback_cover_id, f.file_type AS fallback_cover_type,
            f.timestamp AS fallback_cover_timestamp,
            json_extract(f.metadata, '$.Thumbnail.CreatedAt') AS fallback_cover_thumbnail_created_at,
            ROW_NUMBER() OVER (PARTITION BY ai.album_id ORDER BY ai.position, ai.created_at) AS item_rank
        FROM selected_albums selected
        CROSS JOIN album_items ai ON ai.album_id = selected.id
        CROSS JOIN files f ON f.id = ai.file_id
        WHERE f.moderation_status = 'active' AND f.file_type LIKE 'image/%'
    ), explicit_covers AS (
        SELECT ac.album_id, f.id AS cover_id, f.file_type AS cover_type, f.timestamp AS cover_timestamp,
            json_extract(f.metadata, '$.Thumbnail.CreatedAt') AS cover_thumbnail_created_at,
            ac.position_x AS cover_position_x, ac.position_y AS cover_position_y
        FROM selected_albums selected
        CROSS JOIN album_covers ac ON ac.album_id = selected.id
        CROSS JOIN album_items ai ON ai.album_id = ac.album_id AND ai.file_id = ac.file_id
        CROSS JOIN files f ON f.id = ac.file_id
        WHERE f.moderation_status = 'active' AND f.file_type LIKE 'image/%'
    ), item_counts AS (
        SELECT ai.album_id, COUNT(*) AS item_count
        FROM selected_albums selected
        CROSS JOIN album_items ai ON ai.album_id = selected.id
        CROSS JOIN files f ON f.id = ai.file_id
        WHERE f.moderation_status = 'active'
        GROUP BY ai.album_id
    )
    SELECT a.*,
        COALESCE(explicit.cover_id, fallback.fallback_cover_id) AS cover_id,
        COALESCE(explicit.cover_type, fallback.fallback_cover_type) AS cover_type,
        COALESCE(explicit.cover_timestamp, fallback.fallback_cover_timestamp) AS cover_timestamp,
        COALESCE(explicit.cover_thumbnail_created_at, fallback.fallback_cover_thumbnail_created_at) AS cover_thumbnail_created_at,
        COALESCE(explicit.cover_position_x, 50) AS cover_position_x,
        COALESCE(explicit.cover_position_y, 50) AS cover_position_y,
        COALESCE(counts.item_count, 0) AS item_count
    FROM selected_albums a
    LEFT JOIN explicit_covers explicit ON explicit.album_id = a.id
    LEFT JOIN ranked_items fallback ON fallback.album_id = a.id AND fallback.item_rank = 1
    LEFT JOIN item_counts counts ON counts.album_id = a.id
    ORDER BY a.updated_at DESC, a.id DESC`;
    const result = await env.img_d1.prepare(sql).bind(...bindings).all();
    const rows = result.results || [];
    const page = rows.slice(0, query.limit);
    const finalRow = page.at(-1);
    return {
        albums: page.map((album) => presentDiscoverAlbum(album, requestUrl)),
        nextCursor: rows.length > query.limit && finalRow ? encodeCursor({ value: finalRow.updated_at, id: finalRow.id }) : null,
    };
}

export async function listFeaturedFiles(env, query, requestUrl) {
    const conditions = [PUBLIC_FILE_SQL, 'f.featured_at IS NOT NULL'];
    const bindings = [];
    if (query.cursor) {
        conditions.push('(f.featured_at < ? OR (f.featured_at = ? AND f.id < ?))');
        bindings.push(query.cursor.value, query.cursor.value, query.cursor.id);
    }
    bindings.push(query.limit + 1);
    const result = await env.img_d1.prepare(`SELECT f.id, f.file_name, f.file_type, f.timestamp, f.width, f.height, f.featured_at,
        json_extract(f.metadata, '$.Thumbnail.CreatedAt') AS thumbnail_created_at,
        u.username AS creator_name, u.public_handle AS creator_handle
        FROM files f JOIN users u ON u.discord_id = f.owner_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY f.featured_at DESC, f.id DESC LIMIT ?`).bind(...bindings).all();
    const rows = result.results || [];
    const page = rows.slice(0, query.limit);
    const finalRow = page.at(-1);
    return {
        files: page.map((file) => presentDiscoverFile(file, requestUrl)),
        nextCursor: rows.length > query.limit && finalRow ? encodeCursor({ value: finalRow.featured_at, id: finalRow.id }) : null,
    };
}

export async function listSharedAlbumFiles(env, albumId) {
    const result = await env.img_d1.prepare(`SELECT f.id, f.file_name, f.file_type, f.timestamp, f.visibility,
        json_extract(f.metadata, '$.Thumbnail.CreatedAt') AS thumbnail_created_at
        FROM album_items ai
        JOIN files f ON f.id = ai.file_id
        JOIN users u ON u.discord_id = f.owner_id
        WHERE ai.album_id = ? AND ${SHARED_ALBUM_FILE_SQL}
        ORDER BY ai.position, ai.created_at`).bind(albumId).all();
    return result.results || [];
}

export function presentDiscoverFile(file, requestUrl) {
    const url = absoluteFileUrl(requestUrl, file.id, file.timestamp);
    const isImage = String(file.file_type || '').startsWith('image/');
    return {
        id: file.id,
        name: file.file_name || file.id,
        type: file.file_type || 'application/octet-stream',
        createdAt: Number(file.timestamp) || 0,
        width: Number(file.width) || null,
        height: Number(file.height) || null,
        featuredAt: Number(file.featured_at) || null,
        creator: {
            name: file.creator_name || 'Creator',
            handle: file.creator_handle || null,
        },
        url,
        thumbnailUrl: isImage ? absoluteThumbnailUrl(requestUrl, file.id, 'gallery', thumbnailContentVersion(file)) : null,
    };
}

export function presentDiscoverAlbum(album, requestUrl) {
    const hasDiscoverableCover = Boolean(album.cover_id) && String(album.cover_type || '').startsWith('image/');
    const coverUrl = hasDiscoverableCover ? absoluteFileUrl(requestUrl, album.cover_id, album.cover_timestamp) : null;
    const coverThumbnailUrl = hasDiscoverableCover
        ? absoluteThumbnailUrl(requestUrl, album.cover_id, 'gallery', thumbnailContentVersion({
            timestamp: album.cover_timestamp,
            thumbnail_created_at: album.cover_thumbnail_created_at,
        }))
        : null;
    const url = new URL(requestUrl);
    url.protocol = 'https:';
    url.pathname = `/gallery/${encodeURIComponent(album.creator_handle)}/${encodeURIComponent(album.slug)}`;
    url.search = '';
    url.hash = '';
    return {
        id: album.id,
        name: album.name || '未命名图库',
        characterName: album.char_info_character_name || null,
        description: album.description || '',
        itemCount: Number(album.item_count) || 0,
        updatedAt: Number(album.updated_at) || 0,
        creator: {
            name: album.creator_name || 'Creator',
            handle: album.creator_handle,
        },
        url: url.toString(),
        coverUrl,
        coverThumbnailUrl,
        coverType: hasDiscoverableCover ? album.cover_type : null,
        coverPositionX: normalizeCoverPosition(album.cover_position_x),
        coverPositionY: normalizeCoverPosition(album.cover_position_y),
    };
}

function normalizeCoverPosition(value) {
    const position = Number(value);
    return Number.isInteger(position) && position >= 0 && position <= 100 ? position : 50;
}

export function normalizePublicFileVersion(version) {
    const numericVersion = Number(version);
    return Number.isFinite(numericVersion) && numericVersion > 0 ? String(numericVersion) : '';
}

export function absoluteFileUrl(requestUrl, fileId, version = '') {
    const url = new URL(requestUrl);
    url.protocol = 'https:';
    url.pathname = `/file/${String(fileId).split('/').map(encodeURIComponent).join('/')}`;
    url.search = '';
    const normalizedVersion = normalizePublicFileVersion(version);
    if (normalizedVersion) url.searchParams.set('v', normalizedVersion);
    url.hash = '';
    return url.toString();
}

export { absoluteThumbnailUrl };

export class CatalogRequestError extends Error {}
