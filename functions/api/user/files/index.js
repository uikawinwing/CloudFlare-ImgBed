import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { absoluteThumbnailUrl, hasPermanentThumbnail, thumbnailContentVersion } from '../../../utils/thumbnail.js';
import { normalizeTags, validateTag } from '../../../utils/tagHelpers.js';

export async function onRequestGet({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    const url = new URL(request.url);
    const limit = pageLimit(url.searchParams.get('limit'));
    const sort = normalizeSort(url.searchParams.get('sort'));
    const filter = normalizeFilter(url.searchParams.get('filter'));
    const query = normalizeQuery(url.searchParams.get('query'));
    const cursorValue = url.searchParams.get('cursor');
    const cursor = parseCursor(cursorValue, sort);
    if (cursorValue && !cursor) return json({ error: 'Invalid page cursor' }, 400);
    const where = ['owner_id = ?'];
    const bindings = [identity.id];

    if (filter === 'image') where.push("file_type LIKE 'image/%'");
    if (filter === 'video') where.push("file_type LIKE 'video/%'");
    const terms = query.split(/\s+/);
    const tagTerms = terms.filter(term => term.startsWith('#') && validateTag(term.slice(1)));
    const keywords = terms.filter(term => !tagTerms.includes(term)).join(' ');
    const tagRows = "json_each(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.Tags')";
    if (keywords) {
        where.push(`(LOWER(COALESCE(file_name, '')) LIKE ? ESCAPE '\\' OR LOWER(id) LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM ${tagRows} WHERE type = 'text' AND LOWER(value) LIKE ? ESCAPE '\\'))`);
        const pattern = `%${keywords.replace(/[\\%_]/g, '\\$&')}%`;
        bindings.push(pattern, pattern, pattern);
    }
    for (const tag of normalizeTags(tagTerms.map(term => term.slice(1)))) {
        where.push(`EXISTS (SELECT 1 FROM ${tagRows} WHERE type = 'text' AND LOWER(value) = ?)`);
        bindings.push(tag);
    }

    const order = orderFor(sort);
    const cursorClause = cursorClauseFor(cursor, sort);
    if (cursorClause) {
        where.push(cursorClause.sql);
        bindings.push(...cursorClause.bindings);
    }

    const rows = await env.img_d1.prepare(`SELECT id, file_name, file_type, file_size_bytes, timestamp, width, height, visibility, moderation_status, metadata,
        LOWER(COALESCE(NULLIF(file_name, ''), id)) AS sort_name
        FROM files WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).bind(...bindings, limit + 1).all();
    const result = rows.results || [];
    const hasMore = result.length > limit;
    const page = hasMore ? result.slice(0, limit) : result;
    const files = page.map((row) => {
        const metadata = parseMetadata(row.metadata);
        const isImage = String(row.file_type || '').startsWith('image/');
        const { metadata: _metadata, sort_name: _sortName, ...file } = row;
        return {
            ...file,
            tags: normalizeTags(metadata?.Tags),
            thumbnail_url: isImage ? absoluteThumbnailUrl(request.url, row.id, 'gallery', thumbnailContentVersion({
                ...metadata,
                timestamp: row.timestamp,
            })) : null,
            thumbnail_ready: isImage && hasPermanentThumbnail(metadata),
        };
    });
    const usage = await env.img_d1.prepare('SELECT used_bytes FROM users WHERE discord_id = ?').bind(identity.id).first();
    return json({
        files,
        nextCursor: hasMore ? JSON.stringify(cursorFor(page[page.length - 1], sort)) : null,
        usedBytes: Number(usage?.used_bytes) || 0,
    });
}

export async function onRequestPatch({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity) return json({ error: 'Discord sign-in is required' }, 401);
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    let payload;
    try {
        payload = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }
    if (!payload || typeof payload.fileId !== 'string' || !payload.fileId || payload.fileId.length > 1024) {
        return json({ error: 'Invalid file ID' }, 400);
    }
    if (!Array.isArray(payload.tags) || payload.tags.length > 30 || payload.tags.some(tag =>
        typeof tag !== 'string' || tag.trim().length > 32 || !validateTag(tag.trim()))) {
        return json({ error: 'Use up to 30 tags of 1–32 letters, numbers, CJK characters, underscores or hyphens' }, 400);
    }
    const tags = normalizeTags(payload.tags);
    const file = await env.img_d1.prepare(`UPDATE files
        SET metadata = json_patch(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, json_object('Tags', json(?)))
        WHERE id = ? AND owner_id = ? RETURNING id`).bind(JSON.stringify(tags), payload.fileId, identity.id).first();
    if (!file) return json({ error: 'File not found' }, 404);
    return json({ tags });
}

function pageLimit(value) {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 50;
}

function normalizeSort(value) {
    return ['newest', 'oldest', 'name'].includes(value) ? value : 'newest';
}

function normalizeFilter(value) {
    return ['image', 'video'].includes(value) ? value : 'all';
}

function normalizeQuery(value) {
    return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US').slice(0, 200) : '';
}

function parseCursor(value, sort) {
    if (!value || value.length > 1024) return null;
    try {
        const cursor = JSON.parse(value);
        if (!cursor || cursor.sort !== sort || typeof cursor.id !== 'string' || cursor.id.length > 1024) return null;
        if (sort === 'name') return typeof cursor.name === 'string' && cursor.name.length <= 1024 ? cursor : null;
        return Number.isSafeInteger(cursor.timestamp) ? cursor : null;
    } catch {
        return null;
    }
}

function orderFor(sort) {
    if (sort === 'oldest') return 'COALESCE(timestamp, 0) ASC, id ASC';
    if (sort === 'name') return "LOWER(COALESCE(NULLIF(file_name, ''), id)) ASC, id ASC";
    return 'COALESCE(timestamp, 0) DESC, id DESC';
}

function cursorFor(row, sort) {
    if (sort === 'name') return { sort, name: row.sort_name, id: row.id };
    return { sort, timestamp: Number(row.timestamp) || 0, id: row.id };
}

function cursorClauseFor(cursor, sort) {
    if (!cursor) return null;
    if (sort === 'oldest') return { sql: '(COALESCE(timestamp, 0), id) > (?, ?)', bindings: [cursor.timestamp, cursor.id] };
    if (sort === 'name') return { sql: "(LOWER(COALESCE(NULLIF(file_name, ''), id)), id) > (?, ?)", bindings: [cursor.name, cursor.id] };
    return { sql: '(COALESCE(timestamp, 0), id) < (?, ?)', bindings: [cursor.timestamp, cursor.id] };
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
