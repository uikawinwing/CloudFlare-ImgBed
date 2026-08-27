import { transformImageResponse } from '../file/imageTransform.js';
import { getDatabase } from '../utils/databaseAdapter.js';
import { DiscordAPI } from '../utils/storage/discordAPI.js';
import {
    createThumbnailTransform,
    getPermanentThumbnail,
    getThumbnailVariant,
    absoluteThumbnailUrl,
    thumbnailContentVersion,
    resolvePermanentThumbnailCredentials,
    THUMBNAIL_CONTENT_TYPE,
} from '../utils/thumbnail.js';

export const THUMBNAIL_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const LEGACY_THUMBNAIL_CACHE_CONTROL = 'public, max-age=60, must-revalidate';

export async function onRequest(context) {
    const { request, env, params } = context;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { ...corsHeaders(), Allow: 'GET, HEAD' } });
    }

    let fileId = '';
    try {
        const pathSegments = Array.isArray(params.path) ? params.path : String(params.path || '').split(',');
        fileId = pathSegments.map(segment => decodeURIComponent(String(segment || ''))).join('/');
    } catch {
        return new Response('Invalid thumbnail id', { status: 400, headers: noStoreHeaders() });
    }

    const requestUrl = new URL(request.url);
    const requestedVariant = requestUrl.searchParams.get('variant');
    const variantName = requestedVariant || 'gallery';
    if (!getThumbnailVariant(requestedVariant)) {
        return new Response('Invalid thumbnail variant', { status: 400, headers: noStoreHeaders() });
    }

    const db = getDatabase(env);
    const record = await db.getWithMetadata(fileId);
    const metadata = record?.metadata;
    if (!metadata
        || (metadata.ModerationStatus && metadata.ModerationStatus !== 'active')
        || !String(metadata.FileType || '').startsWith('image/')) {
        return new Response('Thumbnail not found', { status: 404, headers: noStoreHeaders() });
    }

    const currentVersion = thumbnailContentVersion(metadata);
    const requestedVersion = requestUrl.searchParams.get('v') || '';
    if (requestedVersion && requestedVersion !== currentVersion) {
        return new Response('Thumbnail version not found', { status: 404, headers: noStoreHeaders() });
    }
    if (!requestedVersion && currentVersion) {
        return thumbnailVersionRedirect(request.url, fileId, variantName, currentVersion);
    }

    const isVersioned = Boolean(currentVersion && requestedVersion);
    const cacheControl = isVersioned ? THUMBNAIL_CACHE_CONTROL : LEGACY_THUMBNAIL_CACHE_CONTROL;
    const cacheKey = thumbnailCacheKey(request.url, variantName, currentVersion);
    const edgeCache = getEdgeCache();
    const cached = await matchEdgeCache(edgeCache, cacheKey);
    if (cached) return request.method === 'HEAD' ? headResponse(cached) : cached;

    const permanent = getPermanentThumbnail(metadata);
    if (request.method === 'HEAD' && variantName === 'gallery' && permanent) {
        return permanentThumbnailHead(permanent, fileId, metadata, cacheControl);
    }

    const response = await createThumbnailResponse(context, fileId, metadata, variantName, cacheControl);
    if (!response.ok || normalizeContentType(response.headers.get('Content-Type')) !== THUMBNAIL_CONTENT_TYPE) {
        return response;
    }

    await putEdgeCache(context, edgeCache, cacheKey, response);
    return request.method === 'HEAD' ? headResponse(response) : response;
}

async function createThumbnailResponse(context, fileId, metadata, variantName, cacheControl) {
    const permanent = getPermanentThumbnail(metadata);
    let source = permanent ? await fetchPermanentThumbnail(context.env, metadata) : null;
    if (permanent && !source) {
        return new Response('Permanent thumbnail source unavailable', { status: 502, headers: noStoreHeaders() });
    }
    let sourceIsPermanent = Boolean(permanent);
    let sourceMetadata = permanent ? { Width: permanent.Width || metadata.Width } : metadata;

    if (!source) {
        source = await fetchOriginal(context.request.url, fileId);
        sourceIsPermanent = false;
        sourceMetadata = metadata;
    }
    if (!source?.ok || !source.body) {
        const status = source?.status === 404 ? 404 : 502;
        return new Response('Thumbnail source unavailable', { status, headers: noStoreHeaders() });
    }

    let result = source;
    if (!sourceIsPermanent || variantName !== 'gallery') {
        result = await transformImageResponse({
            env: context.env,
            imageTransform: createThumbnailTransform(sourceMetadata, variantName),
        }, source);
    }
    if (!result.ok || !result.body || normalizeContentType(result.headers.get('Content-Type')) !== THUMBNAIL_CONTENT_TYPE) {
        return new Response('Thumbnail transformation unavailable', {
            status: result.status >= 400 ? result.status : 502,
            headers: noStoreHeaders(),
        });
    }

    return cacheableThumbnailResponse(result, fileId, variantName, metadata, cacheControl);
}

