# CharInfo Album 接入契约

本文面向后续 CharInfo Manager 接入开发。ImgBed 管理文件、相册成员、顺序和权限；CharInfo Manager／SillyTavern 世界书管理 NPC 文本、档案、配色、台词、metadata 和当前图片来源。一个 NPC 最多引用一个远程相册 URL。本文未实现跨站编辑桥，也不要求第二套角色数据库、令牌或同步服务。

## 稳定只读接口

`GET /api/public/album-gallery/{albumId}` 使用创建相册时返回的小写 UUID。相册改名、修改 slug 或所有者公开用户名都不改变这个 URL 或协议 ID。无需登录，跨域读取应使用 `credentials: 'omit'`。

空相册响应示例：

```json
{
  "format": "char-info-gallery-pack",
  "version": 1,
  "packId": "12345678-1234-4234-8234-123456789abc",
  "profileId": "12345678-1234-4234-8234-123456789abc",
  "characterName": "旅行者",
  "avatarThumbnail": null,
  "libraryThumbnail": null,
  "gallery": []
}
```

媒体条目形如：

```json
{
  "title": "立绘.png",
  "sources": ["https://imgbed.example/file/users/owner/uuid.png?v=1"],
  "thumbnail": "https://imgbed.example/thumb/users/owner/uuid.png?v=1",
  "viewerVisible": false
}
```

- `characterName` 来自 `albums.char_info_character_name`；缺失、超过 80 个字符或含控制字符时返回 409，不用相册名称补全。
- `packId` 与 `profileId` 均为相册 UUID，满足 `[a-z0-9][a-z0-9._-]{0,63}`。不包含 Discord ID、用户名、Cookie、令牌或角色 metadata。
- 只输出审核状态为 `active` 且文件所有者账号有效的媒体；支持 PNG/JPG/JPEG/GIF/APNG/WebP/AVIF/MP4/WebM HTTPS 直链。历史不支持的格式只在协议出口过滤，原文件不变。历史文件标题中的控制字符在新接口展示时换成空格；数据库名称与旧接口不变。
- 顺序以 `album_items.position, created_at` 为准。旧展示设置中的隐藏标记仍有效；`mainFileId` 不覆盖这个新接口的成员顺序。头像和列表预览沿用有效的旧图片选择，失效时取第一张支持的图片，并分别返回现有 `avatar`（160px）与 `library`（256px）缩略图变体及内容版本；空相册或纯视频相册为 null。图片条目使用现有缩略图，视频条目的 `thumbnail` 为 null，v1 解析器将其视为缺省。
- GET 和 OPTIONS 提供只读 CORS，不允许跨域带 Cookie 写入。OPTIONS 返回 204；其他方法由 Worker 返回 405。
- 成功和 304 响应提供 `Cache-Control: public, max-age=60`、ETag 和跨域可读的 ETag 响应头。ETag 使用实际 JSON 的 SHA-256，涵盖增删、顺序、文件名、缩略图版本和展示选择；`If-None-Match` 支持单个／多个标识、弱标识和 `*`。相册名称或用户名变化而 JSON 不变时 ETag 可以不变。客户端仍受自身刷新周期及最多 60 秒 HTTP 缓存影响。
- 非法 UUID 为 400；相册不存在、所有者不存在或停用为 404；缺少有效 CharInfo 姓名为 409；D1 未绑定或查询失败为 503。错误响应不缓存。

**分享边界：** 当前相册的 `unlisted` 并不表示严格私密授权。共享相册中的文件，即使文件标记为 `private`，仍可由持链接者读取；该标记控制公开发现等入口，不是相册分享口令。新接口复用 `listSharedAlbumFiles`，没有扩大这一既有范围。不要将敏感资料放入共享相册。

## 同源创建、上传与维护

1. 通过 ImgBed 既有 Discord OAuth 登录；HttpOnly 会话 Cookie 归 ImgBed 域名所有。上传及写操作由 ImgBed 同源页面执行，不让 ST 跨站携带 Cookie 修改资源。
2. `POST /api/user/albums`，JSON 例如 `{"name":"旅行者","charInfoCharacterName":"旅行者"}`。返回 201 和 `{id, slug, name, description, charInfoCharacterName}`，其中 `id` 就是 `albumId`。可省略 slug；纯中文／日文等无法生成英文 slug 时使用 `npc-{UUID}`。显式 slug 须为最多 80 位字母、数字、单短横线分段，可做首尾去空格及转小写；非法为 400、同一所有者下 slug 冲突为 409，不覆盖旧相册。无需为新 UUID 读取接口设置公开用户名。
3. 同源以 `multipart/form-data` 调用 `POST /upload`（文件字段 `file`），遵循已有渠道设置、类型、95 MB 上限和配额。成功仍返回数组，例如 `[{"src":"/file/users/owner/uuid.png","fileId":"users/owner/uuid.png"}]`；已有 `publicUrl` 和审核字段在原本提供它们的路径保持原样。使用服务端 `fileId`，不要从 URL 反向解析。R2、Telegram、Discord 为当前可用渠道；HuggingFace 返回 503，S3/WebDAV 返回 410，本次不恢复它们。
4. `POST /api/user/albums/{albumId}/items`，JSON `{"fileId":"users/owner/uuid.png","position":0}`。成员接口只接受本人相册及本人文件。返回 `{"success":true}` 后，保存唯一只读 URL `/api/public/album-gallery/{albumId}` 到世界书。
5. 成员顺序：`PATCH /api/user/albums/{albumId}/items`，JSON `{"fileId":"...","swapWithFileId":"..."}`，交换两个现有成员位置。移除成员：`DELETE /api/user/albums/{albumId}/items?fileId={编码后的完整ID}`，只移除成员及对应封面引用，原文件和存储对象保留。相册名称、slug、角色名和封面使用 `PATCH /api/user/albums/{albumId}`；封面可传 `coverFileId`、`coverPositionX`、`coverPositionY`，并且必须是相册内审核通过的图片。永久删除文件必须另行明确调用既有文件删除流程。
6. 玩家 B 持 A 的 URL 只能公开读取，不能修改 A 的相册；B 可删除本地引用或改用自己的 Album URL／Catbox 直链。解除世界书引用完全不调用 ImgBed 写接口，不自动复制素材、Fork 或转移归属。

