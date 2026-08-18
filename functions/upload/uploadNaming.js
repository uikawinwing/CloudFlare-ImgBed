// 所有用户上传都必须绑定 Discord owner，并使用稳定的 canonical file id。
export function isOwnedCanonicalFileId(discordIdentity, fullId) {
    const ownerId = String(discordIdentity?.id || '').trim();
    const id = String(fullId || '');
    if (!ownerId || !id.startsWith(`users/${ownerId}/`)) return false;

    const remainder = id.slice(`users/${ownerId}/`.length);
    return remainder.length > 0 && !remainder.includes('/');
}

export function resolveStorageFileName(context, fullId) {
    if (!isOwnedCanonicalFileId(context?.discordIdentity, fullId)) {
        throw new Error('Owned canonical file id is required');
    }

    return String(fullId).split('/').pop();
}

// canonical id 已经包含 owner namespace + UUID；所有底层 storage 都应复用同一个身份。
export function buildHuggingFaceFilePath(context, fullId) {
    resolveStorageFileName(context, fullId);
    return fullId;
}
