# CloudFlare ImgBed — Community / Creator Platform Redesign Proposal

> 面向 Codex 的产品、设计与实现 Brief  
> 目标分支基线：`staging`  
> Discover 参考原型：`cloudflare_imgbed_community_preview.html`（对应 `/discover/`，不是默认首页）

---

## 0. Codex 开始前必须理解的事情

这不是一次单纯的「换首页 UI」或「把上传页改漂亮」的任务。

CloudFlare ImgBed 的产品方向是从：

> **以上传工具为中心的图床**

逐步转成：

> **受控的 Featured 欢迎页 + 独立公开发现页 + Creator Profile + 登录后的个人媒体管理空间**

核心体验应当是：

- 未登录访客首先看到轻量欢迎页，以及一个由站点运营者控制的 Featured 作品
- 用户主动进入 Discover 后，可以像逛 Pinterest / ArtStation 的轻量版本一样浏览公开图片和视频
- 上传和个人管理仍然是核心能力，并从欢迎页提供直接入口
- 上传需要登录
- 登录后进入自己的 Creator / Personal Space
- 用户可以管理自己的文件、图库、公开主页，以及决定哪些内容可以公开展示
- 管理员审核与普通用户的个人管理必须明确分开

参考 HTML 是 `/discover/` 的**产品体验和设计方向原型**，不是默认首页或生产代码模板。

Codex 不应直接复制原型结构塞进现有项目，而应：

1. 先审计 `staging` 当前前端、API、身份、图库、文件管理和管理员功能
2. 尽量复用现有功能和接口
3. 设计合理的生产结构
4. 保留现有已经工作的上传、文件管理、图库、Discord 身份和管理员功能
5. 再逐步迁移到新信息架构和设计语言

---

# 1. 产品定位

## 1.1 新的产品结构

产品分成两个明显区域。

### A. Public Community

任何人无需登录即可访问。

主要用途：

- 浏览公开内容
- 浏览 Featured / Explore
- 打开图片或视频详情
- 浏览 Creator Profile
- 浏览 Creator 的公开图库
- 复制公开资源链接
- 通过公开内容发现其他创作者

它的视觉和体验应该更像：

- Pinterest
- ArtStation 的轻量发现页
- 一个现代作品档案馆

而不是后台管理系统。

### B. Personal Studio

只有登录用户进入。

主要用途：

- 上传图片 / GIF / WebP / AVIF / MP4
- 查看自己的全部上传文件
- 管理文件
- 管理图库 / Album
- 设置公开与非公开
- 编辑自己的 Creator Profile
- 管理哪些图库出现在个人公开主页
- 查看自己的公开页面

它应该更像：

- 创作者工作台
- 图片文件管理 App
- 媒体资产管理器

而不是公共作品社区。

---

# 2. 最重要的信息架构

建议顶层 IA：

```text
Public
├─ Welcome / Featured landing
├─ Discover
│  ├─ Featured
│  ├─ Explore
│  └─ Recent
├─ Creator Profile
│  ├─ Public Albums
│  └─ Recent Public Media
├─ Public Album
└─ Public Media Detail

Authenticated
├─ My Files
├─ Albums
├─ Public Profile
└─ Upload

Admin only
├─ Moderation / Content Management
├─ Users
└─ Audit Log
```

不要把普通用户的：

- My Files
- Albums
- Profile

和管理员的：

- Moderation
- Users
- Audit

混在同一个概念层级里。

---

# 3. 公共入口

默认首页 `/` 是轻量的 **Welcome / Featured landing**。它提供上传、Discover 与 CharInfo Creator 入口，并只展示一项由站点运营者控制的 Featured 作品。

完整的公共目录位于 `/discover/`。Recent Feed、公开图库、筛选与无限滚动只在访客主动进入 Discover 后加载。

## 3.1 Header

桌面：

```text
ImgBed
首页
Discover
CharInfo Creator

Login
Upload
```

登录后：

```text
ImgBed
首页
Discover
CharInfo Creator

My Studio / Avatar
Upload
```

手机端应使用适合单手操作的简化导航。

## 3.2 Welcome / Featured

首页第一屏以一项 Featured 内容作为视觉焦点，同时提供明确的上传与 Discover 操作。

页面每次只渲染一项媒体；有多项候选内容时，访问者可以在候选集合内切换。Featured 视频不自动播放，也不在用户播放前预加载。没有可用 Featured 内容时显示空状态，不加载 Recent Feed 作为回退。

