export function legacyFileRestriction(metadata, whiteListMode = false) {
    if (metadata?.ListType === 'White') return null;
    if (metadata?.ListType === 'Block' || metadata?.Label === 'adult') return 'blocked';
    return whiteListMode ? 'whitelist' : null;
}
