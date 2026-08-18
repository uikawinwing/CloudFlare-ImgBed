const MAX_PAGE_SIZE = 48;

export const PUBLIC_FILE_SQL = "f.visibility = 'public' AND f.moderation_status = 'active' AND u.status = 'active'";

export function isPublicCatalogFile(file, owner) {
    return file?.visibility === 'public'
        && file?.moderation_status === 'active'
        && owner?.status === 'active';
}

export function resolveFilePublication(metadata, payload) {
    const visibility = payload.visibility === undefined ? (metadata.Visibility || 'private') : payload.visibility;
    if (!['private', 'unlisted', 'public'].includes(visibility)) return null;
    return {
        visibility,
        discoverEligible: visibility === 'public' ? 1 : 0,
    };
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

export async function listPublicAlbumFiles(env, albumId) {
    const result = await env.img_d1.prepare(`SELECT f.id, f.file_name, f.timestamp
        FROM album_items ai
        JOIN files f ON f.id = ai.file_id
        JOIN users u ON u.discord_id = f.owner_id
        WHERE ai.album_id = ? AND ${PUBLIC_FILE_SQL}
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
        thumbnailUrl: isImage ? `${url}?width=720&fallback=original` : null,
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

export class CatalogRequestError extends Error {}
