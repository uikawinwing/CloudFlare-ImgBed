import { userAuthCheck, UnauthorizedResponse } from "../utils/auth/userAuth";
import { fetchUploadConfig, fetchSecurityConfig, fetchPageConfig } from "../utils/sysConfig";
import {
    createResponse, getUploadIp, getIPAddress, resolveFileExt,
    moderateContent, moderateContentDetailed, purgeCDNCache, isBlockedUploadIp, buildUniqueFileId, endUpload, getImageDimensions
} from "./uploadTools";
import { resolveStorageFileName } from "./uploadNaming.js";
import { initializeChunkedUpload, handleChunkUpload, uploadLargeFileToTelegram, handleCleanupRequest } from "./chunkUpload";
import { handleChunkMerge } from "./chunkMerge";
import { TelegramAPI } from "../utils/storage/telegramAPI";
import { DiscordAPI } from "../utils/storage/discordAPI";
import { getDatabase } from '../utils/databaseAdapter.js';
import { assertUploadAllowed, getDiscordIdentity, isDiscordAuthConfigured, releaseUploadReservation } from '../utils/auth/discordIdentity.js';
import { rejectCrossSiteMutation } from '../utils/auth/mutationSecurity.js';
import { matchesAllowedFileSignature, validateDiscordAttachment, validateImageDimensions } from '../utils/fileSignature.js';
import { resolveUploadTarget } from './memberUploadPolicy.js';
import { ensurePermanentThumbnail, persistThumbnailResult } from '../utils/thumbnail.js';