function permanentThumbnailHead(permanent, fileId, metadata, cacheControl) {
    const headers = new Headers({
        'Content-Type': THUMBNAIL_CONTENT_TYPE,
        'Content-Disposition': `inline; filename="${safeHeaderFileName(thumbnailFileName(fileId, 'gallery'))}"`,
        'Cache-Control': cacheControl,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'ETag': `W/"thumbnail-${hashString(`${fileId}:gallery:${metadata.TimeStamp || ''}`)}"`,
    });
    const size = Number(permanent.FileSizeBytes) || 0;
    if (size > 0) headers.set('Content-Length', String(size));
    return new Response(null, { status: 200, headers });
}

async function fetchPermanentThumbnail(env, metadata) {
    try {
        const credentials = await resolvePermanentThumbnailCredentials(env, metadata);
        if (!credentials) return null;

        const discordAPI = new DiscordAPI(credentials.botToken);
        let fileUrl = await discordAPI.getFileURL(credentials.channelId, credentials.messageId);
        if (!fileUrl) return null;
        if (credentials.proxyUrl) {
            fileUrl = fileUrl.replace('https://cdn.discordapp.com', `https://${credentials.proxyUrl}`);
        }

        const response = await fetch(fileUrl);
        return response.ok && response.body ? response : null;
    } catch (error) {
        console.error('Permanent thumbnail read failed:', error);
        return null;
    }
}

function fetchOriginal(requestUrl, fileId) {
    const sourceUrl = new URL(`/file/${encodeFilePath(fileId)}`, requestUrl);
    return fetch(sourceUrl.toString(), { headers: { Accept: 'image/*' } });
}

function cacheableThumbnailResponse(response, fileId, variantName, metadata, cacheControl) {
    const headers = new Headers(response.headers);
    headers.set('Content-Type', THUMBNAIL_CONTENT_TYPE);
    headers.set('Content-Disposition', `inline; filename="${safeHeaderFileName(thumbnailFileName(fileId, variantName))}"`);
    headers.set('Cache-Control', cacheControl);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (!headers.has('ETag')) {
        headers.set('ETag', `W/"thumbnail-${hashString(`${fileId}:${variantName}:${metadata.TimeStamp || ''}`)}"`);
    }
    return new Response(response.body, { status: 200, headers });
}

function thumbnailCacheKey(requestUrl, variantName, version) {
    const url = new URL(requestUrl);
    url.search = '';
    if (variantName !== 'gallery') url.searchParams.set('variant', variantName);
    if (version) url.searchParams.set('v', version);
    url.hash = '';
    return new Request(url.toString(), { method: 'GET' });
}

function thumbnailVersionRedirect(requestUrl, fileId, variantName, version) {
    const location = absoluteThumbnailUrl(requestUrl, fileId, variantName, version);
    return new Response(null, {
        status: 302,
        headers: {
            ...corsHeaders(),
            'Cache-Control': LEGACY_THUMBNAIL_CACHE_CONTROL,
            'Location': location,
        },
    });
}

function getEdgeCache() {
    return typeof caches !== 'undefined' ? caches.default : null;
}

async function matchEdgeCache(cache, key) {
    if (!cache?.match) return null;
    try {
        return await cache.match(key);
    } catch (error) {
        console.warn('Thumbnail edge cache read failed:', error.message);
        return null;
    }
}

async function putEdgeCache(context, cache, key, response) {
    if (!cache?.put) return;
    const operation = cache.put(key, response.clone()).catch((error) => {
        console.warn('Thumbnail edge cache write failed:', error.message);
    });
    if (typeof context.waitUntil === 'function') {
        context.waitUntil(operation);
    } else {
        await operation;
    }
}

function headResponse(response) {
    return new Response(null, { status: response.status, headers: response.headers });
}

function noStoreHeaders() {
    return {
        ...corsHeaders(),
        'Cache-Control': 'private, no-store, max-age=0',
    };
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
    };
}

function thumbnailFileName(fileId, variantName) {
    const base = String(fileId).split('/').pop().replace(/\.[^.]+$/, '') || 'image';
    return `${base}.${variantName}.webp`;
}

function encodeFilePath(fileId) {
    return String(fileId).split('/').map(encodeURIComponent).join('/');
}

function normalizeContentType(contentType) {
    return String(contentType || '').split(';', 1)[0].trim().toLowerCase();
}

function safeHeaderFileName(value) {
    return String(value).replace(/["\\\r\n]/g, '_');
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16);
}
