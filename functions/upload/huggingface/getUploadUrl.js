/**
 * HuggingFace 大文件直传 API
 *
 * 流程：
 * 1. 前端计算 SHA256 和文件样本
 * 2. 前端调用此 API 获取 LFS 上传 URL
 * 3. 前端直接上传到 HuggingFace S3
 * 4. 前端调用 commitUpload API 提交文件引用
 *
 * 这样可以绕过 CF Workers 的 100MB 请求体限制和 CPU 时间限制
 */

import { HuggingFaceAPI } from '../../utils/storage/huggingfaceAPI.js';
import { fetchPageConfig, fetchUploadConfig } from '../../utils/sysConfig.js';
import { resolveUploadTarget } from '../memberUploadPolicy.js';
import { userAuthCheck, UnauthorizedResponse } from '../../utils/auth/userAuth.js';
import { getDiscordIdentity, isDiscordAuthConfigured } from '../../utils/auth/discordIdentity.js';
import { rejectCrossSiteMutation } from '../../utils/auth/mutationSecurity.js';
import { buildUniqueFileId, getUploadIp, isBlockedUploadIp, createResponse } from '../uploadTools.js';
import { buildHuggingFaceFilePath } from '../uploadNaming.js';

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    context.url = url;  // 将 url 添加到 context 以便 buildUniqueFileId 使用

    try {
        // 鉴权
        const requiredPermission = 'upload';
        if (!await userAuthCheck(env, url, request, requiredPermission)) {
            return UnauthorizedResponse('Unauthorized');
        }

        if (!isDiscordAuthConfigured(env)) {
            return createResponse(JSON.stringify({ error: 'Discord auth is required for uploads' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }

        if (isDiscordAuthConfigured(env)) {
            const identity = await getDiscordIdentity(env, request);
            if (identity) {
                const originError = rejectCrossSiteMutation(request);
                if (originError) return originError;
                context.discordIdentity = identity;
            }
        }

        if (!context.discordIdentity) {
            return UnauthorizedResponse('Discord sign-in is required');
        }

        // 检查上传IP是否被封禁
        const uploadIp = getUploadIp(request);
        if (await isBlockedUploadIp(env, uploadIp)) {
            return createResponse(JSON.stringify({ error: 'IP blocked' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const body = await request.json();
        const { fileSize, fileName, fileType, sha256, fileSample } = body;
        const normalizedFileType = fileType || 'application/octet-stream';

        if (!fileSize || !fileName || !sha256 || !fileSample) {
            return createResponse(JSON.stringify({
                error: 'Missing required fields: fileSize, fileName, sha256, fileSample'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // HuggingFace 直传也必须服从管理员的 storage target。
        const uploadTarget = resolveUploadTarget(await fetchPageConfig(env));
        if (uploadTarget.channel !== 'huggingface') {
            return createResponse(JSON.stringify({ error: 'HuggingFace is not the active upload backend' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 获取 HuggingFace 配置
        const uploadConfig = await fetchUploadConfig(env);
        const hfSettings = uploadConfig.huggingface;

        if (!hfSettings || !hfSettings.channels || hfSettings.channels.length === 0) {
            return createResponse(JSON.stringify({ error: 'No HuggingFace channel configured' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 选择渠道
        let hfChannel;
        if (uploadTarget.channelName) {
            hfChannel = hfSettings.channels.find(c => c.name === uploadTarget.channelName);
        }
        if (!hfChannel) {
            hfChannel = hfSettings.loadBalance?.enabled
                ? hfSettings.channels[Math.floor(Math.random() * hfSettings.channels.length)]
                : hfSettings.channels[0];
        }

        if (!hfChannel || !hfChannel.token || !hfChannel.repo) {
            return createResponse(JSON.stringify({ error: 'HuggingFace channel not properly configured' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 使用统一的文件命名函数生成文件ID
        const fullId = await buildUniqueFileId(context, fileName, normalizedFileType);

        const filePath = buildHuggingFaceFilePath(context, fullId);

        // 获取 LFS 上传信息
        const huggingfaceAPI = new HuggingFaceAPI(hfChannel.token, hfChannel.repo, hfChannel.isPrivate || false);
        const uploadInfo = await huggingfaceAPI.getLfsUploadInfo(fileSize, filePath, sha256, fileSample);
        rewriteMultipartCompletionUrl(url, uploadInfo);

        // 返回上传信息
        return createResponse(JSON.stringify({
            success: true,
            fullId,
            filePath,
            channelName: hfChannel.name,
            repo: hfChannel.repo,
            isPrivate: hfChannel.isPrivate || false,
            ...uploadInfo
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('getUploadUrl error:', error.message);
        return createResponse(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

function rewriteMultipartCompletionUrl(requestUrl, uploadInfo) {
    const uploadAction = uploadInfo?.uploadAction;
    if (!uploadAction?.header?.chunk_size || !uploadAction.href) {
        return;
    }

    const originalCompletionUrl = uploadAction.href;
    uploadAction.href = `${requestUrl.origin}/upload/huggingface/completeMultipart?target=${encodeURIComponent(originalCompletionUrl)}`;
}
