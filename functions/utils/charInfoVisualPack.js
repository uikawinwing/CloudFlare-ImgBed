import { requireCharInfoAlbumIdentity } from './charInfoGallery.js';
import { normalizeCharInfoVisualConfig } from './charInfoVisualConfig.js';
import { absoluteFileUrl, absoluteThumbnailUrl } from './publicCatalog.js';
import { thumbnailContentVersion } from './thumbnail.js';

export const CHAR_INFO_VISUAL_PACK_FORMAT = 'char-info-visual-pack';
export const CHAR_INFO_VISUAL_PACK_VERSION = 1;

export function parsePublicVisualConfig(storedValue) {
    if (typeof storedValue !== 'string' || !storedValue.trim()) return normalizeCharInfoVisualConfig({});
    try {
        const parsed = JSON.parse(storedValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return normalizeCharInfoVisualConfig(parsed);
    } catch {
        return null;
    }
}

export function createCharInfoVisualPack({ album, files, storedVisualConfig, requestUrl }) {
    const identity = requireCharInfoAlbumIdentity(album);
    const visualConfig = parsePublicVisualConfig(storedVisualConfig);
    const sharedFiles = Array.isArray(files) ? files : [];
    const fileById = new Map(sharedFiles.map(file => [String(file.id), file]));
    const orderedFiles = orderGalleryFiles(sharedFiles, visualConfig?.mainFileId);

    return {
        format: CHAR_INFO_VISUAL_PACK_FORMAT,
        version: CHAR_INFO_VISUAL_PACK_VERSION,
        packId: identity.packId,
        profileId: identity.profileId,
        characterName: identity.characterName,
        galleryUrl: album.slug
            ? new URL(`/api/public/gallery/${encodeURIComponent(identity.packId)}/${encodeURIComponent(album.slug)}`, requestUrl).href
            : null,
        visual: visualConfig ? buildVisualPayload(visualConfig, fileById, requestUrl) : null,
        gallery: orderedFiles.map(file => buildGalleryItem(file, visualConfig, requestUrl)),
    };
}

// The dedicated Album URL uses UUID identity and member order. The legacy
// gallery view keeps its existing handle identity and selected main portrait.
export function createCharInfoGalleryPack({ album, files, storedVisualConfig, requestUrl, stableIdentity = false }) {
    const identity = requireCharInfoAlbumIdentity(stableIdentity ? { ...album, public_handle: album.id } : album);
    const visualConfig = parsePublicVisualConfig(storedVisualConfig);
    const sharedFiles = Array.isArray(files) ? files : [];
    const orderedFiles = stableIdentity ? sharedFiles : orderGalleryFiles(sharedFiles, visualConfig?.mainFileId);
    const gallery = orderedFiles.map(file => buildGalleryItem(file, visualConfig, requestUrl))
        .filter(item => isViewerMediaUrl(item.sources[0]));
    if (stableIdentity) {
        // Historical filenames may contain characters forbidden by the v1
        // parser. Normalize only the displayed title at this protocol boundary.
        gallery.forEach((item, index) => {
            item.title = String(item.title).replace(/[\x00-\x1f\x7f]/gu, ' ').trim() || `Media ${index + 1}`;
        });
    }
    const visual = visualConfig ? buildVisualPayload(visualConfig, new Map(sharedFiles.map(file => [String(file.id), file])), requestUrl) : null;
    const fallbackImage = gallery.map(item => item.sources[0]).find(source => isViewerMediaUrl(source, true)) || null;
    let avatarThumbnail = isViewerMediaUrl(visual?.avatarUrl, true) ? visual.avatarUrl : fallbackImage;
    let libraryThumbnail = isViewerMediaUrl(visual?.coverUrl, true) ? visual.coverUrl : fallbackImage;
    if (stableIdentity) {
        const avatarFile = sharedFiles.find(file => absoluteFileUrl(requestUrl, file.id, file.timestamp) === avatarThumbnail);
        const libraryFile = sharedFiles.find(file => absoluteFileUrl(requestUrl, file.id, file.timestamp) === libraryThumbnail);
        avatarThumbnail = avatarFile ? absoluteThumbnailUrl(requestUrl, avatarFile.id, 'avatar', thumbnailContentVersion(avatarFile)) : null;
        libraryThumbnail = libraryFile ? absoluteThumbnailUrl(requestUrl, libraryFile.id, 'library', thumbnailContentVersion(libraryFile)) : null;
    }
    return {
        format: 'char-info-gallery-pack',
        version: 1,
        ...identity,
        avatarThumbnail,
        libraryThumbnail,
        gallery,
    };
}

function isViewerMediaUrl(value, imageOnly = false) {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) return false;
        return /\.(png|jpe?g|gif|apng|webp|avif)$/iu.test(url.pathname)
            || (!imageOnly && /\.(mp4|webm)$/iu.test(url.pathname));
    } catch {
        return false;
    }
}

function orderGalleryFiles(files, mainFileId) {
    if (!mainFileId) return [...files];
    const index = files.findIndex(file => String(file.id) === mainFileId);
    if (index <= 0) return [...files];
    return [files[index], ...files.slice(0, index), ...files.slice(index + 1)];
}

function buildGalleryItem(file, visualConfig, requestUrl) {
    const id = String(file.id);
    const hidden = visualConfig?.viewerHiddenFileIds?.includes(id) || false;
    return {
        title: file.file_name || file.id,
        sources: [absoluteFileUrl(requestUrl, file.id, file.timestamp)],
        thumbnail: String(file.file_type || '').startsWith('image/')
            ? absoluteThumbnailUrl(requestUrl, file.id, 'gallery', thumbnailContentVersion(file))
            : null,
        ...(hidden ? { viewerVisible: false } : {}),
    };
}

function buildVisualPayload(config, fileById, requestUrl) {
    const fallbackImageUrl = firstImageUrl(fileById, requestUrl);
    const avatarUrl = imageUrlFor(config.avatarFileId, fileById, requestUrl) || fallbackImageUrl;
    return {
        entranceQuote: config.entranceQuote,
        raceColor: config.raceColor,
        tierColor: config.tierColor,
        avatarUrl,
        coverUrl: imageUrlFor(config.coverFileId, fileById, requestUrl) || avatarUrl,
        metadata: {
            author: config.metadata.author,
            version: config.metadata.version,
            author_note: config.metadata.author_note,
            sex: config.metadata.sex,
            race: config.metadata.race,
            story_sections: config.metadata.story_sections,
        },
    };
}

function firstImageUrl(fileById, requestUrl) {
    for (const file of fileById.values()) {
        if (String(file.file_type || '').startsWith('image/')) return absoluteFileUrl(requestUrl, file.id, file.timestamp);
    }
    return null;
}

function imageUrlFor(fileId, fileById, requestUrl) {
    if (!fileId) return null;
    const file = fileById.get(fileId);
    if (!file || !String(file.file_type || '').startsWith('image/')) return null;
    return absoluteFileUrl(requestUrl, file.id, file.timestamp);
}
