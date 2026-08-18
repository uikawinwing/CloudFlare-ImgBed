export const CHAR_INFO_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
export const MAX_CHAR_INFO_CHARACTER_NAME_LENGTH = 80;

function hasControlCharacter(value) {
    return Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
    });
}

export function normalizeCharInfoCharacterName(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized || null;
}

export function validateCharInfoCharacterName(value) {
    const characterName = normalizeCharInfoCharacterName(value);
    if (!characterName) return null;
    if (characterName.length > MAX_CHAR_INFO_CHARACTER_NAME_LENGTH) {
        return `CharInfo character name must not exceed ${MAX_CHAR_INFO_CHARACTER_NAME_LENGTH} characters`;
    }
    if (hasControlCharacter(characterName)) return 'CharInfo character name contains invalid control characters';
    return null;
}

export function requireCharInfoAlbumIdentity(album) {
    const characterName = normalizeCharInfoCharacterName(album?.char_info_character_name);
    const characterNameError = validateCharInfoCharacterName(characterName);
    if (characterNameError) throw new Error(characterNameError);
    if (!characterName) throw new Error('CharInfo character name is not configured for this album');

    const packId = String(album?.public_handle || '').trim().toLowerCase();
    const profileId = String(album?.id || '').trim().toLowerCase();
    if (!CHAR_INFO_ID_PATTERN.test(packId)) throw new Error('CharInfo pack ID is invalid');
    if (!CHAR_INFO_ID_PATTERN.test(profileId)) throw new Error('CharInfo profile ID is invalid');
    return { packId, profileId, characterName };
}