所有账户写接口先经过 `functions/api/user/_middleware.js` 的 `rejectCrossSiteMutation`，再验证 Discord 会话及服务端归属；不相信请求中的 `ownerId`／`isOwner`。现有站点 `owner` 管理角色在相册详情修改（包括封面）／删除等既有授权处保留跨相册管理权；成员和 CharInfo 配置仍要求真实相册所有者，普通 `admin` 不因此获得写权限。

账户相册详情 GET：未登录 401、普通非所有者 403、不存在 404。成员写接口及旧 CharInfo 配置接口对不存在／非所有者均返回 404；前端不能仅凭 404 就认定相册已被删除。跨站修改为 403；客户端须同时处理配额不足、审核中、上传渠道不可用和服务器错误，优先展示接口返回的错误说明。

## 部分成功与未来弹窗桥

上传成功但入相册失败时保留 `fileId` 和原文件，让用户重试关联；相册创建成功而上传失败时保留 `albumId`，不要反复创建相册。审核中／隔离的文件即使上传完成，也不保证马上出现在公共 Gallery Pack。任何后续步骤失败都不得覆盖原 ST 世界书或偷偷删除存储文件；仅在拿到有效完整结果后，由用户确认更新引用。

未来若增加同源编辑弹窗桥，必须定义可配置、明确的允许来源；严格核对发起方 origin、`postMessage` 的准确 `targetOrigin`、单次 nonce、`event.source` 和消息结构。不要使用通配目标域，不向 ST 发送 HttpOnly Cookie 或 OAuth token。每次写入仍由 ImgBed 服务器验权。本次只规定契约，不实现消息通道。

## 旧系统兼容审计

| 分类 | 实际证据与影响面 |
| --- | --- |
| 仍在使用 | `frontend-dist/charinfo/index.html` 的 `loadAlbumProfileFromQuery` 先读 `/api/user/albums/{id}/charinfo`，只读回退再读 `/api/public/charinfo/{id}`；账户页 `account/account.js` 仍生成视觉包链接和 Creator 编辑入口。删除任一路由会破坏当前网页载入。 |
| 仍在使用 | `/api/user/charinfo/complete` 写 `other_data` 的 `charinfo.visual:{albumId}`（type 为 `charinfo_visual`），返回旧 `?view=gallery` URL；`frontend-src/charinfo/hosted-workflow.js` 消费完成接口。`charInfoVisualConfig.js` 负责校验、规范化、存储键；`charInfoVisualPack.js` 被旧公开视觉包和两个 Gallery 视图复用。 |
| 仍在使用 | 默认 `/api/public/charinfo/{id}` 继续返回 `char-info-visual-pack`；`?view=gallery` 保持现有 owner handle 的 `packId`、UUID 的 `profileId`、主图置前和隐藏设置。新引用统一使用独立 `/api/public/album-gallery/{id}`，不向 ST 覆盖文本或 metadata。 |
| 仍在使用 | `/api/public/gallery/{ownerSlug}/{albumSlug}` 继续支持 CharInfo 与普通 `imgbed-gallery` 相册，输出形状不变。欢迎页、侧栏仍链接 `/charinfo/`；`worldbookUi`、`charInfoStableUrl`、`charInfoVisualConfig`、`charInfoCompletion` 和 `gallerySharing` 测试覆盖现有路径。 |
| 仅为兼容保留 | `frontend-dist/_redirects` 将 `/charinfo/worldbook` 和尾斜杠形式重定向到现 Creator。旧 CharInfo 配置 PUT／DELETE 路由仍可维护历史展示配置；当前网页读取它们，保存则走原子完成接口。外部调用者数量未知，不能据此删除写接口。 |
| 确认无引用且可后续移除 | 本次检查未确认可安全删除的相关代码或历史键。无删除建议。 |
| 未知（需线上证据） | 外部保存的 Visual Pack／旧 Gallery URL 数量、配置 PUT／DELETE 的外部使用情况、线上 `other_data` 历史值分布。本次没有读取远端 D1 或访问日志，不据本地代码推断线上无人使用。 |

保留旧 API、Creator、数据库表／字段、历史键值和测试；不增加角色文本编辑能力。CharInfo Manager 后续需完成同源编辑入口、可选弹窗桥及世界书引用更新，均不在本仓库这次实现范围内。

## 验证边界

`test/albumGallery.test.js` 用内存 SQLite 执行真实查询及成员写接口，验证协议、分享过滤、顺序、ID 稳定和 ETag；`test/albumIntegrationMutations.test.js` 经用户中间件验证身份、跨站请求和归属；`test/uploadFileId.test.js` 使用模拟存储与服务验证上传返回。`test/workerAdapter.test.js` 通过 Worker 构建后的实际路由验证新路径、OPTIONS、只读方法和缓存绕过。

这些测试不代表真实 Discord OAuth、线上 D1、真实存储服务或跨站弹窗已端到端验证。当前没有部署或远程迁移，也未修改 CharInfo Manager 仓库。