欢迎页保持内容导向，不加入 “Why choose us”、Pricing、企业式 KPI 或大规模功能 icon grid。

## 3.3 请求边界

```text
/           身份状态 + 最多 12 项 Featured 清单；页面渲染其中 1 项
/discover/  Featured + Recent Feed + 公开图库 + 筛选与分页
```

Featured API 响应的浏览器缓存时间为 60 秒、Cache API 边缘缓存时间为 5 分钟；欢迎页把 Featured 清单缓存 10 分钟，并可在请求失败时复用 24 小时内的旧清单。默认入口不得加载公开图库、Recent Feed 或无限滚动，也不得在 Featured 为空或读取失败时自动请求完整 Discover 数据。

## 3.4 Featured

Featured 显示少量人工或规则挑选的优秀公开作品。

v1 不需要复杂算法。

推荐初期逻辑：

```text
Public
+
未被 moderation 撤下
+
允许进入 Discover
+
按近期 / 管理员精选 / 简单随机规则排序
```

不要一开始就做：

- Likes
- Followers
- Comments
- Recommendation AI
- Trending score
- Social graph

这些都不是当前目标。

## 3.5 Explore

使用图片优先的瀑布流。

要求：

- 图片比例保留
- MP4 / GIF 有明确类型提示
- 视频最好能有 poster / preview
- 不要所有内容强制裁成同样的正方形
- 信息层级尽量轻
- 图片是视觉主体
- 文件名、作者、图库信息放在次级位置

---

# 4. Public Media Detail

点击 Discover 里的作品，不要直接把用户送到裸文件链接。

先进入 Media Detail。

应该包含：

```text
大图 / 视频
作品标题
Creator
所属公开 Album
必要的文件信息
复制资源链接
打开原始文件
查看 Creator
```

可以使用 modal / lightbox，也可以使用独立 route。

生产实现选择哪种方式，以现有路由结构和移动体验为准。

---

# 5. Creator Profile

每个有公开内容的登录用户都可以有一个公开 Creator Profile。

建议 URL：

```text
/@handle
```

或者复用当前已经存在的 public handle / gallery route。

不要为了漂亮 URL 破坏已有兼容性。

如果现有结构已经是：

```text
/gallery/{ownerSlug}
```

可以先继续使用，之后再决定是否增加 alias。

## 5.1 Profile 内容

Creator Profile 至少包含：

```text
Avatar
Display Name
Handle
Bio

Public Albums
Recent Public Media
```

可选：

```text
Cover Image
External links
```

v1 不需要：

```text
Follower count
Likes
Comments
Message
Social feed
```

---

# 6. Album 应该是公共内容的主要组织方式

公开站不要变成一堆没有上下文的原始文件。

推荐：

> **Public 展示优先以 Album 为组织单位**

例如：

```text
Master
├─ 角色设定图
├─ 地图与场景
└─ 动图与视频
```

文件底层仍属于 My Files。

Album 是展示和整理层。

## 6.1 Album visibility

至少支持：

```text
Private
Public
```

如果现有 backend 已经支持其他 visibility，优先复用。

Public Album：

- 出现在 Creator Profile
- 可以通过公开 URL 浏览
- Album 内公开可展示内容可以进入 Discover

Private Album：

- 仅 Creator 自己管理
- 不出现在 public site

---

# 7. 文件 Visibility 必须明确设计

这里是整个改造里最容易做错的地方。

图床有一个特殊需求：

> “可以通过 URL 访问”  
> 不等于  
> “应该出现在公共作品社区”

因此至少需要明确三个概念。

## 7.1 Private

含义：

- 不应该出现在公共首页
- 不应该出现在 Creator Profile
- 不应该出现在 Public Album
- 具体资源 URL 是否完全禁止访问，需要结合当前 ImgBed 既有行为决定

不要未经审计就改变已有直链安全模型。

## 7.2 Unlisted

含义：

- 文件可以通过资源 URL 使用
- 不会出现在 Discover
- 不会出现在 Creator Profile
- 不会自动进入公共 Album
- 很适合典型“图床使用场景”

这是非常重要的状态。

因为很多用户上传文件只是为了得到 URL。

## 7.3 Public

含义：

- 允许出现在 Creator Profile
- 可以加入 Public Album
- 可以成为 Discover 的候选内容

Public 不等于 Featured。

## 7.4 Featured eligibility

