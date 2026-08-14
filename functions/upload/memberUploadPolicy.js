const configValue = (pageConfig, id, fallback = null) => {
    const setting = pageConfig?.config?.find(item => item?.id === id);
    const value = setting?.value ?? setting?.default;
    return value === '' || value === undefined || value === null ? fallback : value;
};

export function resolveUploadTarget(pageConfig, requestedChannel, requestedChannelName, discordIdentity) {
    if (!discordIdentity) {
        return {
            channel: requestedChannel,
            channelName: requestedChannelName || null,
        };
    }

    return {
        channel: configValue(pageConfig, 'defaultUploadChannel', 'telegram'),
        channelName: configValue(pageConfig, 'defaultChannelName'),
    };
}
