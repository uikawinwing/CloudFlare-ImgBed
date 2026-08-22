export const ALLOWED_UPLOAD_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'video/mp4',
]);

const CANONICAL_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'video/mp4': 'mp4',
});

const TRUSTED_DISCORD_ATTACHMENT_HOSTS = new Set([
    'cdn.discordapp.com',
    'media.discordapp.net',
]);

const MP4_BRANDS = new Set([
    'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
    'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'M4VH', 'M4VP',
]);

export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_PIXELS = 100_000_000;

export function normalizeMediaType(value) {
    return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

export function canonicalExtensionForMediaType(fileType) {
    return CANONICAL_EXTENSIONS[normalizeMediaType(fileType)] || null;
}

function bytesToAscii(bytes, start, end) {
    return String.fromCharCode(...bytes.slice(start, end));
}

function matchesMp4Signature(bytes) {
    if (bytes.length < 16) return false;
    if (bytesToAscii(bytes, 4, 8) !== 'ftyp') return false;

    const boxSize = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    if (boxSize !== 0 && boxSize < 16) return false;

    const brands = [bytesToAscii(bytes, 8, 12)];
    const limit = Math.min(bytes.length, boxSize || bytes.length);
    for (let offset = 16; offset + 4 <= limit; offset += 4) {
        brands.push(bytesToAscii(bytes, offset, offset + 4));
    }
    return brands.some(brand => MP4_BRANDS.has(brand));
}

export async function matchesAllowedFileSignature(file, fileType) {
    const normalizedType = normalizeMediaType(fileType);
    if (!ALLOWED_UPLOAD_TYPES.has(normalizedType)) return false;

    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (normalizedType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (normalizedType === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (normalizedType === 'image/gif') return bytesToAscii(bytes, 0, 4) === 'GIF8';
    if (normalizedType === 'image/webp') return bytesToAscii(bytes, 0, 4) === 'RIFF' && bytesToAscii(bytes, 8, 12) === 'WEBP';
    if (normalizedType === 'image/avif') {
        return bytesToAscii(bytes, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(bytesToAscii(bytes, 8, 12));
    }
    if (normalizedType === 'video/mp4') return matchesMp4Signature(bytes);
    return false;
}

export function validateImageDimensions(dimensions) {
    if (!dimensions) return null;
    const width = Number(dimensions.width);
    const height = Number(dimensions.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 'Invalid image dimensions';
    }
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        return `Image dimensions exceed ${MAX_IMAGE_DIMENSION}px per side`;
    }
    if (width * height > MAX_IMAGE_PIXELS) {
        return `Image exceeds the ${MAX_IMAGE_PIXELS} pixel safety limit`;
    }
    return null;
}

export function isTrustedDiscordAttachmentUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:'
            && !url.username
            && !url.password
            && TRUSTED_DISCORD_ATTACHMENT_HOSTS.has(url.hostname.toLowerCase())
            && url.pathname.startsWith('/attachments/');
    } catch {
        return false;
    }
}

export function validateDiscordAttachment(fileInfo, expected = {}) {
    if (!fileInfo) return 'Discord response does not contain an attachment';
    if (!isTrustedDiscordAttachmentUrl(fileInfo.url)) return 'Discord returned an untrusted attachment URL';

    const expectedSize = Number(expected.size);
    const actualSize = Number(fileInfo.file_size);
    if (Number.isFinite(expectedSize) && (!Number.isFinite(actualSize) || actualSize !== expectedSize)) {
        return 'Discord attachment size does not match the uploaded file';
    }

    const expectedType = normalizeMediaType(expected.fileType);
    const actualType = normalizeMediaType(fileInfo.content_type);
    if (expectedType && actualType !== expectedType) {
        return 'Discord attachment content type does not match the uploaded file';
    }

    if (expected.fileName && String(fileInfo.file_name || '') !== String(expected.fileName)) {
        return 'Discord attachment filename does not match the canonical storage name';
    }

    return null;
}
