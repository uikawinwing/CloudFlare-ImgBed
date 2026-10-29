export function getDefaultWelcomeWallpaper() {
    return {
        enabled: true,
        intervalSeconds: 15,
        opacity: 1,
        items: [{
            url: '/welcome/wallpaper.jpg',
            positionX: 50,
            positionY: 50,
            mobilePositionX: 60,
            mobilePositionY: 0,
        }],
    };
}

function invalid(field, message) {
    const error = new Error(message);
    error.field = `welcomeWallpaper.${field}`;
    throw error;
}

function numberInRange(value, field, label, min, max, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        invalid(field, `${label}必须为 ${min} 至 ${max} 之间的${integer ? '整数' : '数值'}。`);
    }
    return value;
}

function imageUrl(value, field) {
    if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u001f\u007f]/.test(value)) {
        invalid(field, '请填写有效的图片地址。');
    }
    const trimmed = value.trim();
    const relative = trimmed.startsWith('/') && !trimmed.startsWith('//');
    if (!relative && !/^https?:\/\//i.test(trimmed)) {
        invalid(field, '图片地址须以 http://、https:// 或单个 / 开头。');
    }
    try {
        const parsed = new URL(trimmed, 'https://wallpaper.invalid');
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid URL');
        return relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
    } catch {
        invalid(field, '请填写有效的图片地址。');
    }
}

export function validateWelcomeWallpaper(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch { invalid('config', '欢迎页壁纸配置必须为有效的 JSON。'); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalid('config', '请填写完整的欢迎页壁纸配置。');
    }
    if (typeof value.enabled !== 'boolean') invalid('enabled', '请选择是否启用欢迎页壁纸。');
    if (!Array.isArray(value.items) || value.items.length > 20) invalid('items', '壁纸队列最多可包含 20 张图片。');

    const intervalSeconds = numberInRange(value.intervalSeconds, 'intervalSeconds', '切换间隔（秒）', 5, 3600, true);
    const opacity = numberInRange(value.opacity, 'opacity', '壁纸透明度', 0, 1);
    const defaults = getDefaultWelcomeWallpaper().items[0];
    const items = value.items.map((item, index) => {
        const field = `items.${index}`;
        if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(field, '队列中的每一项都必须为图片配置。');
        const normalized = { url: imageUrl(item.url, `${field}.url`) };
        for (const key of ['positionX', 'positionY', 'mobilePositionX', 'mobilePositionY']) {
            normalized[key] = numberInRange(item[key] === undefined ? defaults[key] : item[key], `${field}.${key}`, '壁纸裁切位置', 0, 100);
        }
        return normalized;
    });
    return { enabled: value.enabled, intervalSeconds, opacity, items };
}
