import { CatalogRequestError, listDiscover, listDiscoverAlbums, parseDiscoverQuery } from '../../../utils/publicCatalog.js';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const FEATURED_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env, waitUntil }) {
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    try {
        const query = parseDiscoverQuery(new URL(request.url));
        const cacheableFeatured = query.sort === 'featured' && !query.cursor;
        const cache = cacheableFeatured && typeof caches !== 'undefined' ? caches.default : null;
        const cacheKey = cache ? new Request(request.url, { method: 'GET' }) : null;

        if (cache && cacheKey) {
            const cached = await cache.match(cacheKey);
            if (cached) return cached;
        }

        const includeAlbums = query.type === 'all' && query.sort === 'recent' && !query.cursor;
        const [page, albums] = await Promise.all([
            listDiscover(env, query, request.url),
            includeAlbums ? listDiscoverAlbums(env, request.url) : Promise.resolve([]),
        ]);

        const response = json(
            { ...page, albums, type: query.type, sort: query.sort },
            200,
            cacheableFeatured ? FEATURED_CACHE_CONTROL : 'no-store',
        );

        if (cache && cacheKey) {
            const cacheWrite = cache.put(cacheKey, response.clone()).catch((error) => {
                console.warn('Featured discover cache write failed', error?.message || error);
            });
            if (typeof waitUntil === 'function') waitUntil(cacheWrite);
            else await cacheWrite;
        }

        return response;
    } catch (error) {
        if (error instanceof CatalogRequestError) return json({ error: error.message }, 400);
        console.error('Discover catalog failed', error);
        return json({ error: 'Unable to load Discover' }, 500);
    }
}

function json(body, status = 200, cacheControl = 'no-store') {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': cacheControl },
    });
}
