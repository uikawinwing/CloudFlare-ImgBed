import { getDatabase } from '../../../utils/databaseAdapter.js';
import { hashPassword, isHashed } from '../../../utils/auth/passwordHash.js';
import { destroySessionsByAuthType } from '../../../utils/auth/sessionManager.js';
import { normalizeSessionMaxAgeDays } from '../../../utils/auth/sessionConfig.js';
import { rejectCrossSiteMutation } from '../../../utils/auth/mutationSecurity.js';

const securityValueTypes = {
    'upload.moderate.enabled': 'boolean',
    'upload.moderate.channel': 'moderationChannel',
    'upload.moderate.moderateContentApiKey': 'string',
    'upload.moderate.nsfwApiPath': 'url',
    'upload.ipQuery.enabled': 'boolean',
    'upload.ipQuery.channel': 'ipChannel',
    'upload.ipQuery.customApi.url': 'url',
    'upload.ipQuery.customApi.params': 'params',
    'upload.ipQuery.customApi.responseFields': 'fields',
    'access.allowedDomains': 'string',
    'access.whiteListMode': 'boolean',
    'access.imageTransformEnabled': 'boolean',
    'access.imageTransformAllowedSizes': 'sizes',
};

function modernSecurityConfig(settings) {
    const { allowedDomains, whiteListMode, imageTransformEnabled, imageTransformAllowedSizes } = settings.access;
    return { upload: settings.upload, access: { allowedDomains, whiteListMode, imageTransformEnabled, imageTransformAllowedSizes } };
}

function normalizeSecurityValue(key, value) {
    const type = securityValueTypes[key];
    if (type === 'boolean') {
        if (typeof value !== 'boolean') throw new Error('请填写有效的开关值。');
        return value;
    }
    if (type === 'params') {
        if (!Array.isArray(value) || value.length > 50 || value.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['key', 'value'].includes(key)) || typeof item.key !== 'string' || typeof item.value !== 'string' || item.key.length > 256 || item.value.length > 4096)) throw new Error('查询参数须为有效的名称和值列表，最多 50 项。');
        return value;
    }
    if (type === 'fields') {
        if (!Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 256)) throw new Error('返回字段须为有效的字段路径列表，最多 50 项。');
        return value.map(item => item.trim());
    }
    if (typeof value !== 'string' || value.length > 8192) throw new Error('请填写有效的文本。');
    if (type === 'moderationChannel' && !['moderatecontent.com', 'nsfwjs'].includes(value)) throw new Error('请选择有效的图像审查渠道。');
    if (type === 'ipChannel' && value !== 'customApi') throw new Error('请选择有效的 IP 查询渠道。');
    if (type === 'url' && value !== '') {
        let url;
        try { url = new URL(value); } catch { throw new Error('接口地址须以 http:// 或 https:// 开头。'); }
        if (!/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\\\u0000-\u001f\u007f]/.test(value)) throw new Error('接口地址须以 http:// 或 https:// 开头，不能包含登录凭据。');
    }
    if (type === 'sizes') {
        const result = normalizeImageTransformAllowedSizes(value);
        if (result.error) throw new Error(result.error);
        return result.value;
    }
    return value;
}

