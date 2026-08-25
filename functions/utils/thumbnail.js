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
    if (!thumbnail || thumbnail.Channel !== 'Discord' || !thumbnail.DiscordMessageId) return null;
    return thumbnail;
}

export function hasPermanentThumbnail(metadata = {}) {
    return Boolean(getPermanentThumbnail(metadata));
}

export async function ensurePermanentThumbnail(context, fileId, metadata = {}) {
    if (!String(metadata.FileType || '').startsWith('image/')) {
        return { metadata, ready: false, created: false, reason: 'not-image' };
    }
    if (hasPermanentThumbnail(metadata)) {
        return { metadata, ready: true, created: false };
    }

    try {
        const sourceUrl = new URL(`/file/${encodeFilePath(fileId)}`, context.request.url);
        const sourceResponse = await fetch(sourceUrl.toString(), {
            headers: { Accept: 'image/*' },
        });
        if (!sourceResponse.ok || !sourceResponse.body) {
            return { metadata, ready: false, created: false, reason: `source-${sourceResponse.status}` };
        }

        const sourceType = normalizeContentType(sourceResponse.headers.get('Content-Type') || metadata.FileType);
        if (!sourceType.startsWith('image/')) {
            return { metadata, ready: false, created: false, reason: 'invalid-source-type' };
        }

        const imageTransform = createThumbnailTransform(metadata);
        const targetWidth = imageTransform.options.width;
        const transformed = await transformImageResponse({
            env: context.env,
            imageTransform,
        }, sourceResponse);

        if (!transformed.ok || !transformed.body || normalizeContentType(transformed.headers.get('Content-Type')) !== THUMBNAIL_CONTENT_TYPE) {
            return { metadata, ready: false, created: false, reason: `transform-${transformed.status}` };
        }

        const channel = await resolveThumbnailUploadChannel(context.env, metadata);
        if (!channel?.botToken || !channel?.channelId) {
            return { metadata, ready: false, created: false, reason: 'discord-thumbnail-channel-missing' };
        }

        const blob = await transformed.blob();
        if (!blob.size) {
            return { metadata, ready: false, created: false, reason: 'empty-thumbnail' };
        }

        const discordAPI = new DiscordAPI(channel.botToken);
        const thumbnailFileName = buildThumbnailFileName(fileId);
        const thumbnailFile = new File([blob], thumbnailFileName, { type: THUMBNAIL_CONTENT_TYPE });
        const response = await discordAPI.sendFile(thumbnailFile, channel.channelId, thumbnailFileName);
        const fileInfo = discordAPI.getFileInfo(response);
        if (!fileInfo?.message_id) {
            return { metadata, ready: false, created: false, reason: 'discord-thumbnail-upload-failed' };
        }

        const dimensions = getThumbnailDimensions(metadata, targetWidth);
        const thumbnail = {
            Version: 1,
            Channel: 'Discord',
            ChannelName: channel.name || 'Discord_env',
            DiscordMessageId: fileInfo.message_id,
            FileName: thumbnailFileName,
            FileType: THUMBNAIL_CONTENT_TYPE,
            FileSizeBytes: Number(fileInfo.file_size) || blob.size,
            Width: dimensions.width,
            Height: dimensions.height,
            CreatedAt: Date.now(),
        };

        return {
            metadata: { ...metadata, Thumbnail: thumbnail },
            ready: true,
            created: true,
            thumbnail,
        };
    } catch (error) {
        console.error(`Permanent thumbnail generation failed for ${fileId}:`, error);
        return { metadata, ready: false, created: false, reason: error.message || 'thumbnail-generation-failed' };
    }
}

export async function resolvePermanentThumbnailCredentials(env, metadata = {}) {
    const thumbnail = getPermanentThumbnail(metadata);
    if (!thumbnail) return null;

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
    const credentials = await resolvePermanentThumbnailCredentials(env, metadata);
    if (!credentials) return true;

    try {
        const discordAPI = new DiscordAPI(credentials.botToken);
        return await discordAPI.deleteMessage(credentials.channelId, credentials.messageId);
    } catch (error) {
        console.error('Permanent thumbnail deletion failed:', error);
        return false;
    }
}

async function resolveThumbnailUploadChannel(env, metadata = {}) {
    const db = getDatabase(env);
    const uploadConfig = await loadChannelConfig(db, env, 'thumbnail storage');
    if (!uploadConfig) return null;

    const preferredName = metadata?.Thumbnail?.ChannelName
        || (metadata.Channel === 'Discord' ? metadata.ChannelName : '');
    if (preferredName) {
        const preferred = findConfiguredChannel(uploadConfig, 'discord', { ChannelName: preferredName });
        if (preferred) return preferred;
    }

    return uploadConfig.discord?.channels?.[0] || null;
}

function buildThumbnailFileName(fileId) {
    const base = String(fileId).split('/').pop().replace(/\.[^.]+$/, '') || 'image';
    return `${base}.thumb.${THUMBNAIL_FORMAT}`;
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
