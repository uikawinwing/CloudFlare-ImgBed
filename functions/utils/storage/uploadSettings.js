import { findConfiguredChannel } from '../metadata/channelConfig.js';

const GROUPS = {
    telegram: { type: 'telegram', channelTypes: ['Telegram', 'TelegramNew'], required: ['botToken', 'chatId'], mutable: ['enabled', 'proxyUrl'], target: 'chatId', fixed: env => env.TG_BOT_TOKEN ? { id: 1, name: 'Telegram_env', type: 'telegram', savePath: 'environment variable', botToken: env.TG_BOT_TOKEN, chatId: env.TG_CHAT_ID, proxyUrl: env.TG_PROXY_URL || '', enabled: true, fixed: true } : null },
    cfr2: { type: 'cfr2', channelTypes: ['CloudflareR2'], required: [], mutable: ['enabled', 'publicUrl', 'quota'], fixed: env => env.img_r2 ? { id: 1, name: 'R2_env', type: 'cfr2', savePath: 'environment variable', publicUrl: env.R2PublicUrl, enabled: true, fixed: true } : null },
    discord: { type: 'discord', channelTypes: ['Discord'], required: ['botToken', 'channelId'], mutable: ['enabled', 'proxyUrl'], target: 'channelId', fixed: env => env.DISCORD_BOT_TOKEN ? { id: 1, name: 'Discord_env', type: 'discord', savePath: 'environment variable', botToken: env.DISCORD_BOT_TOKEN, channelId: env.DISCORD_CHANNEL_ID, proxyUrl: env.DISCORD_PROXY_URL || '', enabled: true, fixed: true } : null },
    huggingface: { type: 'huggingface', channelTypes: ['HuggingFace'], required: ['token', 'repo'], mutable: ['enabled', 'isPrivate'], target: 'repo', fixed: env => env.HF_TOKEN ? { id: 1, name: 'HuggingFace_env', type: 'huggingface', savePath: 'environment variable', token: env.HF_TOKEN, repo: env.HF_REPO, isPrivate: env.HF_PRIVATE === 'true', enabled: true, fixed: true } : null },
};

function copyLoadBalance(value) {
    return { enabled: value?.enabled === true, channels: Array.isArray(value?.channels) ? value.channels : [] };
}

function normalizeStoredGroup(value) {
    return { channels: Array.isArray(value?.channels) ? value.channels : [], loadBalance: copyLoadBalance(value?.loadBalance) };
}

function copyPersistedFixed(channel, group) {
    const saved = {};
    for (const key of ['id', 'name', 'type', 'savePath', ...group.mutable]) if (channel?.[key] !== undefined) saved[key] = channel[key];
    return saved;
}

function fixedChannel(group, env, persisted, exposeSecrets) {
    const runtime = group.fixed(env);
    if (!runtime) return null;
    const saved = persisted.channels.find(channel => channel?.savePath === 'environment variable');
    const channel = { ...runtime };
    for (const field of group.mutable) if (saved?.[field] !== undefined) channel[field] = saved[field];
    if (!exposeSecrets) for (const field of ['botToken', 'chatId', 'channelId', 'token', 'repo']) delete channel[field];
    return channel;
}

export function getUploadSettings(stored, env, { exposeSecrets = true } = {}) {
    const result = {};
    for (const [name, group] of Object.entries(GROUPS)) {
        const persisted = normalizeStoredGroup(stored?.[name]);
        const fixed = fixedChannel(group, env, persisted, exposeSecrets);
        const configured = persisted.channels.filter(channel => channel?.savePath !== 'environment variable')
            .map((channel, index) => ({ ...channel, id: index + (fixed ? 2 : 1), type: group.type, fixed: false }));
        result[name] = { channels: fixed ? [fixed, ...configured] : configured, loadBalance: copyLoadBalance(persisted.loadBalance) };
    }
    return result;
}

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function normalizeQuota(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean') throw new Error('R2 容量设置必须包含启用开关、GB 上限和阈值百分比');
    const limitGB = Number(value.limitGB);
    const threshold = Number(value.threshold);
    if (!Number.isFinite(limitGB) || limitGB <= 0) throw new Error('R2 容量上限必须大于 0 GB');
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) throw new Error('R2 容量阈值必须大于 0 且不超过 100%');
    return { enabled: value.enabled, limitGB, threshold };
}