建议不要给普通用户做一个叫“Featured”的直接开关。

可以设计为：

```text
Public
+
discover_eligible
+
moderation pass
```

其中 `discover_eligible` 可以：

- 默认 true
- 或用户可以选择“允许出现在公共发现页”

管理员可以进一步控制 Featured。

---

# 8. Discord 登录流程

未登录用户可以：

```text
浏览 Discover
打开作品
打开 Creator Profile
查看公开 Album
访问公开链接
```

未登录用户执行以下动作时才要求登录：

```text
Upload
My Files
Albums
Edit Profile
```

点击 Upload：

```text
Upload
↓
Discord Login
↓
登录成功
↓
进入 Personal Studio
↓
自动打开 Upload flow
```

不要：

```text
Upload
→ Login
→ 登录成功
→ 又回 Discover
→ 用户自己再找 Upload
```

登录后的下一步必须符合用户刚才的意图。

---

# 9. Personal Studio

Personal Studio 是登录用户真正工作的地方。

建议主导航：

```text
My Files
Albums
Public Profile
Explore
```

Upload 做成明显主操作。

桌面可以：

```text
sidebar + workspace
```

手机可以：

```text
bottom navigation + floating / central upload
```

---

# 10. My Files

这里显示 Creator 的全部上传文件。

包括：

- Public
- Unlisted
- Private
- 图片
- GIF
- MP4

## 10.1 文件卡需要的信息

建议：

```text
Preview
Filename
Size
Upload date
Media type
Visibility
Album membership
Actions
```

不要强迫所有 metadata 永远全部显示。

桌面 hover / action menu 可以承载次级操作。

手机要避免 tiny buttons。

## 10.2 文件操作

至少：

```text
Preview
Copy link
Open original
Change visibility
Add to Album
Move / Rename（如果当前已支持）
Delete
```

批量操作如果现有版本已有，应继续保留。

---

# 11. Albums 管理

Albums 页面应该明显比原先的后台表格更“作品集”。

每个 Album 显示：

```text
Cover
Name
Item count
Visibility
Last updated
Manage
Share
```

Public Album 可以：

```text
Open public page
Copy gallery link
Copy API / feed link（如果现有功能需要）
```

Private Album：

```text
不公开
仍可作为 Creator 自己的组织工具
```

---

# 12. Public Profile 设置

登录用户应该能够编辑：

```text
Display name
Handle
Avatar
Bio
Cover
Homepage display preference
```

Homepage display preference 可以简单做成：

```text
Featured Albums
Recent Public Media
```

不要一开始做高度自由的 profile page builder。

---

# 13. Admin 与普通用户必须分离

当前管理员能力仍然要保留。

Admin only：

```text
Content Moderation
Users
Audit Log
```

普通 Creator 不应该看到一个叫：

```text
内容管理
```

然后以为那是自己文件管理。

建议命名区分：

```text
My Files
```

vs

```text
Moderation
```

---

# 14. 设计语言

参考 `cloudflare_imgbed_community_preview.html`。

但请把它理解为 **design direction**，不是最终组件代码。

## 14.1 Public 区域

视觉目标：

> 作品社区 / 编辑型图库 / 图片优先

特征：

- 暖色纸张或中性色背景
- 大量图片
- 图片保留真实比例
- serif 可以用于大标题和作品标题
- UI chrome 尽量弱
- 少量黑色和橙色作为品牌强调
- 边线可以比大量 rounded card 更常用
- 空间感明显
- 首页不是 dashboard

推荐气质：

```text
Editorial
Gallery
Archive
Creative community
```

## 14.2 Personal Studio

视觉目标：

> 专业、稳定、适合长时间操作的 Creator workspace

特征：

- 深色
- 密度比公共区高
- 清晰 sidebar
- 文件 grid
- Toolbar
- 不依赖巨大 card
- 不滥用 glassmorphism
- 不要紫色 SaaS 模板感
- 上传可以使用 drawer / modal / focused workspace
- 内容管理效率优先

Public 与 Studio 应该明显不同。

但要通过这些东西保持同一品牌：

```text
Logo
Typography rhythm
Accent color
Icon family
Spacing system
Motion
```

---

# 15. 明确禁止的设计倾向

这次不要重新掉回原来的套路。

避免：

```text
深蓝黑背景
+
紫色 glow
+
半透明玻璃
+
所有东西一个 rounded card
```

避免：

