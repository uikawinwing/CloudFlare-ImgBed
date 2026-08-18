/**
 * HuggingFace 大文件提交 API
 * 
 * 在前端直接上传文件到 S3 后，调用此 API 提交 LFS 文件引用
 */

import { HuggingFaceAPI } from '../../utils/storage/huggingfaceAPI.js';
import { fetchPageConfig, fetchUploadConfig } from '../../utils/sysConfig.js';
import { getDatabase } from '../../utils/databaseAdapter.js';
import { moderateContent, endUpload, getUploadIp, getIPAddress, sanitizeUploadFolder, createResponse } from '../uploadTools.js';
import { userAuthCheck, UnauthorizedResponse } from '../../utils/auth/userAuth.js';
import { getDiscordIdentity, isDiscordAuthConfigured } from '../../utils/auth/discordIdentity.js';
import { rejectCrossSiteMutation } from '../../utils/auth/mutationSecurity.js';
import { isOwnedCanonicalFileId } from '../uploadNaming.js';
import { resolveUploadTarget } from '../memberUploadPolicy.js';

export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    const url = new URL(request.url);

    try {
        // 鉴权
        const requiredPermission = 'upload';
        if (!await userAuthCheck(env, url, request, requiredPermission)) {
            return UnauthorizedResponse('Unauthorized');
        }

        if (!isDiscordAuthConfigured(env)) {
            return createResponse(JSON.stringify({ error: 'Discord auth is required for uploads' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }

        const identity = await getDiscordIdentity(env, request);
        if (!identity) return UnauthorizedResponse('Discord sign-in is required');
        const originError = rejectCrossSiteMutation(request);
        if (originError) return originError;
        context.discordIdentity = identity;

        const body = await request.json();
        const { fullId, filePath, sha256, fileSize, fileName, fileType } = body;

        if (!fullId || !filePath || !sha256 || !fileSize) {
            return createResponse(JSON.stringify({
                error: 'Missing required fields: fullId, filePath, sha256, fileSize'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!isOwnedCanonicalFileId(identity, fullId) || filePath !== fullId) {
            return createResponse(JSON.stringify({ error: 'Upload target does not belong to the signed-in user' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 路径安全处理：使用统一的路径安全函数
        const sanitizedFullId = sanitizeUploadFolder(fullId);
        if (sanitizedFullId !== fullId) {
            return createResponse(JSON.stringify({
                error: 'Invalid fullId: contains illegal path characters'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

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
            hfChannel = hfSettings.channels[0];
        }

        if (!hfChannel || !hfChannel.token || !hfChannel.repo) {
            return createResponse(JSON.stringify({ error: 'HuggingFace channel not properly configured' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const huggingfaceAPI = new HuggingFaceAPI(hfChannel.token, hfChannel.repo, hfChannel.isPrivate || false);

        // 提交 LFS 文件引用
        console.log('Committing LFS file...');
        const commitResult = await huggingfaceAPI.commitLfsFile(
            filePath,
            sha256,
            fileSize,
            `Upload ${fileName || fullId}`
        );
        console.log('Commit result:', JSON.stringify(commitResult));

        // 构建文件 URL
        const fileUrl = `https://huggingface.co/datasets/${hfChannel.repo}/resolve/main/${filePath}`;

        // 用户文件不再暴露 folder 语义。



        // 获取上传IP和地址
        const uploadIp = getUploadIp(request) || '';
        const uploadAddress = await getIPAddress(env, uploadIp);

        // 构建 metadata
        const metadata = {
            FileName: fileName || fullId,
            FileType: fileType || '',
            Channel: "HuggingFace",
            ChannelName: hfChannel.name || "HuggingFace_env",
            FileSize: (fileSize / 1024 / 1024).toFixed(2),
            FileSizeBytes: fileSize,
            UploadIP: uploadIp,
            UploadAddress: uploadAddress,
            ListType: "None",
            HfFilePath: filePath,
            TimeStamp: Date.now(),
            Label: "None",
            Directory: '',
            Tags: [],
            OwnerId: identity.id,
            Visibility: 'private',
            ModerationStatus: 'active'
        };

        // 图像审查（公开仓库）
        if (!hfChannel.isPrivate) {
            try {
                metadata.Label = await moderateContent(env, fileUrl);
            } catch (e) {
                console.warn('Content moderation failed:', e.message);
            }
        }

        // 写入数据库
        const db = getDatabase(env);
        await db.put(fullId, "", { metadata });

        // 结束上传（更新索引等）
        const uploadContext = {
            env,
            waitUntil,
            uploadConfig,
            url
        };
        waitUntil(endUpload(uploadContext, fullId, metadata));

        // 返回成功响应
        const returnLink = `/file/${fullId}`;
        const responseBody = {
            success: true,
            src: returnLink,
            fileUrl,
            fullId
        };

        // 构建公开访问链接（使用 urlPrefix 配置）
        const pageConfig = await fetchPageConfig(env);
        const urlPrefixConfig = pageConfig.config?.find(c => c.id === 'urlPrefix');
        const urlPrefix = urlPrefixConfig?.value || '';
        if (urlPrefix) {
            responseBody.publicUrl = `${urlPrefix.replace(/\/+$/, '')}/${fullId}`;
        }

        return createResponse(JSON.stringify(responseBody), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('commitUpload error:', error.message);
        return createResponse(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
