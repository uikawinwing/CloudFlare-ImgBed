/**
 * Cloudflare Workers 部署适配层（自动生成，请勿手动编辑）
 * 生成命令: node deploy/worker/generate-routes.js
 * 
 * 复用 functions/ 下的全部业务逻辑，不修改任何业务代码
 */

// ==================== 自动生成的导入 ====================

// --- 中间件（自动生成） ---
import * as mw_api from '../../functions/api/_middleware.js';
import * as mw_api_admin from '../../functions/api/admin/_middleware.js';
import * as mw_api_manage from '../../functions/api/manage/_middleware.js';
import * as mw_api_moderation from '../../functions/api/moderation/_middleware.js';
import * as mw_api_user from '../../functions/api/user/_middleware.js';
import * as mw_dav from '../../functions/dav/_middleware.js';
import * as mw_file from '../../functions/file/_middleware.js';
import * as mw_random from '../../functions/random/_middleware.js';
import * as mw_upload from '../../functions/upload/_middleware.js';

// --- 路由模块（自动生成） ---
import * as apiManageBatchIndexChunk from '../../functions/api/manage/batch/index/chunk.js';
import * as apiManageBatchIndexConfig from '../../functions/api/manage/batch/index/config.js';
import * as apiManageBatchIndexFinalize from '../../functions/api/manage/batch/index/finalize.js';
import * as apiManageBatchRestoreChunk from '../../functions/api/manage/batch/restore/chunk.js';
import * as apiPublicGalleryParamOwnerSlugParamAlbumSlug from '../../functions/api/public/gallery/[ownerSlug]/[albumSlug].js';
import * as apiUserAlbumsCatchAllIdCharinfo from '../../functions/api/user/albums/[[id]]/charinfo.js';
import * as apiUserAlbumsCatchAllIdItems from '../../functions/api/user/albums/[[id]]/items.js';
import * as apiAuthDiscordCallback from '../../functions/api/auth/discord/callback.js';
import * as apiManageBatchList from '../../functions/api/manage/batch/list.js';
import * as apiManageBatchSettings from '../../functions/api/manage/batch/settings.js';
import * as apiManageCusConfigBlockip from '../../functions/api/manage/cusConfig/blockip.js';
import * as apiManageCusConfigBlockipList from '../../functions/api/manage/cusConfig/blockipList.js';
import * as apiManageCusConfigFiles from '../../functions/api/manage/cusConfig/files.js';
import * as apiManageCusConfigList from '../../functions/api/manage/cusConfig/list.js';
import * as apiManageCusConfigWhiteip from '../../functions/api/manage/cusConfig/whiteip.js';
import * as apiManageDeleteBatch from '../../functions/api/manage/delete/batch.js';
import * as apiManageSysConfigOthers from '../../functions/api/manage/sysConfig/others.js';
import * as apiManageSysConfigPage from '../../functions/api/manage/sysConfig/page.js';
import * as apiManageSysConfigSecurity from '../../functions/api/manage/sysConfig/security.js';
import * as apiManageSysConfigUpload from '../../functions/api/manage/sysConfig/upload.js';
import * as apiManageTagsAutocomplete from '../../functions/api/manage/tags/autocomplete.js';
import * as apiManageTagsBatch from '../../functions/api/manage/tags/batch.js';
import * as apiPublicCharinfoParamAlbumId from '../../functions/api/public/charinfo/[albumId].js';
import * as apiUserAlbumsParamId from '../../functions/api/user/albums/[id].js';
import * as apiAdminMigrateKvFiles from '../../functions/api/admin/migrate-kv-files.js';
import * as apiAdminUsers_index from '../../functions/api/admin/users/index.js';
import * as apiAuthAdminLogin from '../../functions/api/auth/adminLogin.js';
import * as apiAuthDiscord_index from '../../functions/api/auth/discord/index.js';
import * as apiAuthLogin from '../../functions/api/auth/login.js';
import * as apiAuthLogout from '../../functions/api/auth/logout.js';
import * as apiAuthMe from '../../functions/api/auth/me.js';
import * as apiAuthResetAuth from '../../functions/api/auth/resetAuth.js';
import * as apiAuthSessionCheck from '../../functions/api/auth/sessionCheck.js';
import * as apiBingWallpaper_index from '../../functions/api/bing/wallpaper/index.js';
import * as apiManageApiTokens from '../../functions/api/manage/apiTokens.js';
import * as apiManageList from '../../functions/api/manage/list.js';
import * as apiManageQuota from '../../functions/api/manage/quota.js';
import * as apiModerationAudit from '../../functions/api/moderation/audit.js';
import * as apiModerationFiles from '../../functions/api/moderation/files.js';
import * as apiPublicDiscover_index from '../../functions/api/public/discover/index.js';
import * as apiPublicList from '../../functions/api/public/list.js';
import * as apiUserAlbums_index from '../../functions/api/user/albums/index.js';
import * as apiUserFiles_index from '../../functions/api/user/files/index.js';
import * as apiUserHandle from '../../functions/api/user/handle.js';
import * as galleryParamOwnerSlugParamAlbumSlug from '../../functions/gallery/[ownerSlug]/[albumSlug].js';
import * as uploadHuggingfaceCommitUpload from '../../functions/upload/huggingface/commitUpload.js';
import * as uploadHuggingfaceCompleteMultipart from '../../functions/upload/huggingface/completeMultipart.js';
import * as uploadHuggingfaceGetUploadUrl from '../../functions/upload/huggingface/getUploadUrl.js';
import * as apiChannels from '../../functions/api/channels.js';
import * as apiDirectoryTree from '../../functions/api/directoryTree.js';
import * as apiFetchRes from '../../functions/api/fetchRes.js';
import * as apiUploadPolicy from '../../functions/api/uploadPolicy.js';
import * as apiUserConfig from '../../functions/api/userConfig.js';
import * as myAlbums from '../../functions/my-albums.js';
import * as myFiles from '../../functions/my-files.js';
import * as random_index from '../../functions/random/index.js';
import * as upload_index from '../../functions/upload/index.js';
import * as apiAdminUsersCatchAllDiscordId from '../../functions/api/admin/users/[[discordId]].js';
import * as apiManageBlockCatchAllPath from '../../functions/api/manage/block/[[path]].js';
import * as apiManageDeleteCatchAllPath from '../../functions/api/manage/delete/[[path]].js';
import * as apiManageMetadataCatchAllPath from '../../functions/api/manage/metadata/[[path]].js';
import * as apiManageMoveCatchAllPath from '../../functions/api/manage/move/[[path]].js';
import * as apiManageRenameCatchAllPath from '../../functions/api/manage/rename/[[path]].js';
import * as apiManageTagsCatchAllPath from '../../functions/api/manage/tags/[[path]].js';
import * as apiManageWhiteCatchAllPath from '../../functions/api/manage/white/[[path]].js';
import * as apiModerationDeleteCatchAllPath from '../../functions/api/moderation/delete/[[path]].js';
import * as apiModerationQuarantineCatchAllPath from '../../functions/api/moderation/quarantine/[[path]].js';
import * as apiModerationRestoreCatchAllPath from '../../functions/api/moderation/restore/[[path]].js';
import * as apiUserFilesCatchAllPath from '../../functions/api/user/files/[[path]].js';
import * as davCatchAllPath from '../../functions/dav/[[path]].js';
import * as fileCatchAllPath from '../../functions/file/[[path]].js';
import * as thumbCatchAllPath from '../../functions/thumb/[[path]].js';