- Bento dashboard
- 每一段都包在 card
- 巨大空白 SaaS hero
- 首页堆叠大段功能营销内容
- 过多 gradient
- 过多 glow
- 过度动画
- 为了“高级感”降低信息密度
- 只做桌面版再让 mobile 自动换行

---

# 16. 移动端要求

这个产品很可能经常在手机使用。

Mobile 必须作为正式设计目标。

Public：

- 2-column masonry 为主
- 图片优先
- 可点击区域足够大
- header 简化
- 不强塞 desktop nav

Studio：

- bottom navigation
- Upload 必须容易单手触达
- 文件操作不要依赖 hover
- action menu 要适合触屏
- 不要让页面顶部被 mobile browser / safe area 覆盖
- 支持 `env(safe-area-inset-*)`

---

# 17. 对现有 staging 的实现原则

Codex 必须先审计，再动手。

在开始写代码前检查：

```text
frontend-dist/
frontend-dist/account/
frontend-dist/gallery-app/

functions/api/auth/
functions/api/user/
functions/api/public/
functions/api/manage/
functions/gallery/
functions/upload/
```

重点确认：

```text
现有 Discord auth
user handle
user files
albums
album visibility
public gallery
public list
moderation
upload
file direct URL
current account shell
current mobile behavior
```

---

# 18. 不要重写已经工作的 backend

如果 staging 已经有：

- Discord auth
- Files API
- Albums API
- Public Gallery API
- Moderation
- User handle
- Upload

优先复用。

只有在以下情况才改数据模型：

```text
现有结构确实无法支持：
Public / Unlisted / Private
Creator Profile metadata
Discover feed
```

如果需要 migration：

1. 先写 migration plan
2. 保持旧数据默认安全
3. 不要让旧文件突然全部公开
4. migration 必须可重复/可检测
5. 旧 route 尽可能继续工作

### TODO：统一文件身份与显示名称

- [x] 登录用户的实际存储与永久 `/file/...` URL 统一使用稳定的内部 ID / storage key，例如 `users/<owner>/<uuid>.<ext>`；Discord、Telegram、HuggingFace 也使用该 canonical 名称。
- [x] 登录用户上传时的原始文件名只作为显示 metadata 使用，不参与文件读取路径。
- [ ] 将容易误解的 `file_name` 语义整理为 `display_name` 或 `original_name`；若涉及数据库字段迁移，先保持兼容读取，再逐步切换。
- [ ] 用户修改显示名称时不得改变永久资源 URL，也不得改变 Discord / R2 等底层存储定位。
- [x] 用户上传必须绑定明确 owner；不再创建匿名或 ownerless 文件记录。旧式 automation credential 不再作为绕过登录的上传入口，未来如需 ST 自动上传，应改为 owner-bound Personal API Token。
- [x] 移除 `uploadNameType` 与用户自定义 `uploadFolder`；文件归类改由 Album / Visual Pack 管理，移动分类不得改变永久 URL。
- [x] 移除对外 `/dav/*` WebDAV 服务入口与 External 外链伪上传；WebDAV、Discord、R2、Telegram、S3、HuggingFace 仍可作为管理员控制的 storage backend。
- [ ] 后续 storage 架构允许管理员迁移 origin，或为同一 canonical file 配置多个 origin，以便故障时切换 / fallback；canonical `/file/...` URL 不随 origin 变化。

默认安全策略：

> 旧文件绝不能因为新功能自动变成 Public

---

# 19. Discover API

建议不要让前端直接拉“所有公共文件然后自己筛”。

应该有独立 public discover endpoint。

例如：

```text
GET /api/public/discover
```

可能参数：

```text
cursor
limit
type
sort
creator
album
```

v1 可支持：

```text
sort=recent
sort=featured
```

返回数据应该足够直接渲染 masonry。

例如：

```text
id
url
thumbnail / preview
mediaType
width
height
title
creator
creatorHandle
album
albumSlug
createdAt
```

不要返回私有 metadata。

---

# 20. 图片和视频 Preview

这是图片社区体验的基础。

Codex 需要审计当前文件 API 是否能安全提供：

```text
thumbnail
poster
transformed preview
```

如果已有 image transform 能力，优先复用。

MP4：

- 必须有合理 preview
- 不要因为 `<video preload>` 导致 Discover 一次加载几十个完整视频
- 推荐 poster / lazy playback
- 只在 viewport / hover / tap 后播放

GIF：

- 考虑 preview 性能
- Discover 不应该同时让几十个大 GIF 一直跑

