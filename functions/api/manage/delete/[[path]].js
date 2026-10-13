import { purgeCFCache, purgeRandomFileListCache, purgePublicFileListCache } from "../../../utils/purgeCache.js";
import { removeFileFromIndex, batchRemoveFilesFromIndex } from "../../../utils/indexManager.js";
import { getDatabase } from '../../../utils/databaseAdapter.js';
import { DiscordAPI } from '../../../utils/storage/discordAPI.js';
import { HuggingFaceAPI } from '../../../utils/storage/huggingfaceAPI.js';
import {
    resolveDiscordCredentials,
    resolveHuggingFaceCredentials,
} from '../../../utils/metadata/channelCredentials.js';
import { getDiscordIdentity } from '../../../utils/auth/discordIdentity.js';
import { deletePermanentThumbnail, thumbnailContentVersion, thumbnailVariantUrls } from '../../../utils/thumbnail.js';
import { settleFileDeletion } from '../../../utils/files/fileLifecycle.js';

// CORS 跨域响应头
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

export async function onRequest(context) {
    const { request, env, params, waitUntil } = context;

    // Discord staff must use the moderated endpoint so a reason and audit record are mandatory.
    if (await getDiscordIdentity(env, request)) {
        return new Response(JSON.stringify({ success: false, error: 'Use the moderated delete endpoint' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }

    const url = new URL(request.url);

    // 读取folder参数，判断是否为文件夹删除请求
    const folder = url.searchParams.get('folder');
    if (folder === 'true') {
        try {
            params.path = decodeURIComponent(params.path);
            // 使用队列存储需要处理的文件夹
            const folderQueue = [{
                path: params.path.split(',').join('/')
            }];

            const deletedFiles = [];
            const failedFiles = [];

            while (folderQueue.length > 0) {
                const currentFolder = folderQueue.shift();

                // 获取指定目录下的所有文件
                const listUrl = new URL(`${url.origin}/api/manage/list?count=-1&dir=${currentFolder.path}`);
                const listRequest = new Request(listUrl, {
                    headers: request.headers,
                });
                const listResponse = await fetch(listRequest);
                const listData = await listResponse.json();

                const files = listData.files;

                // 处理当前文件夹下的所有文件
                for (const file of files) {
                    const fileId = file.name;
                    const cdnUrl = `https://${url.hostname}/file/${fileId}`;

                    const success = await deleteFile(env, fileId, cdnUrl, url);
                    if (success) {
                        deletedFiles.push(fileId);
                    } else {
                        failedFiles.push(fileId);
                    }
                }

                // 将子文件夹添加到队列
                const directories = listData.directories;
                for (const dir of directories) {
                    folderQueue.push({
                        path: dir
                    });
                }
            }

            // 批量从索引中删除文件
            if (deletedFiles.length > 0) {
                waitUntil(batchRemoveFilesFromIndex(context, deletedFiles));
            }

            return new Response(JSON.stringify({
                success: true,
                deleted: deletedFiles,
                failed: failedFiles
            }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });

        } catch (e) {
            return new Response(JSON.stringify({
                success: false,
                error: e.message
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }
    }

    // 单个文件删除处理
    try {
        // 解码params.path
        params.path = decodeURIComponent(params.path);
        const fileId = params.path.split(',').join('/');
        const cdnUrl = `https://${url.hostname}/file/${fileId}`;

        const success = await deleteFile(env, fileId, cdnUrl, url);
        if (!success) {
            throw new Error('Delete file failed');
        } else {
            // 从索引中删除文件
            waitUntil(removeFileFromIndex(context, fileId));
        }

        return new Response(JSON.stringify({
            success: true,
            fileId: fileId
        }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            error: e.message
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
}

// 删除单个文件的核心函数
export async function deleteFile(env, fileId, cdnUrl, url) {
    try {
        // 读取图片信息
        const db = getDatabase(env);
        const img = await db.getWithMetadata(fileId);

        // 如果文件记录不存在，直接返回成功（幂等删除）
        if (!img) {
            await purgeCFCache(env, cdnUrl);
            await purgeThumbnailCaches(env, url.toString(), fileId);
            const normalizedFolder = fileId.split('/').slice(0, -1).join('/');
            await purgeRandomFileListCache(url.origin, normalizedFolder);
            await purgePublicFileListCache(url.origin, normalizedFolder);
            return true;
        }

        if (img.metadata?.Channel === 'S3' || img.metadata?.Channel === 'WebDAV') {
            throw new Error('Retired storage must be cleaned at its source before removing its file record');
        }

        // 先隐藏记录并清缓存；后续任何一步失败都能安全重试。
        if (env.img_d1?.prepare) {
            const deletingMetadata = { ...img.metadata, ModerationStatus: 'deleting' };
            img.metadata = deletingMetadata;
            await env.img_d1.prepare('UPDATE files SET metadata = ?, moderation_status = ? WHERE id = ?')
                .bind(JSON.stringify(deletingMetadata), 'deleting', fileId).run();
        }
        await purgeCFCache(env, cdnUrl);
        await purgeThumbnailCaches(env, url.toString(), fileId, thumbnailContentVersion(img.metadata));

        // 缩图是原文件的派生资源，不作为独立作品；删除原文件时尽力一起清理。
        if (!await deletePermanentThumbnail(env, img.metadata)) {
            console.warn(`Failed to delete permanent thumbnail for ${fileId}; continuing original deletion`);
        }

        // 如果是R2渠道的图片，需要删除R2中对应的图片
        if (img.metadata?.Channel === 'CloudflareR2') {
            const R2DataBase = env.img_r2;
            await R2DataBase.delete(fileId);
        }

        // Discord 渠道的图片，需要删除 Discord 中对应的消息
        if (img.metadata?.Channel === 'Discord') {
            if (!await deleteDiscordFile(env, img)) throw new Error('Failed to delete Discord message');
        }

        // HuggingFace 渠道的图片，需要删除 HuggingFace 中对应的文件
        if (img.metadata?.Channel === 'HuggingFace') {
            if (!await deleteHuggingFaceFile(env, img)) throw new Error('Failed to delete Hugging Face file');
        }

        // 同一数据库事务中结清相册引用、额度和文件记录。
        if (env.img_d1?.prepare) {
            await settleFileDeletion(env.img_d1, fileId);
            if (env.img_url?.delete) await env.img_url.delete(fileId);
        } else {
            await db.delete(fileId);
        }

        // 清除 api/randomFileList 等API缓存
        const normalizedFolder = fileId.split('/').slice(0, -1).join('/');
        await purgeRandomFileListCache(url.origin, normalizedFolder);
        await purgePublicFileListCache(url.origin, normalizedFolder);

        return true;
    } catch (e) {
        console.error('Delete file failed:', e);
        return false;
    }
}

async function purgeThumbnailCaches(env, requestUrl, fileId, version) {
    for (const thumbnailUrl of thumbnailVariantUrls(requestUrl, fileId, version)) {
        await purgeCFCache(env, thumbnailUrl);
    }
}

// 删除 Discord 渠道的图片（删除 Discord 消息）
async function deleteDiscordFile(env, img) {
    const db = getDatabase(env);
    const discordCredentials = await resolveDiscordCredentials(db, env, img.metadata);
    const botToken = discordCredentials.botToken;
    const channelId = discordCredentials.channelId;
    const messageId = discordCredentials.messageId;

    if (!botToken || !channelId || !messageId) {
        console.warn('Discord file missing required metadata for deletion');
        return false;
    }

    try {
        const discordAPI = new DiscordAPI(botToken);
        const success = await discordAPI.deleteMessage(channelId, messageId);
        if (!success) {
            console.error('Discord Delete Failed: API returned false');
        }
        return success;
    } catch (error) {
        console.error("Discord Delete Failed:", error);
        return false;
    }
}
// 删除 HuggingFace 渠道的图片
async function deleteHuggingFaceFile(env, img) {
    const db = getDatabase(env);
    const hfCredentials = await resolveHuggingFaceCredentials(db, env, img.metadata);
    const token = hfCredentials.token;
    const repo = hfCredentials.repo;
    const filePath = hfCredentials.filePath;
    const isPrivate = hfCredentials.isPrivate || false;

    if (!token || !repo || !filePath) {
        console.warn('HuggingFace file missing required metadata for deletion');
        return false;
    }

    try {
        const huggingfaceAPI = new HuggingFaceAPI(token, repo, isPrivate);
        const success = await huggingfaceAPI.deleteFile(filePath, `Delete ${filePath}`);
        if (!success) {
            console.error('HuggingFace Delete Failed: API returned false');
        }
        return success;
    } catch (error) {
        console.error("HuggingFace Delete Failed:", error);
        return false;
    }
}
