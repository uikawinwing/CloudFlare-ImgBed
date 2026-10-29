import { getDatabase } from '../../../utils/databaseAdapter.js';
import { rejectCrossSiteMutation } from '../../../utils/auth/mutationSecurity.js';
import { getDefaultWelcomeWallpaper, validateWelcomeWallpaper } from '../../../utils/welcomeWallpaper.js';
import { normalizePageValue, validatePageValues } from '../../../utils/pageValues.js';

export async function onRequest(context) {
    // 页面设置相关，GET方法读取设置，POST方法保存设置
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
        const settings = await getPageConfig(db, env)

        return new Response(JSON.stringify(settings), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

    if (request.method === 'PATCH') {
        const rejected = rejectCrossSiteMutation(request);
        if (rejected) return rejected;
        let body;
        try {
            body = await request.json();
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || (!Object.hasOwn(body, 'welcomeWallpaper') && !Object.hasOwn(body, 'pageValues'))) {
                return new Response(JSON.stringify({ error: '请仅提交壁纸配置或需要修改的网站设置。' }), { status: 400, headers: { 'content-type': 'application/json' } });
            }
        } catch (error) {
            return settingsError(error);
        }
        const previousSettings = await getPageConfig(db, env);
        let values;
        try {
            values = Object.hasOwn(body, 'welcomeWallpaper')
                ? { welcomeWallpaper: validateWelcomeWallpaper(body.welcomeWallpaper) }
                : validatePageValues(body.pageValues, previousSettings.config);
        } catch (error) {
            return settingsError(error);
        }
        const settings = JSON.parse(await db.get('manage@sysConfig@page') || '{}');
        const config = Array.isArray(settings.config) ? settings.config : [];
        for (const [id, value] of Object.entries(values)) {
            const item = config.find(item => item?.id === id);
            if (item) item.value = value;
            else config.push({ id, value });
        }
        settings.config = config;
        if (Object.hasOwn(values, 'announcement')) processAnnouncementInfo(settings, previousSettings);
        await db.put('manage@sysConfig@page', JSON.stringify(settings));
        return new Response(JSON.stringify(await getPageConfig(db, env)), { headers: { 'content-type': 'application/json' } });
    }

    // POST保存设置
    if (request.method === 'POST') {
        const rejected = rejectCrossSiteMutation(request);
        if (rejected) return rejected;
        let body;
        try {
            body = await request.json();
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid settings');
        } catch (error) {
            return settingsError(error);
        }
        const previousSettings = await getPageConfig(db, env)
        try {
            for (const item of Array.isArray(body?.config) ? body.config : []) {
                if (item?.id === 'welcomeWallpaper') item.value = validateWelcomeWallpaper(item.value);
                else if (previousSettings.config.some(setting => setting.id === item?.id)) {
                    const previous = previousSettings.config.find(setting => setting.id === item.id)?.value;
                    if (JSON.stringify(item.value) !== JSON.stringify(previous)) item.value = normalizePageValue(item.id, item.value);
                }
            }
        } catch (error) {
            return settingsError(error);
        }
        const settings = processAnnouncementInfo(body, previousSettings)

        // 写入数据库
        await db.put('manage@sysConfig@page', JSON.stringify(settings))

        return new Response(JSON.stringify(await getPageConfig(db, env)), {
            headers: {
                'content-type': 'application/json',
            },
        })
    }

}

function settingsError(error) {
    return new Response(JSON.stringify({ error: error.field ? error.message : '请提交有效的 JSON 配置。', ...(error.field ? { field: error.field } : {}) }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
    });
}

