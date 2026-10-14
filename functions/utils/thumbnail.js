import { transformImageResponse } from '../file/imageTransform.js';
import { getDatabase } from './databaseAdapter.js';
import { findConfiguredChannel, loadChannelConfig } from './metadata/channelConfig.js';
import { DiscordAPI } from './storage/discordAPI.js';

export const THUMBNAIL_WIDTH = 720;
export const THUMBNAIL_FORMAT = 'webp';
export const THUMBNAIL_CONTENT_TYPE = 'image/webp';
export const THUMBNAIL_VARIANTS = Object.freeze({
    avatar: Object.freeze({ width: 160, outputFormat: THUMBNAIL_CONTENT_TYPE }),
    library: Object.freeze({ width: 256, outputFormat: THUMBNAIL_CONTENT_TYPE }),
    gallery: Object.freeze({ width: THUMBNAIL_WIDTH, outputFormat: THUMBNAIL_CONTENT_TYPE }),
});

export function getThumbnailVariant(name) {
    if (!name || name === 'gallery') return THUMBNAIL_VARIANTS.gallery;
    return THUMBNAIL_VARIANTS[name] || null;
}

export function absoluteThumbnailUrl(requestUrl, fileId, variantName, version) {
    const variant = getThumbnailVariant(variantName) || THUMBNAIL_VARIANTS.gallery;
    const url = new URL(requestUrl);
    url.protocol = 'https:';
    url.pathname = `/thumb/${encodeFilePath(fileId)}`;
    url.search = '';
    if (variant !== THUMBNAIL_VARIANTS.gallery) url.searchParams.set('variant', variantName);
    const normalizedVersion = normalizeThumbnailVersion(version);
    if (normalizedVersion) url.searchParams.set('v', normalizedVersion);
    url.hash = '';
    return url.toString();
}

export function thumbnailVariantUrls(requestUrl, fileId, version) {
    return Object.keys(THUMBNAIL_VARIANTS).map(variant => absoluteThumbnailUrl(requestUrl, fileId, variant, version));
}

export function normalizeThumbnailVersion(version) {
    const numericVersion = Number(version);
    return Number.isFinite(numericVersion) && numericVersion > 0 ? String(numericVersion) : '';
}

export function thumbnailContentVersion(record = {}) {
    return normalizeThumbnailVersion(
        record?.Thumbnail?.CreatedAt
        || record?.thumbnail_created_at
        || record?.TimeStamp
        || record?.timestamp,
    );
}

export function createThumbnailTransform(metadata = {}, variantName) {
    const variant = getThumbnailVariant(variantName) || THUMBNAIL_VARIANTS.gallery;
    const sourceWidth = Number(metadata.Width) || 0;
    return {
        requested: true,
        options: {
            width: sourceWidth > 0 ? Math.min(sourceWidth, variant.width) : variant.width,
            fit: 'scale-down',
        },
        outputFormat: variant.outputFormat,
        fallback: null,
    };
}

export function getPermanentThumbnail(metadata = {}) {
    const thumbnail = metadata?.Thumbnail;
    if (thumbnail?.Channel === 'Discord' && thumbnail.DiscordMessageId) return thumbnail;
    if (thumbnail?.Version === 2 && thumbnail.Channel === 'CloudflareR2'
        && Object.keys(THUMBNAIL_VARIANTS).every(name => typeof thumbnail.Variants?.[name]?.Key === 'string' && thumbnail.Variants[name].Key.length > 0)) return thumbnail;
    return null;
}

export function hasPermanentThumbnail(metadata = {}) {
    return Boolean(getPermanentThumbnail(metadata));
}

