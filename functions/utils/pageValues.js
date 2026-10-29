function invalid(field, message) {
    const error = new Error(message);
    error.field = field;
    throw error;
}

export function normalizePageUrl(value, field) {
    if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u001f\u007f]/.test(value)) {
        invalid(field, '请填写有效的地址。');
    }
    const trimmed = value.trim();
    const relative = trimmed.startsWith('/') && !trimmed.startsWith('//');
    if (!relative && !/^https?:\/\//i.test(trimmed)) {
        invalid(field, '地址须以 http://、https:// 或单个 / 开头。');
    }
    try {
        const parsed = new URL(trimmed, 'https://page-settings.invalid');
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid URL');
        return relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
    } catch {
        invalid(field, '请填写有效的地址。');
    }
}

export function normalizePageValue(id, value) {
    const field = `pageValues.${id}`;
    if (value === '' || value === null || value === undefined || (typeof value === 'string' && !value.trim())) return '';
    if (['siteTitle', 'ownerName'].includes(id)) {
        if (typeof value !== 'string') invalid(field, '网站标题和名称须为文字。');
        return value.trim();
    }
    if (['siteIcon', 'logoUrl', 'logoLink'].includes(id)) return normalizePageUrl(value, field);
    if (id === 'urlPrefix') {
        const prefix = normalizePageUrl(value, field);
        if (/[?#]/.test(value)) invalid(field, '文件公开链接前缀不能包含查询参数或片段。');
        return prefix;
    }
    if (id === 'wallpaperEnabled') {
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === 'false') return value === 'true';
        invalid(field, '请选择是否启用工作区壁纸。');
    }
    if (['bkInterval', 'bkOpacity'].includes(id)) {
        const number = typeof value === 'string' ? Number(value.trim()) : value;
        const interval = id === 'bkInterval';
        const min = interval ? 1000 : 0;
        const max = interval ? 3600000 : 1;
        if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || (interval && !Number.isInteger(number))) {
            invalid(field, interval ? '工作区壁纸切换间隔须为 1000 至 3600000 毫秒之间的整数。' : '工作区壁纸不透明度须为 0 至 1 之间的数值。');
        }
        return number;
    }
    if (['uploadBkImg', 'adminBkImg'].includes(id)) {
        let images = value;
        const jsonString = typeof value === 'string' && value.trim().startsWith('[');
        if (jsonString) {
            try { images = JSON.parse(value); }
            catch { invalid(field, '多张壁纸须填写有效的图片地址 JSON 数组。'); }
        }
        if (Array.isArray(images)) {
            const normalized = images.map((url, index) => normalizePageUrl(url, `${field}.${index}`));
            return jsonString ? JSON.stringify(normalized) : normalized;
        }
        return normalizePageUrl(images, field);
    }
    return value;
}

export function validatePageValues(values, config) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) invalid('pageValues', '请提交需要修改的网站设置。');
    const allowedIds = new Set(config.map(item => item.id).filter(id => id !== 'welcomeWallpaper'));
    const normalized = {};
    for (const [id, value] of Object.entries(values)) {
        if (!allowedIds.has(id)) invalid(`pageValues.${id}`, '此操作包含不支持的网站设置。');
        normalized[id] = normalizePageValue(id, value);
    }
    return normalized;
}