export async function onRequest(context) {
    // 安全设置相关，GET方法读取设置，POST方法保存设置
    const {
      request, // same as existing Worker API
      env, // same as existing Worker API
      params, // if filename includes [id] or [[path]]
      waitUntil, // same as ctx.waitUntil in existing Worker API
      next, // used for middleware or to fetch assets
      data, // arbitrary space for passing data between middlewares
    } = context;

    const db = getDatabase(env);

    // GET读取设置
    if (request.method === 'GET') {
        const settings = await getSecurityConfig(db, env)

        if (new URL(request.url).searchParams.get('view') === 'modern') {
            return Response.json(modernSecurityConfig(settings), { headers: { 'Cache-Control': 'private, no-store' } });
        }

        // 对前端隐藏实际密码值，返回占位符
        // 前端只有在用户修改密码时才会发送新密码
        const maskedSettings = JSON.parse(JSON.stringify(settings));
        if (maskedSettings.auth.user?.authCode) {
            maskedSettings.auth.user._hasPassword = true;
            maskedSettings.auth.user.authCode = ''; // 不向前端暴露密码/哈希
        }
        if (maskedSettings.auth.admin?.adminPassword) {
            maskedSettings.auth.admin._hasPassword = true;
            maskedSettings.auth.admin.adminPassword = ''; // 不向前端暴露密码/哈希
        }

        return new Response(JSON.stringify(maskedSettings), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    if (request.method === 'PATCH') {
        const rejected = rejectCrossSiteMutation(request);
        if (rejected) return rejected;
        let body;
        try { body = await request.json(); }
        catch { return Response.json({ error: '设置格式无效。' }, { status: 400 }); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'securityValues') || !body.securityValues || typeof body.securityValues !== 'object' || Array.isArray(body.securityValues) || !Object.keys(body.securityValues).length) {
            return Response.json({ error: '请仅提交需要修改的安全设置。' }, { status: 400 });
        }
        const values = {};
        for (const [key, value] of Object.entries(body.securityValues)) {
            try {
                if (!Object.hasOwn(securityValueTypes, key)) throw new Error('此设置不属于新版安全设置。');
                values[key] = normalizeSecurityValue(key, value);
            } catch (error) {
                return Response.json({ error: error.message, field: `securityValues.${key}` }, { status: 400 });
            }
        }
        const settings = JSON.parse(await db.get('manage@sysConfig@security') || '{}');
        for (const [key, value] of Object.entries(values)) {
            const path = key.split('.');
            let target = settings;
            for (const part of path.slice(0, -1)) {
                if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
                target = target[part];
            }
            target[path.at(-1)] = value;
        }
        await db.put('manage@sysConfig@security', JSON.stringify(settings));
        return Response.json(modernSecurityConfig(await getSecurityConfig(db, env)), { headers: { 'Cache-Control': 'private, no-store' } });
    }

    // POST保存设置
    if (request.method === 'POST') {
        const settings = await getSecurityConfig(db, env) // 先读取已有设置，再进行覆盖

        const body = await request.json()
        const newSettings = body

        // 覆盖设置，apiTokens不在这里修改
        settings.upload = newSettings.upload || settings.upload
        settings.access = newSettings.access || settings.access
        settings.access.userSessionMaxAge = normalizeSessionMaxAgeDays(settings.access.userSessionMaxAge)
        settings.access.adminSessionMaxAge = normalizeSessionMaxAgeDays(settings.access.adminSessionMaxAge)
        settings.access.imageTransformEnabled = settings.access.imageTransformEnabled === true

        const allowedSizes = normalizeImageTransformAllowedSizes(settings.access.imageTransformAllowedSizes)
        if (allowedSizes.error) {
            return new Response(JSON.stringify({ error: allowedSizes.error }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
            })
        }
        settings.access.imageTransformAllowedSizes = allowedSizes.value

        // 处理认证设置：空密码表示不修改，_clear 标记表示清除密码
        let userPasswordChanged = false;
        let adminPasswordChanged = false;

        if (newSettings.auth) {
            if (newSettings.auth.user) {
                if (newSettings.auth.user._clear) {
                    // 显式清除密码
                    newSettings.auth.user.authCode = '';
                    userPasswordChanged = true;
                } else if (newSettings.auth.user.authCode === '' || newSettings.auth.user.authCode === undefined) {
                    // 密码为空，保留原密码
                    newSettings.auth.user.authCode = settings.auth.user.authCode;
                } else {
                    userPasswordChanged = true;
                }
                delete newSettings.auth.user._clear;
                settings.auth.user = newSettings.auth.user;
            }
            if (newSettings.auth.admin) {
                if (newSettings.auth.admin._clear) {
                    // 显式清除密码和用户名
                    newSettings.auth.admin.adminPassword = '';
                    newSettings.auth.admin.adminUsername = '';
                    adminPasswordChanged = true;
                } else if (newSettings.auth.admin.adminPassword === '' || newSettings.auth.admin.adminPassword === undefined) {
                    // 密码为空，保留原密码
                    newSettings.auth.admin.adminPassword = settings.auth.admin.adminPassword;
                } else {
                    adminPasswordChanged = true;
                }
                delete newSettings.auth.admin._clear;
                if (newSettings.auth.admin.adminUsername !== undefined) {
                    settings.auth.admin.adminUsername = newSettings.auth.admin.adminUsername;
                }
                settings.auth.admin.adminPassword = newSettings.auth.admin.adminPassword;
            }
        }

        // 对密码进行哈希处理（如果是新的明文密码）
        if (settings.auth.user?.authCode && !isHashed(settings.auth.user.authCode)) {
            settings.auth.user.authCode = await hashPassword(settings.auth.user.authCode);
        }
        if (settings.auth.admin?.adminPassword && !isHashed(settings.auth.admin.adminPassword)) {
            settings.auth.admin.adminPassword = await hashPassword(settings.auth.admin.adminPassword);
        }

        // 清理前端标记字段
        delete settings.auth.user?._hasPassword;
        delete settings.auth.admin?._hasPassword;

        // 写入数据库
        await db.put('manage@sysConfig@security', JSON.stringify(settings))

        // 密码变更后清除对应类型的所有会话
        if (userPasswordChanged) {
            await destroySessionsByAuthType(env, 'user');
        }
        if (adminPasswordChanged) {
            await destroySessionsByAuthType(env, 'admin');
        }

        return new Response(JSON.stringify({
            message: 'security settings saved',
            userPasswordChanged,
            adminPasswordChanged,
        }), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

}

export async function getSecurityConfig(db, env) {
    const settings = {}
    // 读取数据库中的设置
    const settingsStr = await db.get('manage@sysConfig@security')
    const settingsKV = settingsStr ? JSON.parse(settingsStr) : {}

    // 认证管理
    const kvAuth = settingsKV.auth || {}
    const auth = {
        user: {
            authCode: kvAuth.user?.authCode ?? env.AUTH_CODE ?? '',
        },
        admin: {
            adminUsername: kvAuth.admin?.adminUsername ?? env.BASIC_USER ?? '',
            adminPassword: kvAuth.admin?.adminPassword ?? env.BASIC_PASS ?? '',
        }
    }
    settings.auth = auth

    // 上传管理
    const kvUpload = settingsKV.upload || {}
    const upload = {
        moderate: {
            enabled: kvUpload.moderate?.enabled ?? false,
            channel: kvUpload.moderate?.channel || 'moderatecontent.com', // [moderatecontent.com, nsfwjs]
            moderateContentApiKey: kvUpload.moderate?.moderateContentApiKey || kvUpload.moderate?.apiKey || env.ModerateContentApiKey || '',
            nsfwApiPath: kvUpload.moderate?.nsfwApiPath || '',
        },
        ipQuery: {
            enabled: kvUpload.ipQuery?.enabled ?? false,
            channel: kvUpload.ipQuery?.channel || 'customApi',
            customApi: {
                url: kvUpload.ipQuery?.customApi?.url || '',
                params: normalizeIpQueryParams(kvUpload.ipQuery?.customApi?.params),
                responseFields: normalizeIpQueryResponseFields(kvUpload.ipQuery?.customApi?.responseFields)
            }
        }
    }
    settings.upload = upload

    // 访问管理
    const kvAccess = settingsKV.access || {}
    const access = {
        allowedDomains: kvAccess.allowedDomains || env.ALLOWED_DOMAINS || '',
        whiteListMode: kvAccess.whiteListMode ?? env.WhiteList_Mode === 'true',
        imageTransformEnabled: kvAccess.imageTransformEnabled === true,
        imageTransformAllowedSizes: normalizeImageTransformAllowedSizes(kvAccess.imageTransformAllowedSizes).value,
        // 新增会话安全策略字段
        sessionSecure: kvAccess.sessionSecure ?? false,
        userSessionMaxAge: normalizeSessionMaxAgeDays(kvAccess.userSessionMaxAge ?? 14),
        adminSessionMaxAge: normalizeSessionMaxAgeDays(kvAccess.adminSessionMaxAge ?? 14),
    }
    settings.access = access

    // API Token 管理
    const kvApiTokens = settingsKV.apiTokens || {}
    const apiTokens = {
        tokens: kvApiTokens.tokens || {}
    }
    settings.apiTokens = apiTokens

    return settings;
}

function normalizeImageTransformAllowedSizes(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return { value: '' }
    }

    const sizes = String(value)
        .split(',')
        .map(size => size.trim().toLowerCase())
        .filter(Boolean)
    const normalized = []

    for (const size of sizes) {
        const match = size.match(/^(auto|[1-9]\d*)x(auto|[1-9]\d*)$/)
        if (!match || (match[1] === 'auto' && match[2] === 'auto')) {
            return { error: `Invalid image transform size: ${size}` }
        }

        for (const dimension of match.slice(1)) {
            if (dimension !== 'auto' && Number(dimension) > 4096) {
                return { error: `Invalid image transform size: ${size}` }
            }
        }

        if (!normalized.includes(size)) normalized.push(size)
    }

    return { value: normalized.join(',') }
}

function normalizeIpQueryParams(params) {
    if (!Array.isArray(params)) {
        return [{ key: 'ip', value: '{ip}' }];
    }

    return params.map(param => ({
        key: param?.key || '',
        value: param?.value || ''
    }));
}

function normalizeIpQueryResponseFields(fields) {
    if (!Array.isArray(fields)) {
        return [];
    }

    return fields.map(field => {
        if (typeof field === 'string') return field;
        return field?.path || '';
    });
}
