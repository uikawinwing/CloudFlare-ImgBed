const SUPPORTED_STORAGE_CHANNELS = new Set(['telegram', 'cfr2', 's3', 'discord', 'huggingface', 'webdav']);

const configValue = (pageConfig, id, fallback = null) => {
    const setting = pageConfig?.config?.find(item => item?.id === id);
    const value = setting?.value ?? setting?.default;
    return value === '' || value === undefined || value === null ? fallback : value;
};

// 用户只能选择“上传什么”；存到哪个 backend 由管理员统一决定。
// External 伪上传不再是可用 storage target。
export function resolveUploadTarget(pageConfig) {
    const configuredChannel = String(configValue(pageConfig, 'defaultUploadChannel', 'telegram')).trim().toLowerCase();
    return {
        channel: SUPPORTED_STORAGE_CHANNELS.has(configuredChannel) ? configuredChannel : 'telegram',
        channelName: configValue(pageConfig, 'defaultChannelName'),
    };
}