function normalizeProxy(value) {
    if (value === undefined || value === '') return value;
    if (typeof value !== 'string') throw new Error('代理地址格式无效');
    const proxy = value.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    let parsed;
    try { parsed = new URL(`https://${proxy}`); } catch { throw new Error('代理地址格式无效'); }
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('代理地址只能包含域名和路径');
    return proxy;
}

function normalizePublicUrl(value) {
    if (value === undefined || value === '') return value;
    if (typeof value !== 'string') throw new Error('R2 公开访问地址格式无效');
    let url;
    try { url = new URL(value.trim()); } catch { throw new Error('R2 公开访问地址必须以 http:// 或 https:// 开头'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('R2 公开访问地址必须是 HTTP 或 HTTPS 地址，且不包含凭据');
    return value.trim();
}

function normalizeConfiguredChannel(value, groupName, group, index, currentChannels, env) {
    if (!value || typeof value !== 'object') throw new Error(`${groupName} 渠道格式无效`);
    if (!nonEmptyString(value.name)) throw new Error(`${groupName} 渠道名称不能为空`);
    if (typeof value.enabled !== 'boolean') throw new Error(`${groupName} 渠道的启用状态必须是布尔值`);
    const previous = currentChannels.find(channel => channel.name === value.name.trim() && channel.savePath !== 'environment variable');
    const allowedFields = groupName === 'telegram' ? ['botToken', 'chatId', 'proxyUrl']
        : groupName === 'discord' ? ['botToken', 'channelId', 'proxyUrl']
            : groupName === 'huggingface' ? ['token', 'repo', 'isPrivate']
                : ['publicUrl', 'quota'];
    const channel = { id: Number.isInteger(value.id) && value.id > 0 ? value.id : index + 1, name: value.name.trim(), type: group.type, fixed: false, enabled: value.enabled };
    for (const field of allowedFields) if (value[field] !== undefined) channel[field] = value[field];
    for (const field of group.required) if (channel[field] !== undefined && typeof channel[field] !== 'string') throw new Error(`${groupName} 渠道凭据格式无效`);
    if (channel.isPrivate !== undefined && typeof channel.isPrivate !== 'boolean') throw new Error('Hugging Face 私有仓库设置必须是布尔值');
    if (groupName === 'telegram' || groupName === 'discord') channel.proxyUrl = normalizeProxy(channel.proxyUrl);
    if (groupName === 'cfr2') {
        if (channel.enabled && !env.img_r2) throw new Error('R2 渠道需要配置 Workers R2 绑定');
        channel.publicUrl = normalizePublicUrl(channel.publicUrl);
        const quota = normalizeQuota(channel.quota);
        if (quota === undefined) delete channel.quota;
        else channel.quota = quota;
    }
    if (channel.enabled === false && previous) {
        for (const field of group.required) if (!nonEmptyString(channel[field]) && previous[field] !== undefined) channel[field] = previous[field];
    }
    if (channel.enabled) for (const field of group.required) if (!nonEmptyString(channel[field])) throw new Error(`${groupName} 已启用渠道缺少必要凭据`);
    return channel;
}

function persistFixedChannel(submitted, current, group, env) {
    const previous = current.channels.find(channel => channel?.savePath === 'environment variable');
    const supplied = submitted.find(channel => channel?.savePath === 'environment variable');
    const runtime = group.fixed(env);
    const source = supplied && typeof supplied === 'object' ? supplied : previous || runtime;
    const identity = runtime || previous;
    if (!source || !identity) return null;
    const channel = copyPersistedFixed(identity, group);
    for (const field of group.mutable) if (source[field] !== undefined) channel[field] = source[field];
    if (typeof channel.enabled !== 'boolean') throw new Error('环境渠道的启用状态必须是布尔值');
    if (group.type === 'telegram' || group.type === 'discord') channel.proxyUrl = normalizeProxy(channel.proxyUrl);
    if (group.type === 'cfr2') {
        channel.publicUrl = normalizePublicUrl(channel.publicUrl);
        channel.quota = normalizeQuota(channel.quota);
    }
    if (channel.isPrivate !== undefined && typeof channel.isPrivate !== 'boolean') throw new Error('Hugging Face 私有仓库设置必须是布尔值');
    return { ...channel, type: group.type, savePath: 'environment variable' };
}

async function hasReferencedFiles(d1, groupName, group, channel, uploadConfig) {
    const name = channel.name;
    if (!d1 || !name) return false;
    const placeholders = group.channelTypes.map(() => '?').join(', ');
    const { results } = await d1.prepare(`SELECT 1 FROM files
        WHERE (channel IN (${placeholders}) OR json_extract(metadata, '$.Channel') IN (${placeholders}))
          AND COALESCE(NULLIF(channel_name, ''), json_extract(metadata, '$.ChannelName')) = ?
        LIMIT 1`).bind(...group.channelTypes, ...group.channelTypes, name).all();
    if (results.length > 0) return true;
    const identityField = { telegram: 'TgChatId', discord: 'DiscordChannelId', huggingface: 'HfRepo' }[groupName];
    if (!identityField || !channel[group.target]) return false;
    const candidates = await d1.prepare(`SELECT metadata FROM files
        WHERE (channel IN (${placeholders}) OR json_extract(metadata, '$.Channel') IN (${placeholders}))
          AND TRIM(CAST(json_extract(metadata, '$.${identityField}') AS TEXT)) = ?`)
        .bind(...group.channelTypes, ...group.channelTypes, String(channel[group.target]).trim()).all();
    return candidates.results.some(row => findConfiguredChannel(uploadConfig, groupName, JSON.parse(row.metadata || '{}'))?.name === name);
}

async function assertReferencedChannelsRemain(d1, previous, next) {
    for (const [groupName, group] of Object.entries(GROUPS)) {
        const oldChannels = normalizeStoredGroup(previous?.[groupName]).channels.filter(channel => channel?.savePath !== 'environment variable');
        const newChannels = next[groupName].channels.filter(channel => channel?.savePath !== 'environment variable');
        for (const oldChannel of oldChannels) {
            const replacement = newChannels.find(channel => channel.name === oldChannel.name);
            const targetChanged = replacement && group.target && oldChannel[group.target] !== replacement[group.target];
            if ((!replacement || targetChanged) && await hasReferencedFiles(d1, groupName, group, oldChannel, previous)) {
                const error = new Error('已有文件仍引用该渠道，请停用并保留凭据');
                error.status = 409;
                error.hint = '如需使用新位置，请新增渠道';
                throw error;
            }
        }
    }
}

export async function saveUploadSettings(body, previous, env) {
    const next = {};
    for (const [groupName, group] of Object.entries(GROUPS)) {
        if (body?.[groupName] === undefined) {
            next[groupName] = normalizeStoredGroup(previous?.[groupName]);
            continue;
        }
        const submitted = body[groupName];
        if (!submitted || typeof submitted !== 'object' || !Array.isArray(submitted.channels)) throw new Error(`${groupName} 设置必须包含渠道数组`);
        if (!submitted.loadBalance || typeof submitted.loadBalance.enabled !== 'boolean') throw new Error(`${groupName} 设置必须包含负载均衡开关`);
        const current = normalizeStoredGroup(previous?.[groupName]);
        const names = new Set();
        const channels = [];
        const fixed = persistFixedChannel(submitted.channels, current, group, env);
        if (fixed) {
            channels.push(fixed);
            if (fixed.name) names.add(fixed.name);
        }
        for (const value of submitted.channels) {
            if (value?.savePath === 'environment variable') continue;
            const channel = normalizeConfiguredChannel(value, groupName, group, channels.length + 1, current.channels, env);
            if (names.has(channel.name)) throw new Error(`${groupName} 渠道名称不能重复`);
            names.add(channel.name);
            channels.push(channel);
        }
        next[groupName] = { channels, loadBalance: { enabled: submitted.loadBalance.enabled, channels: copyLoadBalance(current.loadBalance).channels } };
    }
    await assertReferencedChannelsRemain(env.img_d1, previous, next);
    return next;
}
