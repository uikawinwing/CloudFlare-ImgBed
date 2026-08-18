import { getDatabase } from '../utils/databaseAdapter.js';
import { DiscordAPI } from '../utils/storage/discordAPI.js';
import {
    getPermanentThumbnail,
    resolvePermanentThumbnailCredentials,
    THUMBNAIL_CONTENT_TYPE,
    THUMBNAIL_WIDTH,
} from '../utils/thumbnail.js';

const THUMBNAIL_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

export async function onRequest(context) {
    const { request, env, params } = context;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    let fileId = '';
    try {
        fileId = decodeURIComponent(params.path).split(',').join('/');
    } catch {
        return new Response('Invalid thumbnail id', { status: 400 });
    }

    const db = getDatabase(env);
    const record = await db.getWithMetadata(fileId);
    const metadata = record?.metadata;
    if (!metadata
        || metadata.Visibility !== 'public'
        || (metadata.ModerationStatus && metadata.ModerationStatus !== 'active')
        || !String(metadata.FileType || '').startsWith('image/')) {
        return new Response('Thumbnail not found', { status: 404, headers: noStoreHeaders() });
    }

    const thumbnail = getPermanentThumbnail(metadata);
    if (!thumbnail) {
        return fallbackToDynamicThumbnail(request.url, fileId);
    }

    if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: thumbnailHeaders(thumbnail) });
    }

    const credentials = await resolvePermanentThumbnailCredentials(env, metadata);
    if (!credentials) {
        return fallbackToDynamicThumbnail(request.url, fileId);
    }

    try {
        const discordAPI = new DiscordAPI(credentials.botToken);
        let fileUrl = await discordAPI.getFileURL(credentials.channelId, credentials.messageId);
        if (!fileUrl) return fallbackToDynamicThumbnail(request.url, fileId);
        if (credentials.proxyUrl) {
            fileUrl = fileUrl.replace('https://cdn.discordapp.com', `https://${credentials.proxyUrl}`);
        }

        const upstream = await fetch(fileUrl);
        if (!upstream.ok || !upstream.body) {
            return fallbackToDynamicThumbnail(request.url, fileId);
        }

        const headers = thumbnailHeaders(thumbnail);
        const contentLength = upstream.headers.get('Content-Length');
        if (contentLength) headers.set('Content-Length', contentLength);
        const etag = upstream.headers.get('ETag');
        if (etag) headers.set('ETag', etag);

        return new Response(upstream.body, {
            status: 200,
            headers,
        });
    } catch (error) {
        console.error(`Permanent thumbnail read failed for ${fileId}:`, error);
        return fallbackToDynamicThumbnail(request.url, fileId);
    }
}

function fallbackToDynamicThumbnail(requestUrl, fileId) {
    const fallback = new URL(`/file/${encodeFilePath(fileId)}`, requestUrl);
    fallback.searchParams.set('width', String(THUMBNAIL_WIDTH));
    fallback.searchParams.set('format', 'webp');
    fallback.searchParams.set('fallback', 'original');
    return new Response(null, {
        status: 302,
        headers: {
            Location: fallback.toString(),
            'Cache-Control': 'private, no-store, max-age=0',
            'Access-Control-Allow-Origin': '*',
        },
    });
}

function thumbnailHeaders(thumbnail) {
    const headers = new Headers({
        'Content-Type': THUMBNAIL_CONTENT_TYPE,
        'Content-Disposition': `inline; filename="${safeHeaderFileName(thumbnail.FileName || 'thumbnail.webp')}"`,
        'Cache-Control': THUMBNAIL_CACHE_CONTROL,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    const size = Number(thumbnail.FileSizeBytes) || 0;
    if (size > 0) headers.set('Content-Length', String(size));
    return headers;
}

function noStoreHeaders() {
    return {
        'Cache-Control': 'private, no-store, max-age=0',
        'Access-Control-Allow-Origin': '*',
    };
}

function encodeFilePath(fileId) {
    return String(fileId).split('/').map(encodeURIComponent).join('/');
}

function safeHeaderFileName(value) {
    return String(value).replace(/["\\\r\n]/g, '_');
}
