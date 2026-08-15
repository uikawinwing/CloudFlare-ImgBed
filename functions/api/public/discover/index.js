import { CatalogRequestError, listDiscover, parseDiscoverQuery } from '../../../utils/publicCatalog.js';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
    if (!env.img_d1?.prepare) return json({ error: 'D1 is required' }, 503);
    try {
        const query = parseDiscoverQuery(new URL(request.url));
        const page = await listDiscover(env, query, request.url);
        return json({ ...page, type: query.type, sort: query.sort });
    } catch (error) {
        if (error instanceof CatalogRequestError) return json({ error: error.message }, 400);
        console.error('Discover catalog failed', error);
        return json({ error: 'Unable to load Discover' }, 500);
    }
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': status < 400 ? 'public, max-age=60' : 'no-store' },
    });
}
