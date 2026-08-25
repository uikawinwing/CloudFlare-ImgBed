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
    const type = url.searchParams.get('type') || 'all';
    const sort = url.searchParams.get('sort') || 'recent';
    if (!['all', 'image', 'video'].includes(type)) throw new CatalogRequestError('Invalid content type');
    if (!['recent', 'featured'].includes(sort)) throw new CatalogRequestError('Invalid sort order');
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    return { limit, type, sort, cursor };
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

export async function listDiscover(env, query, requestUrl) {
    const isFeatured = query.sort === 'featured';
    const orderColumn = isFeatured ? 'f.featured_at' : 'f.timestamp';
    const conditions = [PUBLIC_FILE_SQL];
    const bindings = [];
    if (isFeatured) conditions.push('f.featured_at IS NOT NULL');
    if (query.type === 'image') conditions.push("f.file_type LIKE 'image/%'");
    if (query.type === 'video') conditions.push("f.file_type LIKE 'video/%'");
    if (query.cursor) {
        conditions.push(`(${orderColumn} < ? OR (${orderColumn} = ? AND f.id < ?))`);
        bindings.push(query.cursor.value, query.cursor.value, query.cursor.id);
    }
    bindings.push(query.limit + 1);
    const sql = `SELECT f.id, f.file_name, f.file_type, f.timestamp, f.width, f.height, f.featured_at,
        json_extract(f.metadata, '$.Thumbnail.CreatedAt') AS thumbnail_created_at,
        u.username AS creator_name, u.public_handle AS creator_handle
        FROM files f JOIN users u ON u.discord_id = f.owner_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderColumn} DESC, f.id DESC LIMIT ?`;
    const result = await env.img_d1.prepare(sql).bind(...bindings).all();
    const rows = result.results || [];
    const hasMore = rows.length > query.limit;
    const files = rows.slice(0, query.limit).map((row) => presentDiscoverFile(row, requestUrl));
    const finalRow = rows[Math.min(rows.length, query.limit) - 1];
    return {
        files,
        nextCursor: hasMore && finalRow ? encodeCursor({ value: finalRow[isFeatured ? 'featured_at' : 'timestamp'], id: finalRow.id }) : null,
    };
}

export async function listDiscoverAlbums(env, requestUrl, limit = 12) {
    const pageSize = Math.min(Math.max(Number(limit) || 12, 1), 24);
    const sql = `WITH ranked_items AS (
        SELECT ai.album_id, f.id AS cover_id, f.file_type AS cover_type, f.visibility AS cover_visibility,
            f.timestamp AS cover_timestamp,
            json_extract(f.metadata, '$.Thumbnail.CreatedAt') AS cover_thumbnail_created_at,
            ROW_NUMBER() OVER (PARTITION BY ai.album_id ORDER BY ai.position, ai.created_at) AS item_rank
        FROM album_items ai
        JOIN files f ON f.id = ai.file_id
        WHERE f.visibility = 'public' AND f.moderation_status = 'active'
    ), item_counts AS (
        SELECT ai.album_id, COUNT(*) AS item_count
        FROM album_items ai
        JOIN files f ON f.id = ai.file_id
        WHERE f.visibility = 'public' AND f.moderation_status = 'active'
        GROUP BY ai.album_id
    )
    SELECT a.id, a.slug, a.name, a.description, a.updated_at,
        u.username AS creator_name, u.public_handle AS creator_handle,
        cover.cover_id, cover.cover_type, cover.cover_visibility, cover.cover_timestamp, cover.cover_thumbnail_created_at,
        COALESCE(counts.item_count, 0) AS item_count
    FROM albums a
    JOIN users u ON u.discord_id = a.owner_id
    LEFT JOIN ranked_items cover ON cover.album_id = a.id AND cover.item_rank = 1
    LEFT JOIN item_counts counts ON counts.album_id = a.id
    WHERE a.visibility = 'public' AND u.status = 'active' AND u.public_handle IS NOT NULL
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?`;
    const result = await env.img_d1.prepare(sql).bind(pageSize).all();
    return (result.results || []).map((album) => presentDiscoverAlbum(album, requestUrl));
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
    const url = absoluteFileUrl(requestUrl, file.id);
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
    const hasDiscoverableCover = album.cover_id && album.cover_visibility === 'public';
    const coverUrl = hasDiscoverableCover ? absoluteFileUrl(requestUrl, album.cover_id) : null;
    const coverThumbnailUrl = hasDiscoverableCover
        && String(album.cover_type || '').startsWith('image/')
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
        coverType: album.cover_type || null,
    };
}

export function absoluteFileUrl(requestUrl, fileId) {
    const url = new URL(requestUrl);
    url.protocol = 'https:';
    url.pathname = `/file/${String(fileId).split('/').map(encodeURIComponent).join('/')}`;
    url.search = '';
    url.hash = '';
    return url.toString();
}

export { absoluteThumbnailUrl };

export class CatalogRequestError extends Error {}