export async function ensurePermanentThumbnail(context, fileId, metadata = {}, sourceFile) {
    if (!String(metadata.FileType || '').startsWith('image/')) {
        return { metadata, ready: false, created: false, reason: 'not-image' };
    }
    if (metadata.ModerationStatus && metadata.ModerationStatus !== 'active') {
        return { metadata, ready: false, created: false, reason: 'file-not-active' };
    }
    if (hasPermanentThumbnail(metadata)) {
        return { metadata, ready: true, created: false };
    }
    const bucket = context.env.THUMBNAILS;
    if (!bucket?.put || !bucket?.delete) {
        return { metadata, ready: false, created: false, reason: 'thumbnail-storage-missing' };
    }
    const writtenKeys = [];
    try {
        let source = sourceFile;
        if (!source) {
            const sourceUrl = new URL(`/file/${encodeFilePath(fileId)}`, context.request.url);
            const sourceResponse = await fetch(sourceUrl.toString(), { headers: { Accept: 'image/*' } });
            if (!sourceResponse.ok || !sourceResponse.body) {
                return { metadata, ready: false, created: false, reason: `source-${sourceResponse.status}` };
            }
            const length = Number(sourceResponse.headers.get('Content-Length'));
            if (length > 20 * 1024 * 1024) {
                await sourceResponse.body.cancel();
                return { metadata, ready: false, created: false, reason: 'source-too-large' };
            }
            const reader = sourceResponse.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 20 * 1024 * 1024) {
                    await reader.cancel();
                    return { metadata, ready: false, created: false, reason: 'source-too-large' };
                }
                chunks.push(value);
            }
            source = new Blob(chunks, { type: sourceResponse.headers.get('Content-Type') || metadata.FileType });
        }
        const sourceType = normalizeContentType(source.type || metadata.FileType);
        if (!sourceType.startsWith('image/')) {
            return { metadata, ready: false, created: false, reason: 'invalid-source-type' };
        }
        if (source.size > 20 * 1024 * 1024) {
            return { metadata, ready: false, created: false, reason: 'source-too-large' };
        }
        const thumbnail = {
            Version: 2,
            Channel: 'CloudflareR2',
            FileType: THUMBNAIL_CONTENT_TYPE,
            CreatedAt: Date.now(),
            Variants: {},
        };
        const prefix = `thumbnails/${crypto.randomUUID()}`;
        for (const name of Object.keys(THUMBNAIL_VARIANTS)) {
            const imageTransform = createThumbnailTransform(metadata, name);
            const transformed = await transformImageResponse({ env: context.env, imageTransform }, new Response(source.stream(), {
                headers: { 'Content-Type': sourceType, 'Content-Length': String(source.size) },
            }));
            if (!transformed.ok || !transformed.body || normalizeContentType(transformed.headers.get('Content-Type')) !== THUMBNAIL_CONTENT_TYPE) {
                throw new Error(`transform-${transformed.status}`);
            }
            const blob = await transformed.blob();
            if (!blob.size) throw new Error('empty-thumbnail');
            const key = `${prefix}/${name}.webp`;
            writtenKeys.push(key);
            await bucket.put(key, blob, { httpMetadata: { contentType: THUMBNAIL_CONTENT_TYPE } });
            const dimensions = getThumbnailDimensions(metadata, imageTransform.options.width);
            thumbnail.Variants[name] = { Key: key, Width: dimensions.width, Height: dimensions.height, FileSizeBytes: blob.size };
        }
        return {
            metadata: { ...metadata, Thumbnail: thumbnail, ThumbnailStatus: 'ready', ThumbnailReason: null },
            ready: true,
            created: true,
            thumbnail,
        };
    } catch (error) {
        console.error(`Permanent thumbnail generation failed for ${fileId}:`, error);
        if (writtenKeys.length) await cleanupThumbnailKeys(bucket, writtenKeys);
        const reason = /^(transform-\d+|empty-thumbnail)$/.test(error.message) ? error.message : 'thumbnail-generation-failed';
        return { metadata, ready: false, created: false, reason };
    }
}