---

# 21. 路由建议

最终 route 可以根据现有项目调整。

概念上建议：

```text
/                     Welcome / Featured landing
/discover/            Discover：Featured、公开图库与 Recent Feed
/gallery/:owner       Creator Profile 或现有 creator gallery
/gallery/:owner/:album Public Album
/media/:id            Public Media Detail

/account/files        My Files
/account/albums       Albums
/account/profile      Public Profile
```

如果当前 account 实现继续使用：

```text
/account/?view=files
/account/?view=albums
```

也可以先保持。

不要仅为了 route 好看而引入大规模重构。

---

# 22. 分阶段执行

不要一口气做完所有东西。

## Phase 0 — Audit

Codex 先输出：

```text
现有路由
现有 auth
现有 file model
现有 albums
现有 public gallery
现有 moderation
现有 frontend ownership
```

然后列出：

```text
可以直接复用
需要扩展
需要迁移
应该删除 / 替换
```

Audit 完成后再进入实现。

## Phase 1 — Public Entry 与 Discover MVP

目标：

- `/` 使用轻量 Welcome / Featured landing
- `/discover/` 提供完整公开 Discover
- 从现有公开数据读取
- Featured section
- Explore masonry
- 图片 / 视频 preview
- Media lightbox/detail
- Creator link

先不要做复杂算法。

Acceptance：

- 未登录可完整浏览
- 打开 `/` 不加载 Recent Feed、公开图库或无限滚动
- 手机正常
- 视频不造成灾难性流量
- 私有文件绝不出现在 feed

## Phase 2 — Creator Profile

目标：

- Creator public page
- Public Albums
- Recent public media
- handle 路由
- Album 页面

Acceptance：

- 只展示 Public
- Unlisted 不出现在 Profile
- Private 不出现在 Profile
- public URL 可分享

## Phase 3 — Studio IA

把登录后的账户区整理成：

```text
My Files
Albums
Public Profile
Admin
```

保留已有功能。

不要先改 backend。

Acceptance：

- 原有文件管理能力不丢
- 原有批量操作不丢
- 原有 upload 不坏
- mobile navigation 可用

## Phase 4 — Visibility

加入或完善：

```text
Private
Unlisted
Public
```

Acceptance：

```text
Private -> 不在公共站
Unlisted -> 直链可用，但公共站不可发现
Public -> 可进入 Creator Profile / Public Album / Discover candidate
```

旧文件 migration 默认不得 Public。

## Phase 5 — Creator Profile Editor

加入：

```text
display name
handle
bio
avatar
cover
public homepage preference
```

Acceptance：

- 保存后 Creator Profile 正确更新
- 不暴露 Discord 私有数据
- handle 冲突有明确错误

## Phase 6 — Polish

最后再做：

- transitions
- skeleton
- empty states
- media loading
- accessibility
- mobile polish
- keyboard
- focus
- reduced motion
- error handling

---

# 23. 原型 HTML 应该如何使用

文件：

```text
cloudflare_imgbed_community_preview.html
```

把它当作：

```text
visual direction
layout reference
interaction reference
information architecture reference
```

不要把它当作：

```text
生产组件代码
最终 DOM 结构
最终 CSS architecture
后端 contract
```

Codex 应该特别参考：

### Public

- 暖色 gallery 风格
- 大图 Featured
- masonry Explore
- media modal
- Creator Profile
- Public Album 概念

### Studio

- dark workspace
- sidebar
- My Files
- visibility indicator
- Albums
- Profile editor
- upload drawer

可以重新实现组件。

但产品层级和视觉区分不要丢。

---

# 24. 代码结构建议

根据当前 repo 技术栈决定，不要擅自换框架。

如果当前 public / account 是不同入口，可以继续分入口。

推荐至少逻辑拆成：

```text
PublicShell
DiscoverPage
CreatorProfilePage
PublicAlbumPage
MediaViewer

AccountShell
MyFilesPage
AlbumsPage
ProfileSettingsPage
UploadPanel

AdminNav
ModerationPage
UsersPage
AuditPage
```

共享：

```text
MediaThumbnail
MediaPreview
VisibilityBadge
Avatar
Brand
UploadButton
LoadingState
Toast
Dialog
```

不要继续把整套账户功能塞进一个超长 JS 文件。

如果当前 architecture 暂时无法完全拆分，先做最安全的渐进式拆分。

---