export async function onRequest(context) {  // Contents of context object
    const { request, env, params, waitUntil, next, data } = context;

    const declaredLength = Number(request.headers.get('Content-Length') || 0);
    if (declaredLength > 96 * 1024 * 1024) {
        return createResponse('Error: Request exceeds the 95MB upload limit', { status: 413 });
    }

    // 解析请求的URL，存入 context
    const url = new URL(request.url);
    context.url = url;

    // 读取各项配置，存入 context
    const securityConfig = await fetchSecurityConfig(env);
    const uploadConfig = await fetchUploadConfig(env, context);

    context.securityConfig = securityConfig;
    context.uploadConfig = uploadConfig;

    // 鉴权
    const requiredPermission = 'upload';
    if (!await userAuthCheck(env, url, request, requiredPermission)) {
        return UnauthorizedResponse('Unauthorized');
    }

    if (!isDiscordAuthConfigured(env)) {
        return createResponse('Error: Discord auth is required for uploads', { status: 503 });
    }

    if (isDiscordAuthConfigured(env)) {
        const identity = await getDiscordIdentity(env, request);
        if (identity) {
            const originError = rejectCrossSiteMutation(request);
            if (originError) return originError;
            context.discordIdentity = identity;
            // 浏览器成员不能覆盖服务端的图片处理策略。
            url.searchParams.delete('serverCompress');
            if (url.searchParams.get('initChunked') === 'true' || url.searchParams.get('chunked') === 'true') {
                return createResponse('Error: Chunked uploads are not supported for Discord accounts', { status: 400 });
            }
        } else {
            return UnauthorizedResponse('Discord sign-in is required');
        }
    }

    // 获得上传IP
    const uploadIp = getUploadIp(request);
    // 判断上传ip是否被封禁
    const isBlockedIp = await isBlockedUploadIp(env, uploadIp);
    if (isBlockedIp) {
        return createResponse('Error: Your IP is blocked', { status: 403 });
    }

    // 检查是否为清理请求
    const cleanupRequest = url.searchParams.get('cleanup') === 'true';
    if (cleanupRequest) {
        const uploadId = url.searchParams.get('uploadId');
        const totalChunks = parseInt(url.searchParams.get('totalChunks')) || 0;
        return await handleCleanupRequest(context, uploadId, totalChunks);
    }

    // 检查是否为初始化分块上传请求
    const initChunked = url.searchParams.get('initChunked') === 'true';
    if (initChunked) {
        return await initializeChunkedUpload(context);
    }

    // 检查是否为分块上传
    const isChunked = url.searchParams.get('chunked') === 'true';
    const isMerge = url.searchParams.get('merge') === 'true';

    if (isChunked) {
        if (isMerge) {
            return await handleChunkMerge(context);
        } else {
            return await handleChunkUpload(context);
        }
    }

    // 处理非分块文件上传
    try {
        const response = await processFileUpload(context);
        if (context.discordIdentity && context.quotaReservedBytes && !response.ok) {
            await releaseUploadReservation(env, context.discordIdentity, context.quotaReservedBytes);
            context.quotaReservedBytes = 0;
        }
        return response;
    } catch (error) {
        if (context.discordIdentity && context.quotaReservedBytes) {
            await releaseUploadReservation(env, context.discordIdentity, context.quotaReservedBytes);
            context.quotaReservedBytes = 0;
        }
        throw error;
    }
}
// 通用文件上传处理函数
async function processFileUpload(context, formdata = null) {
    const { request, url } = context;

    // 解析表单数据
    formdata = formdata || await request.formData();

    // 将 formdata 存储在 context 中
    context.formdata = formdata;

    const pageConfig = await fetchPageConfig(context.env);
    const uploadTarget = resolveUploadTarget(pageConfig);
    const configuredChannel = String(pageConfig?.config?.find((item) => item?.id === 'defaultUploadChannel')?.value || 'telegram').trim().toLowerCase();
    if (configuredChannel === 'huggingface') {
        return createResponse('Error: Hugging Face uploads are disabled', { status: 503 });
    }
    if (configuredChannel === 's3' || configuredChannel === 'webdav') {
        return createResponse('Error: This storage backend is no longer available', { status: 410 });
    }
    // storage backend 完全由管理员控制，用户不能通过 URL 覆盖。
    const urlParamUploadChannel = uploadTarget.channel;
    const urlParamChannelName = uploadTarget.channelName;

    // 获取IP地址
    const uploadIp = getUploadIp(request);
    const ipAddress = await getIPAddress(context.env, uploadIp, context.securityConfig);







    let uploadChannel = 'TelegramNew';
    switch (urlParamUploadChannel) {
        case 'telegram':
            uploadChannel = 'TelegramNew';
            break;
        case 'cfr2':
            uploadChannel = 'CloudflareR2';
            break;
        case 'discord':
            uploadChannel = 'Discord';
            break;
        default:
            uploadChannel = 'TelegramNew';
            break;
    }

    // 将指定的渠道名称存入 context，供后续上传函数使用
    context.specifiedChannelName = urlParamChannelName || null;

    // 获取文件信息
    const time = new Date().getTime();
    const file = formdata.get('file');
    if (!file) {
        return createResponse('Error: No file provided', { status: 400 });
    }
    const fileType = file.type;
    let fileName = String(file.name).replace(/\\/g, '/').split('/').pop();
    const fileSizeBytes = file.size; // 文件大小，单位字节
    const fileSize = (fileSizeBytes / 1024 / 1024).toFixed(2); // 文件大小，单位MB

    // 检查fileType和fileName是否存在
    if (fileType === null || fileType === undefined || fileName === null || fileName === undefined) {
        return createResponse('Error: fileType or fileName is wrong, check the integrity of this file!', { status: 400 });
    }

    if (context.discordIdentity) {
        try {
            if (!await matchesAllowedFileSignature(file, fileType)) {
                return createResponse('Error: File content does not match an allowed format', { status: 400 });
            }
            context.quotaReservedBytes = await assertUploadAllowed(context.env, context.discordIdentity, file);
        } catch (error) {
            return createResponse(`Error: ${error.message}`, { status: 400 });
        }
    }

    // 提取图片尺寸
    let imageDimensions = null;
    if (fileType.startsWith('image/')) {
        try {
            // 统一读取 64KB，足以覆盖 JPEG 的 EXIF 数据和其他格式
            const headerBuffer = await file.slice(0, 65536).arrayBuffer();
            imageDimensions = getImageDimensions(headerBuffer, fileType);
        } catch (error) {
            console.error('Error reading image dimensions:', error);
        }
        const imageDimensionError = validateImageDimensions(imageDimensions);
        if (imageDimensionError) {
            return createResponse(`Error: ${imageDimensionError}`, { status: 400 });
        }
}
    


    // 用户文件不再具有 folder 路径；归类由 Album 负责。


    const metadata = {
        FileName: fileName,
        FileType: fileType,
        FileSize: fileSize,
        FileSizeBytes: fileSizeBytes,
        UploadIP: uploadIp,
        UploadAddress: ipAddress,
        ListType: "None",
        TimeStamp: time,
        Label: "None",
        Directory: '',
        Tags: []
    };
    if (context.discordIdentity) {
        metadata.OwnerId = context.discordIdentity.id;
        metadata.Visibility = 'public';
        metadata.ModerationStatus = 'active';
    }

    // 添加图片尺寸信息
    if (imageDimensions) {
        metadata.Width = imageDimensions.width;
        metadata.Height = imageDimensions.height;
    }

    const fileExt = resolveFileExt(fileName, fileType);

    // 构建文件ID
    const fullId = await buildUniqueFileId(context, fileName, fileType);
    const storageFileName = resolveStorageFileName(context, fullId, fileName);

    // 获得返回链接格式, default为返回/file/id, full为返回完整链接
    const returnFormat = url.searchParams.get('returnFormat') || 'default';
    let returnLink = '';
    if (returnFormat === 'full') {
        returnLink = `${url.origin}/file/${fullId}`;
    } else {
        returnLink = `/file/${fullId}`;
    }

    // 构建公开访问链接（使用 urlPrefix 配置）
    const urlPrefixConfig = pageConfig.config?.find(c => c.id === 'urlPrefix');
    const urlPrefix = urlPrefixConfig?.value || '';
    context.publicUrl = urlPrefix ? `${urlPrefix.replace(/\/+$/, '')}/${fullId}` : '';

    /* ====================================不同渠道上传======================================= */
    // 上传失败直接返回，避免文件在未经明确配置的后端中落库。
    let response;
    if (uploadChannel === 'CloudflareR2') {
        response = await uploadFileToCloudflareR2(context, fullId, metadata, returnLink);
    } else if (uploadChannel === 'Discord') {
        response = await uploadFileToDiscord(context, fullId, metadata, returnLink);
    } else {
        response = await uploadFileToTelegram(context, fullId, metadata, fileExt, storageFileName, fileType, returnLink);
    }
    if (!response.ok || !fileType.startsWith('image/')) return response;

    let thumbnailResult;
    try {
        const generated = await ensurePermanentThumbnail(context, fullId, metadata, file);
        thumbnailResult = await persistThumbnailResult(context, fullId, metadata, generated);
    } catch (error) {
        console.error(`Uploaded image thumbnail failed for ${fullId}:`, error);
        thumbnailResult = { ready: false, created: false, reason: 'thumbnail-persist-failed' };
    }
    const results = await response.json();
    const result = results[0];
    result.thumbnailReady = thumbnailResult.ready;
    result.thumbnailCreated = thumbnailResult.created;
    if (thumbnailResult.reason) result.thumbnailReason = thumbnailResult.reason;
    if (!thumbnailResult.ready) {
        result.warning = [result.warning, 'Original stored; thumbnail is not ready'].filter(Boolean).join('; ');
    }
    return new Response(JSON.stringify(results), { status: response.status, headers: response.headers });
}