export async function persistThumbnailResult(context, fileId, originalMetadata, result) {
    if (result.ready && !result.created) return result;
    const database = context.env.img_d1;
    if (!database?.prepare) {
        if (result.created) await deletePermanentThumbnail(context.env, result.metadata);
        return { metadata: originalMetadata, ready: false, created: false, reason: 'thumbnail-persistence-unavailable' };
    }
    try {
        const thumbnail = result.created ? result.thumbnail : originalMetadata.Thumbnail || null;
        const updated = await database.prepare(`UPDATE files SET metadata = json_set(metadata,
            '$.Thumbnail', json(?), '$.ThumbnailStatus', ?, '$.ThumbnailReason', ?), updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND moderation_status = 'active'
            AND COALESCE(json_extract(metadata, '$.ModerationStatus'), 'active') = 'active'
            AND json_extract(metadata, '$.TimeStamp') IS ?
            AND json_extract(metadata, '$.Thumbnail') IS json_extract(?, '$') RETURNING metadata`).bind(
            JSON.stringify(thumbnail), result.ready ? 'ready' : 'failed', result.reason || null, fileId,
            originalMetadata.TimeStamp ?? null, JSON.stringify(originalMetadata.Thumbnail || null),
        ).first();
        if (updated) return { ...result, metadata: JSON.parse(updated.metadata) };
        if (result.created) await deletePermanentThumbnail(context.env, result.metadata);
        const latest = await database.prepare('SELECT metadata FROM files WHERE id = ?').bind(fileId).first();
        const metadata = latest ? JSON.parse(latest.metadata) : null;
        return { metadata, ready: Boolean(metadata && hasPermanentThumbnail(metadata)), created: false, reason: latest ? 'thumbnail-state-changed' : 'file-deleted' };
    } catch (error) {
        console.error(`Permanent thumbnail persistence failed for ${fileId}:`, error);
        if (result.created) {
            try {
                const latest = await database.prepare('SELECT metadata FROM files WHERE id = ?').bind(fileId).first();
                const metadata = latest ? JSON.parse(latest.metadata) : null;
                const key = result.thumbnail.Variants.avatar.Key;
                if (metadata?.Thumbnail?.Variants?.avatar?.Key === key) {
                    return { ...result, metadata, ready: hasPermanentThumbnail(metadata) };
                }
                // The write may have committed and then been renamed; preserve uncertain objects.
                console.error(`Uncertain thumbnail persistence for ${fileId}; preserving objects`);
            } catch (verificationError) {
                console.error(`Unable to verify thumbnail persistence for ${fileId}; preserving objects:`, verificationError);
            }
        }
        return { metadata: originalMetadata, ready: false, created: false, reason: 'thumbnail-persistence-failed' };
    }
}

export async function resolvePermanentThumbnailCredentials(env, metadata = {}) {
    const thumbnail = getPermanentThumbnail(metadata);
    if (!thumbnail || thumbnail.Channel !== 'Discord') return null;

    const db = getDatabase(env);
    const uploadConfig = await loadChannelConfig(db, env, 'thumbnail read');
    const channel = findConfiguredChannel(uploadConfig, 'discord', { ChannelName: thumbnail.ChannelName });
    if (!channel?.botToken || !channel?.channelId) return null;

    return {
        botToken: channel.botToken,
        channelId: channel.channelId,
        proxyUrl: channel.proxyUrl || '',
        messageId: thumbnail.DiscordMessageId,
    };
}

export async function deletePermanentThumbnail(env, metadata = {}) {
    try {
        if (metadata.Thumbnail?.Channel === 'CloudflareR2') {
            const keys = Object.values(metadata.Thumbnail.Variants || {}).map(variant => variant.Key).filter(Boolean);
            if (!keys.length) return true;
            if (!env.THUMBNAILS?.delete) return false;
            return await cleanupThumbnailKeys(env.THUMBNAILS, keys);
        }
        if (!getPermanentThumbnail(metadata)) return true;
        const credentials = await resolvePermanentThumbnailCredentials(env, metadata);
        if (!credentials) return false;
        const discordAPI = new DiscordAPI(credentials.botToken);
        return await discordAPI.deleteMessage(credentials.channelId, credentials.messageId);
    } catch (error) {
        console.error('Permanent thumbnail deletion failed:', error);
        return false;
    }
}

async function cleanupThumbnailKeys(bucket, keys) {
    try {
        await bucket.delete([...new Set(keys)]);
        return true;
    } catch (error) {
        console.error('Permanent thumbnail object cleanup failed:', error);
        return false;
    }
}

function getThumbnailDimensions(metadata, targetWidth) {
    const sourceWidth = Number(metadata.Width) || 0;
    const sourceHeight = Number(metadata.Height) || 0;
    if (!sourceWidth || !sourceHeight) return { width: targetWidth, height: null };
    const scale = targetWidth / sourceWidth;
    return {
        width: targetWidth,
        height: Math.max(1, Math.round(sourceHeight * scale)),
    };
}

function encodeFilePath(fileId) {
    return String(fileId).split('/').map(encodeURIComponent).join('/');
}

function normalizeContentType(contentType) {
    return String(contentType || '').split(';', 1)[0].trim().toLowerCase();
}