export async function getPageConfig(db, env) {
    const settings = {}
    // 读取数据库中的设置
    const settingsStr = await db.get('manage@sysConfig@page')
    const settingsKV = settingsStr ? JSON.parse(settingsStr) : {}

    if (Number.isFinite(Number(settingsKV.announcementRefreshAt))) {
        settings.announcementRefreshAt = Number(settingsKV.announcementRefreshAt)
    }

    const config = []
    settings.config = config
    config.push(
        // 全局设置
        {
            id: 'siteTitle',
            label: '网页标题',
            label_en: 'Site Title',
            placeholder: 'Charatopia',
            tooltip: '用于浏览器标签页的站点标题，留空使用 Charatopia。',
            tooltip_en: 'Site title shown in browser tabs. Leave empty to use Charatopia.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'siteIcon',
            label: '网站图标',
            label_en: 'Site Icon',
            tooltip: '浏览器标签页图标地址，留空使用默认图标。',
            tooltip_en: 'Browser tab icon URL. Leave empty to use the default icon.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'ownerName',
            label: '站点名称',
            label_en: 'Site Name',
            placeholder: 'Charatopia',
            tooltip: '欢迎页、Discover 和工作区显示的站点名称。',
            tooltip_en: 'Site name shown on the welcome page, Discover, and workspace.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'logoUrl',
            label: '站点标志图片',
            label_en: 'Site Logo',
            tooltip: '页头标志图片地址，留空使用默认文字标志。',
            tooltip_en: 'Header logo image URL. Leave empty to use the default letter mark.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'logoLink',
            label: '站点标志跳转链接',
            label_en: 'Logo Link',
            placeholder: '/',
            tooltip: '点击页头标志时跳转的地址，留空返回站点首页。',
            tooltip_en: 'Destination when clicking the header logo. Leave empty to return home.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'bkInterval',
            label: '工作区壁纸切换间隔',
            label_en: 'Workspace Wallpaper Interval',
            placeholder: '3000',
            value: 3000,
            tooltip: '单位为毫秒，范围 1000–3600000，默认 3000；两张及以上壁纸按顺序轮播。',
            tooltip_en: 'Milliseconds, from 1000 to 3600000. Defaults to 3000; two or more wallpapers rotate in order.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'bkOpacity',
            label: '工作区壁纸不透明度',
            label_en: 'Workspace Wallpaper Opacity',
            placeholder: '1',
            value: 1,
            tooltip: '范围为 0–1，0 为完全透明，1 为完全不透明。',
            tooltip_en: 'From 0 to 1: 0 is fully transparent and 1 is fully opaque.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'wallpaperEnabled',
            label: '启用工作区壁纸',
            label_en: 'Enable Workspace Wallpaper',
            type: 'boolean',
            default: true,
            tooltip: '控制文件、图库和管理工作区的壁纸；不影响欢迎页独立的壁纸队列。',
            tooltip_en: 'Controls wallpaper in file, album, and management workspaces, independently of the welcome wallpaper queue.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        {
            id: 'urlPrefix',
            label: '默认URL前缀',
            label_en: 'Default URL Prefix',
            tooltip: '文件公开链接的前缀，例如 https://img.example/file/；留空使用当前站点。',
            tooltip_en: 'Prefix for public file links, for example https://img.example/file/. Leave empty to use the current site.',
            category: '全局设置',
            category_en: 'Global Settings',
        },
        // 客户端设置
        {
            id: 'announcement',
            label: '公告',
            label_en: 'Announcement',
            type: 'textarea',
            tooltip: '支持HTML标签',
            tooltip_en: 'Supports HTML tags',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'showDirectorySuggestions',
            label: '目录候选项',
            label_en: 'Directory Suggestions',
            type: 'boolean',
            default: true,
            tooltip: '控制上传页面是否展示目录树选择器',
            tooltip_en: 'Show directory tree picker on upload page',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultUploadChannel',
            label: '默认渠道类型',
            label_en: 'Default Channel Type',
            type: 'select',
            options: [
                { label: 'Telegram', value: 'telegram' },
                { label: 'Cloudflare R2', value: 'cfr2' },
                { label: 'Discord', value: 'discord' },
            ],
            placeholder: 'telegram',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultChannelName',
            label: '默认渠道名称',
            label_en: 'Default Channel Name',
            type: 'channelName',
            tooltip: '指定默认使用的渠道名称，需先选择上传渠道',
            tooltip_en: 'Specify default channel name. Select upload channel first',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultUploadFolder',
            label: '默认上传目录',
            label_en: 'Default Upload Directory',
            placeholder: '/ 开头的合法目录，不能包含特殊字符， 默认为根目录',
            placeholder_en: 'Valid path starting with /, no special chars. Default: root',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultUploadNameType',
            label: '默认命名方式',
            label_en: 'Default Naming',
            type: 'select',
            options: [
                { label: '默认', value: 'default', label_en: 'Default' },
                { label: '仅前缀', value: 'index', label_en: 'Prefix Only' },
                { label: '仅原名', value: 'origin', label_en: 'Original Name' },
                { label: '短链接', value: 'short', label_en: 'Short Link' },
            ],
            placeholder: 'default',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultConvertToWebp',
            label: '默认转换WebP',
            label_en: 'Default Convert to WebP',
            type: 'boolean',
            default: false,
            tooltip: '上传前将图片转换为WebP格式，可有效减小文件体积',
            tooltip_en: 'Convert images to WebP before upload to reduce file size',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultCustomerCompress',
            label: '默认开启压缩',
            label_en: 'Default Compression',
            type: 'boolean',
            default: true,
            tooltip: '上传前在本地进行压缩，仅对图片文件生效',
            tooltip_en: 'Compress locally before upload, only for images',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultCompressBar',
            label: '默认压缩阈值',
            label_en: 'Default Compress Threshold',
            placeholder: '5',
            tooltip: '图片大小超过此值将自动压缩，单位MB，范围1-20',
            tooltip_en: 'Auto-compress when image exceeds this size (MB), range 1-20',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultCompressQuality',
            label: '默认压缩期望',
            label_en: 'Default Compress Target',
            placeholder: '4',
            tooltip: '压缩后图片大小期望值，单位MB，范围0.5-压缩阈值',
            tooltip_en: 'Target image size after compression (MB), range 0.5 to threshold',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultServerCompress',
            label: 'Telegram服务端压缩',
            label_en: 'Telegram Server Compression',
            type: 'boolean',
            default: false,
            tooltip: '由管理员决定Telegram上传是否允许服务端压缩，普通用户无法覆盖',
            tooltip_en: 'Admin policy for Telegram server-side compression. Regular users cannot override it',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'defaultAutoRetry',
            label: '上传失败自动重试',
            label_en: 'Automatic Upload Retry',
            type: 'boolean',
            default: true,
            tooltip: '由管理员统一决定上传失败后是否自动切换渠道重试',
            tooltip_en: 'Admin policy for automatically retrying failed uploads or switching storage channels',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'welcomeWallpaper',
            label: '欢迎页壁纸',
            label_en: 'Welcome Wallpaper',
            type: 'textarea',
            value: getDefaultWelcomeWallpaper(),
            tooltip: '在“欢迎页壁纸”中管理图片队列、切换间隔、透明度及裁切位置。',
            tooltip_en: 'Manage the image queue, interval, opacity, and crop positions in Welcome Wallpaper.',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'loginBkImg',
            label: '登录页背景图',
            label_en: 'Login Background',
            tooltip: '1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 ["url1","url2"] 使用多张图片轮播 <br/> 3.填写 ["url"] 使用单张图片',
            tooltip_en: '1. Enter "bing" for Bing wallpaper rotation <br/> 2. Enter ["url1","url2"] for multiple images <br/> 3. Enter ["url"] for a single image',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'uploadBkImg',
            label: '文件与图库壁纸',
            label_en: 'Files and Albums Wallpaper',
            tooltip: '用于文件和图库工作区。支持一个图片地址或 JSON 地址数组；多张图片按顺序轮播。留空使用默认背景。',
            tooltip_en: 'Wallpaper for files and albums. Enter one image URL or a JSON array of URLs; multiple images rotate in order. Leave empty for the default background.',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'footerLink',
            label: '页脚传送门链接',
            label_en: 'Footer Portal Link',
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        {
            id: 'disableFooter',
            label: '隐藏页脚',
            label_en: 'Hide Footer',
            type: 'boolean',
            default: false,
            category: '客户端设置',
            category_en: 'Client Settings',
        },
        // 管理端设置
        {
            id: 'adminLoginBkImg',
            label: '登录页背景图',
            label_en: 'Login Background',
            tooltip: '1.填写 bing 使用必应壁纸轮播 <br/> 2.填写 ["url1","url2"] 使用多张图片轮播 <br/> 3.填写 ["url"] 使用单张图片',
            tooltip_en: '1. Enter "bing" for Bing wallpaper rotation <br/> 2. Enter ["url1","url2"] for multiple images <br/> 3. Enter ["url"] for a single image',
            category: '管理端设置',
            category_en: 'Admin Settings',
        },
        {
            id: 'adminBkImg',
            label: '管理工作区壁纸',
            label_en: 'Management Workspace Wallpaper',
            tooltip: '用于内容管理等管理工作区。支持一个图片地址或 JSON 地址数组；留空沿用文件与图库壁纸。',
            tooltip_en: 'Wallpaper for management workspaces. Enter one image URL or a JSON array of URLs. Leave empty to use the files and albums wallpaper.',
            category: '管理端设置',
            category_en: 'Admin Settings',
        },
    )

    const userConfig = env.USER_CONFIG
    if (userConfig) {
        try {
            const parsedConfig = JSON.parse(userConfig)
            if (typeof parsedConfig === 'object' && parsedConfig !== null) {
                // 搜索config中的id，如果存在则更新
                for (let i = 0; i < config.length; i++) {
                    const id = config[i].id
                    if (Object.prototype.hasOwnProperty.call(parsedConfig, id)) {
                        config[i].value = parsedConfig[id]
                    }
                }
            }
        } catch (error) {
            // do nothing
        }
    }

    // 用KV中的设置覆盖默认设置
    for (let i = 0; i < settingsKV.config?.length; i++) {
        const item = settingsKV.config[i]
        const index = config.findIndex(x => x.id === item.id)
        if (index !== -1) {
            config[index].value = item.value
        }
    }

    const wallpaper = config.find(item => item.id === 'welcomeWallpaper');
    if (typeof wallpaper.value !== 'string') wallpaper.value = JSON.stringify(wallpaper.value, null, 2);

    return settings
}

/**
 * 处理公告内容及其刷新状态。
 * 公告内容变化或管理员主动刷新时生成新版本；否则沿用旧版本，
 * 确保修改标题、背景等无关设置不会让公告重复弹出。
 */
function processAnnouncementInfo(settings, previousSettings) {
    const previousAnnouncement = Array.isArray(previousSettings.config)
        ? previousSettings.config.find(item => item?.id === 'announcement')?.value ?? ''
        : ''
    const nextAnnouncement = Array.isArray(settings.config)
        ? settings.config.find(item => item?.id === 'announcement')?.value ?? ''
        : ''
    const shouldRefreshAnnouncement =
        previousAnnouncement !== nextAnnouncement || settings.refreshAnnouncement === true

    // 该字段只是前端发来的单次操作指令，不应进入持久化配置。
    delete settings.refreshAnnouncement

    if (shouldRefreshAnnouncement) {
        settings.announcementRefreshAt = Date.now()
    } else if (previousSettings.announcementRefreshAt) {
        settings.announcementRefreshAt = previousSettings.announcementRefreshAt
    } else {
        delete settings.announcementRefreshAt
    }

    return settings
}