// ==================== 自动生成的路由表 ====================

const routes = [
    { path: '/api/manage/batch/index/chunk', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"batch"},{"type":"static","value":"index"},{"type":"static","value":"chunk"}], module: apiManageBatchIndexChunk, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/batch/index/config', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"batch"},{"type":"static","value":"index"},{"type":"static","value":"config"}], module: apiManageBatchIndexConfig, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/batch/index/finalize', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"batch"},{"type":"static","value":"index"},{"type":"static","value":"finalize"}], module: apiManageBatchIndexFinalize, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/batch/restore/chunk', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"batch"},{"type":"static","value":"restore"},{"type":"static","value":"chunk"}], module: apiManageBatchRestoreChunk, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/public/gallery/:ownerSlug/:albumSlug', segments: [{"type":"static","value":"api"},{"type":"static","value":"public"},{"type":"static","value":"gallery"},{"type":"dynamic","name":"ownerSlug","array":false},{"type":"dynamic","name":"albumSlug","array":false}], module: apiPublicGalleryParamOwnerSlugParamAlbumSlug, middlewares: [mw_api] },
    { path: '/api/user/albums/:id/charinfo', segments: [{"type":"static","value":"api"},{"type":"static","value":"user"},{"type":"static","value":"albums"},{"type":"dynamic","name":"id","array":true},{"type":"static","value":"charinfo"}], module: apiUserAlbumsCatchAllIdCharinfo, middlewares: [mw_api, mw_api_user] },
    { path: '/api/user/albums/:id/items', segments: [{"type":"static","value":"api"},{"type":"static","value":"user"},{"type":"static","value":"albums"},{"type":"dynamic","name":"id","array":true},{"type":"static","value":"items"}], module: apiUserAlbumsCatchAllIdItems, middlewares: [mw_api, mw_api_user] },
    { path: '/api/auth/discord/callback', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"discord"},{"type":"static","value":"callback"}], module: apiAuthDiscordCallback, middlewares: [mw_api] },
    { path: '/api/manage/batch/list', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"batch"},{"type":"static","value":"list"}], module: apiManageBatchList, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/batch/settings', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"batch"},{"type":"static","value":"settings"}], module: apiManageBatchSettings, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/cusConfig/blockip', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"cusConfig"},{"type":"static","value":"blockip"}], module: apiManageCusConfigBlockip, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/cusConfig/blockipList', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"cusConfig"},{"type":"static","value":"blockipList"}], module: apiManageCusConfigBlockipList, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/cusConfig/files', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"cusConfig"},{"type":"static","value":"files"}], module: apiManageCusConfigFiles, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/cusConfig/list', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"cusConfig"},{"type":"static","value":"list"}], module: apiManageCusConfigList, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/cusConfig/whiteip', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"cusConfig"},{"type":"static","value":"whiteip"}], module: apiManageCusConfigWhiteip, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/delete/batch', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"delete"},{"type":"static","value":"batch"}], module: apiManageDeleteBatch, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/sysConfig/others', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"sysConfig"},{"type":"static","value":"others"}], module: apiManageSysConfigOthers, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/sysConfig/page', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"sysConfig"},{"type":"static","value":"page"}], module: apiManageSysConfigPage, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/sysConfig/security', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"sysConfig"},{"type":"static","value":"security"}], module: apiManageSysConfigSecurity, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/sysConfig/upload', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"sysConfig"},{"type":"static","value":"upload"}], module: apiManageSysConfigUpload, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/tags/autocomplete', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"tags"},{"type":"static","value":"autocomplete"}], module: apiManageTagsAutocomplete, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/tags/batch', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"tags"},{"type":"static","value":"batch"}], module: apiManageTagsBatch, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/public/charinfo/:albumId', segments: [{"type":"static","value":"api"},{"type":"static","value":"public"},{"type":"static","value":"charinfo"},{"type":"dynamic","name":"albumId","array":false}], module: apiPublicCharinfoParamAlbumId, middlewares: [mw_api] },
    { path: '/api/user/albums/:id', segments: [{"type":"static","value":"api"},{"type":"static","value":"user"},{"type":"static","value":"albums"},{"type":"dynamic","name":"id","array":false}], module: apiUserAlbumsParamId, middlewares: [mw_api, mw_api_user] },
    { path: '/api/admin/migrate-kv-files', segments: [{"type":"static","value":"api"},{"type":"static","value":"admin"},{"type":"static","value":"migrate-kv-files"}], module: apiAdminMigrateKvFiles, middlewares: [mw_api, mw_api_admin] },
    { path: '/api/admin/users', segments: [{"type":"static","value":"api"},{"type":"static","value":"admin"},{"type":"static","value":"users"}], module: apiAdminUsers_index, middlewares: [mw_api, mw_api_admin] },
    { path: '/api/auth/adminLogin', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"adminLogin"}], module: apiAuthAdminLogin, middlewares: [mw_api] },
    { path: '/api/auth/discord', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"discord"}], module: apiAuthDiscord_index, middlewares: [mw_api] },
    { path: '/api/auth/login', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"login"}], module: apiAuthLogin, middlewares: [mw_api] },
    { path: '/api/auth/logout', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"logout"}], module: apiAuthLogout, middlewares: [mw_api] },
    { path: '/api/auth/me', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"me"}], module: apiAuthMe, middlewares: [mw_api] },
    { path: '/api/auth/resetAuth', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"resetAuth"}], module: apiAuthResetAuth, middlewares: [mw_api] },
    { path: '/api/auth/sessionCheck', segments: [{"type":"static","value":"api"},{"type":"static","value":"auth"},{"type":"static","value":"sessionCheck"}], module: apiAuthSessionCheck, middlewares: [mw_api] },
    { path: '/api/bing/wallpaper', segments: [{"type":"static","value":"api"},{"type":"static","value":"bing"},{"type":"static","value":"wallpaper"}], module: apiBingWallpaper_index, middlewares: [mw_api] },
    { path: '/api/manage/apiTokens', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"apiTokens"}], module: apiManageApiTokens, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/list', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"list"}], module: apiManageList, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/manage/quota', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"quota"}], module: apiManageQuota, middlewares: [mw_api, mw_api_manage] },
    { path: '/api/moderation/audit', segments: [{"type":"static","value":"api"},{"type":"static","value":"moderation"},{"type":"static","value":"audit"}], module: apiModerationAudit, middlewares: [mw_api, mw_api_moderation] },
    { path: '/api/moderation/files', segments: [{"type":"static","value":"api"},{"type":"static","value":"moderation"},{"type":"static","value":"files"}], module: apiModerationFiles, middlewares: [mw_api, mw_api_moderation] },
    { path: '/api/public/discover', segments: [{"type":"static","value":"api"},{"type":"static","value":"public"},{"type":"static","value":"discover"}], module: apiPublicDiscover_index, middlewares: [mw_api] },
    { path: '/api/public/list', segments: [{"type":"static","value":"api"},{"type":"static","value":"public"},{"type":"static","value":"list"}], module: apiPublicList, middlewares: [mw_api] },
    { path: '/api/user/albums', segments: [{"type":"static","value":"api"},{"type":"static","value":"user"},{"type":"static","value":"albums"}], module: apiUserAlbums_index, middlewares: [mw_api, mw_api_user] },
    { path: '/api/user/files', segments: [{"type":"static","value":"api"},{"type":"static","value":"user"},{"type":"static","value":"files"}], module: apiUserFiles_index, middlewares: [mw_api, mw_api_user] },
    { path: '/api/user/handle', segments: [{"type":"static","value":"api"},{"type":"static","value":"user"},{"type":"static","value":"handle"}], module: apiUserHandle, middlewares: [mw_api, mw_api_user] },
    { path: '/gallery/:ownerSlug/:albumSlug', segments: [{"type":"static","value":"gallery"},{"type":"dynamic","name":"ownerSlug","array":false},{"type":"dynamic","name":"albumSlug","array":false}], module: galleryParamOwnerSlugParamAlbumSlug, middlewares: [] },
    { path: '/upload/huggingface/commitUpload', segments: [{"type":"static","value":"upload"},{"type":"static","value":"huggingface"},{"type":"static","value":"commitUpload"}], module: uploadHuggingfaceCommitUpload, middlewares: [mw_upload] },
    { path: '/upload/huggingface/completeMultipart', segments: [{"type":"static","value":"upload"},{"type":"static","value":"huggingface"},{"type":"static","value":"completeMultipart"}], module: uploadHuggingfaceCompleteMultipart, middlewares: [mw_upload] },
    { path: '/upload/huggingface/getUploadUrl', segments: [{"type":"static","value":"upload"},{"type":"static","value":"huggingface"},{"type":"static","value":"getUploadUrl"}], module: uploadHuggingfaceGetUploadUrl, middlewares: [mw_upload] },
    { path: '/api/channels', segments: [{"type":"static","value":"api"},{"type":"static","value":"channels"}], module: apiChannels, middlewares: [mw_api] },
    { path: '/api/directoryTree', segments: [{"type":"static","value":"api"},{"type":"static","value":"directoryTree"}], module: apiDirectoryTree, middlewares: [mw_api] },
    { path: '/api/fetchRes', segments: [{"type":"static","value":"api"},{"type":"static","value":"fetchRes"}], module: apiFetchRes, middlewares: [mw_api] },
    { path: '/api/uploadPolicy', segments: [{"type":"static","value":"api"},{"type":"static","value":"uploadPolicy"}], module: apiUploadPolicy, middlewares: [mw_api] },
    { path: '/api/userConfig', segments: [{"type":"static","value":"api"},{"type":"static","value":"userConfig"}], module: apiUserConfig, middlewares: [mw_api] },
    { path: '/my-albums', segments: [{"type":"static","value":"my-albums"}], module: myAlbums, middlewares: [] },
    { path: '/my-files', segments: [{"type":"static","value":"my-files"}], module: myFiles, middlewares: [] },
    { path: '/random', segments: [{"type":"static","value":"random"}], module: random_index, middlewares: [mw_random] },
    { path: '/upload', segments: [{"type":"static","value":"upload"}], module: upload_index, middlewares: [mw_upload] },
    { path: '/api/admin/users/*discordId', segments: [{"type":"static","value":"api"},{"type":"static","value":"admin"},{"type":"static","value":"users"},{"type":"catchAll","name":"discordId","array":true}], module: apiAdminUsersCatchAllDiscordId, middlewares: [mw_api, mw_api_admin], catchAll: true },
    { path: '/api/manage/block/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"block"},{"type":"catchAll","name":"path","array":true}], module: apiManageBlockCatchAllPath, middlewares: [mw_api, mw_api_manage], catchAll: true },
    { path: '/api/manage/delete/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"delete"},{"type":"catchAll","name":"path","array":true}], module: apiManageDeleteCatchAllPath, middlewares: [mw_api, mw_api_manage], catchAll: true },
    { path: '/api/manage/metadata/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"metadata"},{"type":"catchAll","name":"path","array":true}], module: apiManageMetadataCatchAllPath, middlewares: [mw_api, mw_api_manage], catchAll: true },
    { path: '/api/manage/move/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"move"},{"type":"catchAll","name":"path","array":true}], module: apiManageMoveCatchAllPath, middlewares: [mw_api, mw_api_manage], catchAll: true },
    { path: '/api/manage/rename/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"rename"},{"type":"catchAll","name":"path","array":true}], module: apiManageRenameCatchAllPath, middlewares: [mw_api, mw_api_manage], catchAll: true },
    { path: '/api/manage/tags/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"tags"},{"type":"catchAll","name":"path","array":true}], module: apiManageTagsCatchAllPath, middlewares: [mw_api, mw_api_manage], catchAll: true },
    { path: '/api/manage/white/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"manage"},{"type":"static","value":"white"},{"type":"catchAll","name":"path","array":true}], module: apiManageWhiteCatchAllPath, middlewares: [mw_api, mw_api_manage], catchAll: true },
    { path: '/api/moderation/delete/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"moderation"},{"type":"static","value":"delete"},{"type":"catchAll","name":"path","array":true}], module: apiModerationDeleteCatchAllPath, middlewares: [mw_api, mw_api_moderation], catchAll: true },
    { path: '/api/moderation/quarantine/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"moderation"},{"type":"static","value":"quarantine"},{"type":"catchAll","name":"path","array":true}], module: apiModerationQuarantineCatchAllPath, middlewares: [mw_api, mw_api_moderation], catchAll: true },
    { path: '/api/moderation/restore/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"moderation"},{"type":"static","value":"restore"},{"type":"catchAll","name":"path","array":true}], module: apiModerationRestoreCatchAllPath, middlewares: [mw_api, mw_api_moderation], catchAll: true },
    { path: '/api/user/files/*path', segments: [{"type":"static","value":"api"},{"type":"static","value":"user"},{"type":"static","value":"files"},{"type":"catchAll","name":"path","array":true}], module: apiUserFilesCatchAllPath, middlewares: [mw_api, mw_api_user], catchAll: true },
    { path: '/dav/*path', segments: [{"type":"static","value":"dav"},{"type":"catchAll","name":"path","array":true}], module: davCatchAllPath, middlewares: [mw_dav], catchAll: true },
    { path: '/file/*path', segments: [{"type":"static","value":"file"},{"type":"catchAll","name":"path","array":true}], module: fileCatchAllPath, middlewares: [mw_file], catchAll: true },
    { path: '/thumb/*path', segments: [{"type":"static","value":"thumb"},{"type":"catchAll","name":"path","array":true}], module: thumbCatchAllPath, middlewares: [], catchAll: true },
];


// ==================== 路由匹配 ====================

function matchRoute(pathname) {
    const pathSegments = pathname.split('/').filter(Boolean);
    for (const route of routes) {
        const params = {};
        let pathIndex = 0;
        let matched = true;

        for (const segment of route.segments) {
            if (segment.type === 'catchAll') {
                params[segment.name] = pathSegments.slice(pathIndex);
                pathIndex = pathSegments.length;
                break;
            }

            const pathSegment = pathSegments[pathIndex];
            if (pathSegment === undefined || (segment.type === 'static' && pathSegment !== segment.value)) {
                matched = false;
                break;
            }

            if (segment.type === 'dynamic') {
                params[segment.name] = segment.array ? [pathSegment] : pathSegment;
            }
            pathIndex += 1;
        }

        if (matched && pathIndex === pathSegments.length) return { route, params };
    }
    return null;
}


// ==================== 中间件链执行 ====================

function collectMiddlewares(middlewareModules) {
    const handlers = [];
    for (const mod of middlewareModules) {
        if (mod.onRequest) {
            if (Array.isArray(mod.onRequest)) {
                handlers.push(...mod.onRequest);
            } else {
                handlers.push(mod.onRequest);
            }
        }
    }
    return handlers;
}

function createNextRequest(input, init, baseRequest) {
    if (input instanceof Request) {
        return init ? new Request(input, init) : input;
    }

    const url = new URL(input, baseRequest.url).toString();
    return new Request(url, init);
}

async function executeChain(middlewares, handler, context) {
    const chain = [...middlewares, handler];
    let index = 0;
    context.next = async function (input, init) {
        if (input !== undefined) {
            context.request = createNextRequest(input, init, context.request);
        }

        if (index < chain.length) {
            return await chain[index++](context);
        }
        return new Response('Not Found', { status: 404 });
    };
    return await context.next();
}


// ==================== Worker Cache ====================

// 统一缓存键，HEAD 与 GET 共用完整 GET 响应缓存
function createCacheKeyRequest(request) {
    return new Request(request.url, {
        method: 'GET',
        headers: request.headers,
    });
}

// 解析 Cache-Control 指令，支持 max-age/s-maxage 等数值字段
function parseCacheDirective(cacheControl, directive) {
    if (!cacheControl) return null;

    const directives = cacheControl.split(',');
    for (const rawDirective of directives) {
        const part = rawDirective.trim();
        const eqIndex = part.indexOf('=');
        const name = (eqIndex === -1 ? part : part.slice(0, eqIndex)).trim().toLowerCase();

        if (name !== directive) continue;
        if (eqIndex === -1) return true;

        const value = part.slice(eqIndex + 1).trim().replace(/^"|"$/g, '');
        const seconds = Number.parseInt(value, 10);
        return Number.isFinite(seconds) ? seconds : null;
    }

    return null;
}

function responseHasCacheDirective(cacheControl, directive) {
    return parseCacheDirective(cacheControl, directive) !== null;
}

function getResponseCacheTtl(response) {
    const cacheControl = response.headers.get('Cache-Control') || '';
    const sMaxAge = parseCacheDirective(cacheControl, 's-maxage');
    if (typeof sMaxAge === 'number') return sMaxAge;

    const maxAge = parseCacheDirective(cacheControl, 'max-age');
    if (typeof maxAge === 'number') return maxAge;

    return null;
}

function isCacheLookupRequest(request) {
    return request.method === 'GET' || request.method === 'HEAD';
}

// 只写入完整 GET 响应，Range 请求仅尝试命中已有完整缓存
function isCacheStoreRequest(request) {
    return request.method === 'GET' && !request.headers.has('Range');
}

function isCacheableResponse(request, response) {
    if (!isCacheStoreRequest(request)) return false;
    if (response.status !== 200) return false;
    if (response.headers.has('Set-Cookie')) return false;

    const cacheControl = response.headers.get('Cache-Control') || '';
    if (!responseHasCacheDirective(cacheControl, 'public')) return false;
    if (responseHasCacheDirective(cacheControl, 'private')) return false;
    if (responseHasCacheDirective(cacheControl, 'no-store')) return false;
    if (responseHasCacheDirective(cacheControl, 'no-cache')) return false;

    const ttl = getResponseCacheTtl(response);
    return ttl !== null && ttl > 0;
}

function responseFromHeadCache(cachedResponse) {
    return new Response(null, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: cachedResponse.headers,
    });
}

async function maybeServeFromCache(request, ctx, producer) {
    if (!isCacheLookupRequest(request)) {
        return await producer();
    }

    const cache = caches.default;
    const cacheKey = createCacheKeyRequest(request);
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
        return request.method === 'HEAD'
            ? responseFromHeadCache(cachedResponse)
            : cachedResponse;
    }

    const response = await producer();

    // 按业务代码返回的 Cache-Control 决定是否写入 Worker Cache
    if (isCacheableResponse(request, response)) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(error => {
            console.warn('Failed to store response in Worker cache:', error.message);
        }));
    }

    return response;
}


// ==================== Worker 入口 ====================

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        const matched = matchRoute(pathname);

        if (!matched) {
            if (env.ASSETS) {
                return env.ASSETS.fetch(request);
            }
            return new Response('Not Found', { status: 404 });
        }

        const { route, params } = matched;
        const mod = route.module;

        const method = request.method.toUpperCase();
        const methodHandlerName = 'onRequest' + method.charAt(0) + method.slice(1).toLowerCase();

        let handler = null;
        if (typeof mod[methodHandlerName] === 'function') {
            handler = mod[methodHandlerName];
        } else if (mod.onRequest) {
            handler = typeof mod.onRequest === 'function'
                ? mod.onRequest
                : mod.onRequest[mod.onRequest.length - 1];
        }

        if (!handler) {
            return new Response('Method Not Allowed', { status: 405 });
        }

        const middlewares = collectMiddlewares(route.middlewares);

        if (Array.isArray(mod.onRequest) && mod.onRequest.length > 1 &&
            handler === mod.onRequest[mod.onRequest.length - 1]) {
            middlewares.push(...mod.onRequest.slice(0, -1));
        }

        const context = {
            request,
            env,
            params,
            functionPath: route.path.endsWith('/') && route.path !== '/'
                ? route.path.slice(0, -1)
                : route.path,
            waitUntil: ctx.waitUntil.bind(ctx),
            passThroughOnException: () => {},
            next: null,
            data: {},
        };

        const executeRoute = () => executeChain(middlewares, handler, context);
        const routeHandlesRevalidation = pathname.startsWith('/file/')
            || pathname.startsWith('/thumb/')
            || pathname.startsWith('/api/public/gallery/')
            || pathname.startsWith('/api/public/charinfo/');
        if (routeHandlesRevalidation) return await executeRoute();
        return await maybeServeFromCache(request, ctx, executeRoute);
    },
};