# 25. 测试要求

至少增加或更新测试覆盖：

### Auth

```text
public route 不需要 login
account route 需要 login
upload 未登录会进入 auth
```

### Visibility

```text
private 不进入 public API
unlisted 不进入 Discover
public 可以进入 public API
```

### Albums

```text
private album 不公开
public album 可分享
```

### Creator Profile

```text
只能看到公开数据
```

### Moderation

```text
quarantined / removed 内容不能出现在 public feed
```

### Mobile

至少手动验证：

```text
360px
390px
430px
```

桌面至少：

```text
1280px
1440px
```

---

# 26. 性能要求

Discover 会变成媒体密集页面。

必须注意：

- 图片 lazy loading
- 正确 width / height，避免 layout shift
- thumbnail / transform
- 不加载原图作为瀑布流缩略图
- 视频不要默认全部 preload
- pagination / cursor
- 不一次返回全部 public media
- masonry 不允许无限 DOM 增长而完全不分页

---

# 27. 安全 / 隐私原则

这是 public gallery 改造最重要的非视觉部分。

必须保证：

- Discord token / identity 私有数据不能进入 public API
- private file metadata 不进入 public API
- unlisted 不进入 discover index
- moderation removal 必须立刻影响 public visibility
- owner-only mutation 保持鉴权
- public profile 只返回用户主动公开的信息
- filename / EXIF / metadata 是否公开要谨慎

如果原始上传可能带 EXIF：

Codex 应检查当前处理行为。

不要默认把 EXIF 当作公共资料展示。

---

# 28. 暂不做的东西

为了避免 scope 爆炸，以下全部暂时不要做：

```text
likes
comments
follow
DM
notifications
ranking algorithm
creator monetization
NSFW recommendation
AI tagging
full social feed
repost
collections owned by viewers
```

先把：

```text
Discover
Creator
Album
Visibility
Studio
```

做扎实。

---

# 29. Codex 每个阶段应该怎么汇报

每完成一个 Phase，不要只说：

> done

需要报告：

```text
改了什么
为什么这样改
涉及哪些文件
有没有 schema/API 变化
旧功能是否保持
mobile 测试结果
desktop 测试结果
还有什么已知问题
下一阶段建议
```

如果发现原型方案和现有 backend 冲突：

不要偷偷改需求。

明确告诉用户：

```text
原型想要什么
现有系统是什么
冲突在哪里
推荐方案 A
替代方案 B
各自成本
```

---

# 30. 最终设计判断标准

成功不是：

> “页面比旧版更漂亮”

成功应该是：

### 对访客

打开网站马上知道：

> 这里有作品可以逛。

### 对 Creator

登录后马上知道：

> 这里是我的文件、图库和公开空间。

### 对图床用户

仍然可以：

> 上传 → 得到链接 → 不公开。

### 对 Admin

仍然可以：

> 审核 → 撤下 → 恢复 → 管理成员 → 查操作记录。

---

# 31. 给 Codex 的直接执行指令

请从 `staging` 开始。

不要立即重写代码。

第一步先审计现有实现，重点检查：

```text
frontend-dist/account
frontend-dist/gallery-app
Discord auth
user files
albums
public gallery
public list
upload
moderation
user handle
```

然后根据本 proposal 和附带的：

```text
cloudflare_imgbed_community_preview.html
```

输出一个 **Phase 0 Audit + Implementation Plan**。

Audit 需要明确告诉我：

1. 哪些现有能力已经足够支持新方向
2. 哪些需要前端重构
3. 哪些需要 API 扩展
4. 是否需要数据库 migration
5. 如何保证旧文件不会意外公开
6. 如何保留当前上传、文件管理、图库、管理员功能
7. 推荐的第一批实际修改文件
8. 推荐测试方法

在我确认 Audit / Plan 以后，再开始实现大范围改动。

设计上：

- Public 使用图片优先、editorial / gallery 风格
- Studio 使用深色 Creator workspace
- 两边同品牌，但明显不同使用场景
- 不要回到通用紫色 glass SaaS dashboard
- 不要把参考 HTML 直接复制进生产代码
- Mobile 是正式目标，不是桌面版缩小

最终目标是把 CloudFlare ImgBed 从“上传工具首页”推进到：

> **Curated Featured Welcome + Public Discovery + Creator Profiles + Personal Media Studio**

同时保留它作为图床最重要的能力：

> **上传文件、得到链接、并且默认不必公开。**
