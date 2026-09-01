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
        visual: visualConfig ? buildVisualPayload(visualConfig, fileById, requestUrl) : null,
        gallery: orderedFiles.map(file => buildGalleryItem(file, visualConfig, requestUrl)),
    };
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
