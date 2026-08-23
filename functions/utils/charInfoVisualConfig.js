const HEX_PATTERN = /^#[0-9A-F]{6}$/;
const MAX_FILE_ID_LENGTH = 512;
const MAX_STORY_SECTIONS = 32;

function cleanText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
}

function cleanFileId(value) {
    const id = cleanText(value, MAX_FILE_ID_LENGTH);
    return id || null;
}

function cleanColor(value) {
    const color = cleanText(value, 7).toUpperCase();
    return color && HEX_PATTERN.test(color) ? color : '';
}

function cleanStorySections(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_STORY_SECTIONS).reduce((sections, section) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return sections;
        const title = cleanText(section.title, 120);
        const content = cleanText(section.content, 12000);
        if (!title && !content) return sections;
        sections.push({ title, content });
        return sections;
    }, []);
}

function cleanMetadata(value) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        author: cleanText(raw.author, 120),
        version: cleanText(raw.version, 80),
        author_note: cleanText(raw.author_note ?? raw.authorNote, 4000),
        sex: cleanText(raw.sex, 80),
        race: cleanText(raw.race, 120),
        story_sections: cleanStorySections(raw.story_sections ?? raw.storySections),
    };
}

export function emptyCharInfoVisualConfig() {
    return {
        version: 1,
        entranceQuote: '',
        raceColor: '',
        tierColor: '',
        mainFileId: null,
        avatarFileId: null,
        coverFileId: null,
        viewerHiddenFileIds: [],
        metadata: cleanMetadata(null),
    };
}

export function normalizeCharInfoVisualConfig(value) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const hidden = Array.isArray(raw.viewerHiddenFileIds) ? raw.viewerHiddenFileIds : [];
    const viewerHiddenFileIds = [...new Set(hidden.map(cleanFileId).filter(Boolean))].slice(0, 500);
    return {
        version: 1,
        entranceQuote: cleanText(raw.entranceQuote, 4000),
        raceColor: cleanColor(raw.raceColor),
        tierColor: cleanColor(raw.tierColor),
        mainFileId: cleanFileId(raw.mainFileId),
        avatarFileId: cleanFileId(raw.avatarFileId),
        coverFileId: cleanFileId(raw.coverFileId),
        viewerHiddenFileIds,
        metadata: cleanMetadata(raw.metadata),
    };
}

export function validateCharInfoVisualConfig(value) {
    const config = normalizeCharInfoVisualConfig(value);
    const errors = [];
    if (value?.raceColor && !config.raceColor) errors.push('Race color must use #RRGGBB');
    if (value?.tierColor && !config.tierColor) errors.push('Tier color must use #RRGGBB');
    config.metadata.story_sections.forEach((section, index) => {
        if (!section.title || !section.content) errors.push(`Story section ${index + 1} requires both title and content`);
    });
    if (config.mainFileId && config.viewerHiddenFileIds.includes(config.mainFileId)) {
        errors.push('Main portrait cannot be hidden from Viewer');
    }
    return { config, errors };
}

export function parseStoredCharInfoVisualConfig(value) {
    if (typeof value !== 'string' || !value.trim()) return emptyCharInfoVisualConfig();
    try {
        return normalizeCharInfoVisualConfig(JSON.parse(value));
    } catch {
        return emptyCharInfoVisualConfig();
    }
}

export function charInfoVisualStorageKey(albumId) {
    return `charinfo.visual:${String(albumId || '').trim()}`;
}