// 构建上传成功响应，自动附带 publicUrl（如果已配置）
function buildUploadResponse(context, returnLink, metadata = null) {
    const result = { src: returnLink };
    if (context.publicUrl) {
        result.publicUrl = context.publicUrl;
    }
    if (metadata?.ModerationStatus && metadata.ModerationStatus !== 'active') {
        result.moderationStatus = metadata.ModerationStatus;
        result.warning = 'Upload stored but withheld from public access pending moderation review';
    }
    return createResponse(JSON.stringify([result]), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

// 上传到Cloudflare R2
async function uploadFileToCloudflareR2(context, fullId, metadata, returnLink) {
    const { env, waitUntil, uploadConfig, formdata, specifiedChannelName } = context;
    const db = getDatabase(env);

    // 检查R2数据库是否配置
    if (typeof env.img_r2 == "undefined" || env.img_r2 == null || env.img_r2 == "") {
        return createResponse('Error: Please configure R2 database', { status: 500 });
    }

    // 检查 R2 渠道是否启用
    const r2Settings = uploadConfig.cfr2;
    if (!r2Settings.channels || r2Settings.channels.length === 0) {
        return createResponse('Error: No R2 channel provided', { status: 400 });
    }

    // 选择渠道：优先使用指定的渠道名称
    let r2Channel;
    if (specifiedChannelName) {
        r2Channel = r2Settings.channels.find(ch => ch.name === specifiedChannelName);
    }
    if (!r2Channel) {
        r2Channel = r2Settings.channels[0];
    }

    const R2DataBase = env.img_r2;

    // 写入R2数据库
    await R2DataBase.put(fullId, formdata.get('file'));

    // 更新metadata
    metadata.Channel = "CloudflareR2";
    metadata.ChannelName = r2Channel.name || "R2_env";

    // 图像审查，采用R2的publicUrl
    const R2PublicUrl = r2Channel.publicUrl;
    let moderateUrl = `${R2PublicUrl}/${fullId}`;
    metadata.Label = await moderateContent(env, moderateUrl);

    // 写入数据库
    try {
        await db.put(fullId, "", {
            metadata: metadata,
        });
    } catch (error) {
        return createResponse('Error: Failed to write to database', { status: 500 });
    }

    // 结束上传
    waitUntil(endUpload(context, fullId, metadata));

    // 成功上传，将文件ID返回给客户端
    return buildUploadResponse(context, returnLink);
}
// 上传到Telegram
async function uploadFileToTelegram(context, fullId, metadata, fileExt, storageFileName, fileType, returnLink) {
    const { env, waitUntil, uploadConfig, url, formdata, specifiedChannelName } = context;
    const db = getDatabase(env);

    // 选择一个 Telegram 渠道上传
    const tgSettings = uploadConfig.telegram;
    const tgChannels = tgSettings.channels;
    
    let tgChannel;
    // 如果指定了渠道名称，优先使用指定的渠道
    if (specifiedChannelName) {
        tgChannel = tgChannels.find(ch => ch.name === specifiedChannelName);
    }
    // 未指定或未找到指定渠道，使用负载均衡或第一个
    if (!tgChannel) {
        tgChannel = tgSettings.loadBalance.enabled ? tgChannels[Math.floor(Math.random() * tgChannels.length)] : tgChannels[0];
    }
    if (!tgChannel) {
        return createResponse('Error: No Telegram channel provided', { status: 400 });
    }

    const tgBotToken = tgChannel.botToken;
    const tgChatId = tgChannel.chatId;
    const tgProxyUrl = tgChannel.proxyUrl || '';
    const file = formdata.get('file');
    const fileSize = file.size;

    const telegramAPI = new TelegramAPI(tgBotToken, tgProxyUrl);

    // 16MB 分片阈值 (TG Bot getFile download limit: 20MB, leave 4MB safety margin)
    const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB

    if (fileSize > CHUNK_SIZE) {
        // 大文件分片上传
        return await uploadLargeFileToTelegram(context, file, fullId, metadata, storageFileName, fileType, returnLink, tgBotToken, tgChatId, tgChannel);
    }

    // 由于TG会把gif后缀的文件转为视频，所以需要修改后缀名绕过限制
    let telegramFileName = storageFileName;
    if (fileExt === 'gif') {
        const newFileName = storageFileName.replace(/\.gif$/i, '.jpeg');
        const newFile = new File([formdata.get('file')], newFileName, { type: fileType });
        formdata.set('file', newFile);
        telegramFileName = newFileName;
    } else if (fileExt === 'webp') {
        const newFileName = storageFileName.replace(/\.webp$/i, '.jpeg');
        const newFile = new File([formdata.get('file')], newFileName, { type: fileType });
        formdata.set('file', newFile);
        telegramFileName = newFileName;
    }

    // 选择对应的发送接口
    const fileTypeMap = {
        'image/': { 'url': 'sendPhoto', 'type': 'photo' },
        'video/': { 'url': 'sendVideo', 'type': 'video' },
        'audio/': { 'url': 'sendAudio', 'type': 'audio' },
        'application/pdf': { 'url': 'sendDocument', 'type': 'document' },
    };

    const defaultType = { 'url': 'sendDocument', 'type': 'document' };

    let sendFunction = Object.keys(fileTypeMap).find(key => fileType.startsWith(key))
        ? fileTypeMap[Object.keys(fileTypeMap).find(key => fileType.startsWith(key))]
        : defaultType;

    // GIF ICO 等发送接口特殊处理
    if (fileType === 'image/gif' || fileType === 'image/webp' || fileExt === 'gif' || fileExt === 'webp') {
        sendFunction = { 'url': 'sendAnimation', 'type': 'animation' };
    } else if (fileType === 'image/svg+xml' || fileType === 'image/x-icon') {
        sendFunction = { 'url': 'sendDocument', 'type': 'document' };
    }

    // 根据服务端压缩设置处理接口：从参数中获取serverCompress，如果为false，则使用sendDocument接口
    if (url.searchParams.get('serverCompress') === 'false') {
        sendFunction = { 'url': 'sendDocument', 'type': 'document' };
    }

    // 上传文件到 Telegram
    let res = createResponse('upload error, check your environment params about telegram channel!', { status: 400 });
    try {
        const response = await telegramAPI.sendFile(formdata.get('file'), tgChatId, sendFunction.url, sendFunction.type, '', telegramFileName);
        const fileInfo = telegramAPI.getFileInfo(response);
        const filePath = await telegramAPI.getFilePath(fileInfo.file_id);
        const id = fileInfo.file_id;
        // 更新FileSize
        metadata.FileSize = (fileInfo.file_size / 1024 / 1024).toFixed(2);

        // 将响应返回给客户端
        res = buildUploadResponse(context, returnLink);


        // 图像审查（使用代理域名或官方域名）
        const moderateDomain = tgProxyUrl ? `https://${tgProxyUrl}` : 'https://api.telegram.org';
        const moderateUrl = `${moderateDomain}/file/bot${tgBotToken}/${filePath}`;
        metadata.Label = await moderateContent(env, moderateUrl);

        // 更新metadata，写入KV数据库
        try {
            metadata.Channel = "TelegramNew";
            metadata.ChannelName = tgChannel.name;

            metadata.TgFileId = id;
            await db.put(fullId, "", {
                metadata: metadata,
            });
        } catch (error) {
            res = createResponse('Error: Failed to write to KV database', { status: 500 });
        }

        // 结束上传
        waitUntil(endUpload(context, fullId, metadata));

    } catch (error) {
        console.log('Telegram upload error:', error.message);
        res = createResponse('upload error, check your environment params about telegram channel!', { status: 400 });
    } finally {
        return res;
    }
}


// 上传到 Discord
async function uploadFileToDiscord(context, fullId, metadata, returnLink) {
    const { env, waitUntil, uploadConfig, formdata, specifiedChannelName } = context;
    const db = getDatabase(env);

    // 获取 Discord 渠道配置
    const discordSettings = uploadConfig.discord;
    if (!discordSettings || !discordSettings.channels || discordSettings.channels.length === 0) {
        return createResponse('Error: No Discord channel configured', { status: 400 });
    }

    // 选择渠道：优先使用指定的渠道名称
    const discordChannels = discordSettings.channels;
    let discordChannel;
    if (specifiedChannelName) {
        discordChannel = discordChannels.find(ch => ch.name === specifiedChannelName);
    }
    if (!discordChannel) {
        discordChannel = discordSettings.loadBalance?.enabled
            ? discordChannels[Math.floor(Math.random() * discordChannels.length)]
            : discordChannels[0];
    }

    if (!discordChannel || !discordChannel.botToken || !discordChannel.channelId) {
        return createResponse('Error: Discord channel not properly configured', { status: 400 });
    }

    const file = formdata.get('file');
    const fileSize = file.size;
    const storageFileName = resolveStorageFileName(context, fullId, metadata.FileName);

    const discordAPI = new DiscordAPI(discordChannel.botToken);

    try {
        // 上传文件到 Discord
        const response = await discordAPI.sendFile(file, discordChannel.channelId, storageFileName);
        const fileInfo = discordAPI.getFileInfo(response);

        if (!fileInfo) {
            if (response?.id) await discordAPI.deleteMessage(discordChannel.channelId, response.id);
            throw new Error('Failed to get file info from Discord response');
        }
        const attachmentError = validateDiscordAttachment(fileInfo, {
            size: fileSize,
            fileType: metadata.FileType,
            fileName: storageFileName,
        });
        if (attachmentError) {
            await discordAPI.deleteMessage(discordChannel.channelId, fileInfo.message_id);
            throw new Error(attachmentError);
        }

        // 更新 metadata
        metadata.Channel = "Discord";
        metadata.ChannelName = discordChannel.name || "Discord_env";
        metadata.FileSize = (fileInfo.file_size / 1024 / 1024).toFixed(2);
        metadata.DiscordMessageId = fileInfo.message_id;
        // 注意：不存储 DiscordAttachmentUrl，因为 Discord 附件 URL 会在约24小时后过期
        // 读取时会通过 API 获取新的 URL

        // 图像审查（使用 Discord CDN URL 或代理 URL）
        let moderateUrl = fileInfo.url;
        if (discordChannel.proxyUrl) {
            moderateUrl = fileInfo.url.replace('https://cdn.discordapp.com', `https://${discordChannel.proxyUrl}`);
        }
        const moderation = await moderateContentDetailed(env, moderateUrl);
        metadata.Label = moderation.label;
        if (moderation.status === 'failed') {
            metadata.ModerationStatus = 'quarantined';
        }

        // 写入 KV 数据库
        try {
            await db.put(fullId, "", { metadata });
        } catch (error) {
            return createResponse('Error: Failed to write to KV database', { status: 500 });
        }

        // 结束上传
        waitUntil(endUpload(context, fullId, metadata));

        // 返回成功响应
        return buildUploadResponse(context, returnLink, metadata);

    } catch (error) {
        console.error('Discord upload error:', error.message);
        return createResponse(`Error: Discord upload failed - ${error.message}`, { status: error.status === 413 ? 413 : 500 });
    }
}
