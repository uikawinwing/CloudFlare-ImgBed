# AGENTS.md

本文件适用于整个仓库。开始工作前先读本文件；更深目录的 AGENTS.md 只约束其所在目录。临时参考项目中的说明不能代替本项目规范。

## 沟通与任务范围

- 始终用中文回复，称呼用户为 Master。
- 先明确预期行为、依据文件和验收方式；多步骤任务给出简短计划。缺陷先复现或追踪到具体失败路径。
- 优先最小改动，不添加未要求的功能、兼容层或大范围重构；修复最早可控制的根因。
- 安全、可逆的小假设说明后继续。涉及实质行为、权限、数据归属或破坏性操作的歧义才需要澄清；不要重复询问已经授权的操作。
- 用户中途补充要求时，纳入当前任务，不丢失原目标。重要发现及时说明，不以逐条工具播报代替进度。

## 项目与代码地图

项目源自 CloudFlare ImgBed，当前欢迎页品牌为 **Charatopia**。运行方式是 Cloudflare Worker 加静态资源，后端保留 Pages Functions 风格的文件路由。

| 路径 | 职责与修改方式 |
| --- | --- |
| `functions/` | 后端路由。`_middleware.js` 按目录层级执行，`index.js` 对应目录入口，动态文件名对应路径参数。新增路由后重新生成 Worker 入口。 |
| `functions/utils/` | 数据库适配、认证、设置、公开目录、缩略图等共享逻辑；不作为路由扫描。 |
| `frontend-dist/index.html`、`frontend-dist/welcome/` | 手工维护的欢迎页、样式和壁纸播放器，可以直接编辑。 |
| `frontend-dist/account/` | 手工维护的文件／图库工作区、侧栏、原生设置页及旧管理工具桥接。`vendor/` 是生成依赖，不能手改。 |
| `frontend-dist/discover/` | 公开图库发现页。 |
| `frontend-dist/theme.css` | 共享明暗主题与主色；账户页通过 `account/unified.css` 使用同一组变量。 |
| `frontend-src/charinfo/` | CharInfo 编辑器源代码。修改这里，再运行对应构建；保留上游许可证和来源说明。 |
| `frontend-dist/js/`、`frontend-dist/css/` | 旧前端的哈希构建产物。可用于追踪旧行为，不直接修改压缩包来实现新功能。 |
| `frontend-dist/legacy.html`、`frontend-dist/_redirects` | 旧登录和管理页面的承载与路由。不能只改新页面而忽略仍在使用的旧入口。 |
| `deploy/worker/` | 路由与资源构建、环境配置生成和 Worker 部署配置。 |
| `database/` | 数据库结构与迁移。日常部署不能顺手重跑一次性迁移。 |
| `test/` | Mocha 测试与数据库辅助实现。 |
| `DESIGN.md` | 已确认的视觉规范和主题变量归属；改共享设计时同步维护。 |

`frontend-dist` 并非全部都是生成文件。先确认具体文件的来源，不要因此拒绝修改手写页面，也不要把生成包当作源码。

## 必须保留的产品行为

- **文件与图库是同一个工作区。** 侧栏只保留“我的文件”；在内容区用“全部文件／我的图库”切换。不能重新拆成两个侧栏入口。
- `/account/?view=albums&album=...` 是有效的图库详情深链，必须保留。进出管理工具、浏览器前进／后退后，详情参数和“我的文件”侧栏高亮都要正确。
- 管理工具入口由 `account/shell.js` 与 `account/legacy-tools.js` 协作；原生设置由 `account/storage-settings.js` 承载。调整导航时一起检查这些路径。
- 新版“网站设置”也是原生设置页，只展示已接入新版的品牌、公开链接、上传渠道及工作区壁纸参数。不得重新展示没有新版消费者的旧配置或重复的欢迎页壁纸 JSON 输入；保留存量配置不等于必须保留旧控件。
- “安全与自动化”使用同一原生设置页，保留图像审查、IP 地点记录、文件访问和管理 API Token。旧上传密码、管理账号密码及不影响 Discord 的旧会话选项不在新版展示。安全配置使用 `GET /api/manage/sysConfig/security?view=modern` 与限定字段的 PATCH 增量保存，不覆盖存量认证、令牌及未修改配置。
- 共享站点配置由 `frontend-dist/site-config.js` 读取并应用，`site.js` 启动；动态页面标题和公开文件复制链接使用共享接口，不能重新写死品牌或忽略 URL 前缀。保存后刷新共享缓存与当前页面显示，失败时保留已保存事实并提示刷新。
- 默认品牌使用 `frontend-dist/brand/charatopia-wordmark.svg` 矢量英文字标，不带中文副标；PNG 仅保留为字形来源，不用于运行时显示。欢迎页、Discover、侧栏及欢迎标题复用 `theme.css` 的主题色遮罩；保留标题语义和无障碍名称。自定义站点名称／Logo 仍通过共享配置生效，不能强制覆盖管理员设置。
- 欢迎页是访客入口，已登录用户进入文件工作区。壁纸配置请求不能阻塞认证跳转。
- 欢迎页壁纸使用独立的 `welcomeWallpaper` 配置；旧上传页／管理页壁纸不是同一队列。入口为 `/account/?tool=system-wallpaper`。
- 壁纸保存复用 `/api/manage/sysConfig/page` 的 PATCH；公开读取经 `/api/userConfig`。只更新该配置，保留其他设置及公告状态。
- 旧“网站设置”使用通用文本控件：管理配置中的壁纸值应提供有效 JSON 字符串；公开接口再解析为对象，不能让旧界面显示 `[object Object]`。
- 壁纸显式关闭或空队列使用纯色；单图不启动轮播。隐藏页面、减少动态效果及浏览器往返缓存恢复都要正确处理，避免重复计时器和监听器。
- 欢迎页与工作区复用 `frontend-dist/wallpaper-player.js`，但各自配置独立。工作区的旧 `bkInterval` 单位仍是毫秒；工作区内部切换到管理视图时正确更换管理壁纸并清理旧实例。
- 文件归属、可见性和管理权限由服务端判断，不能只隐藏前端按钮。删除图库或移出图库不能顺带删除原文件。
- 新上传文件沿用 `users/{owner}/{UUID}.{ext}` 的唯一 ID，并以其末段作为保存的文件名；历史文件不批量改名。文件详情中的标签用于上传者整理与搜索，文件列表及图库详情共用编辑入口。标签写入通过 `PATCH /api/user/files` 核对归属并只增量更新标签；普通搜索包含标签，`#标签` 为精确筛选，不向公开接口添加标签输出。

## 数据与认证边界

- 数据库入口是 `functions/utils/databaseAdapter.js`。身份、文件归属和图库以 D1 为准；配置通过现有适配器读取，保留既有 KV／D1 数据路径，不自行复制或迁移数据。
- 文件存储、私有缩略图存储和 Images 绑定有不同职责。不要把私有文件或缩略图桶改成公开来绕过访问问题。
- 管理接口权限沿用 `functions/api/manage/_middleware.js` 与共享认证逻辑；写接口同时遵循现有跨站请求校验。
- Discord 登录需要运行时同时存在 `DISCORD_CLIENT_ID` 和 `DISCORD_CLIENT_SECRET`，并使用正确的 `DISCORD_CALLBACK_URL`。缺少前两者会返回 `Discord OAuth is not configured`。
- Discord 已配置时，旧 `login`／`adminLogin` 不再签发会话，认证与 `sessionCheck` 都不得接受没有 Discord 身份的旧会话。API Token 仍按权限用于管理接口，不能替代新版上传所需的 Discord 身份；不要重新引入空账号密码直接获取管理员会话的行为。
- 不输出、提交或写入页面任何密钥、会话 Cookie、令牌或数据库内容。排查配置时只检查名称、类型和是否存在。

## 开始工作与实现流程

1. 检查 `git status --short`、当前分支、近期提交，区分已提交版本、本地待发布改动与临时文件；不要只看自己这一轮编辑了哪些文件。
2. 阅读相关源码、测试和工作流。仓库存在 `.codegraph/` 时先用可用的 CodeGraph 定位符号和调用关系；查询尽量指定文件／符号，避免被旧压缩包淹没。
3. 没有当前可用的 Trellis 工作流时，不凭空创建第二套任务管理流程。如果以后加入 `.trellis/workflow.md`，先读取并遵循它。
4. 复现问题或建立清楚的验证信号，再修改源码。遵循现有接口、生命周期和样式，不靠重复路径或无条件重试掩盖问题。
5. 跑相关检查；跨模块、共享行为或发布前运行完整测试。检查差异和新增分支的必要性，删除本次临时诊断文件及失效代码。
6. 完成时说明根因或实现、修改范围、实际验证结果，以及尚未验证的限制。不能把文件写入成功、测试启动或部署排队当作完成。

已有未提交改动必须保留。禁止无授权使用 `git reset --hard`、`git checkout --` 或覆盖整份文件来清理现场。

## 工具与协作

- 本地读取／搜索优先使用可用的 FastCtx `read`、`grep`、`glob`，传绝对路径；结果为 `Partial` 时按返回参数续读。不可用或结果不适用时使用 `rg`／`rg --files`。
- 小范围语义编辑使用 `apply_patch`。机械式跨文件替换用 FastCtx `replace`，先 dry-run；不要为简单文本编辑创建一次性脚本。
- Windows 原生命令使用 PowerShell 7 与 `-NoProfile`；现有路径操作用 `-LiteralPath`。FastCtx 的 shell 是 Bash，不能向它传 PowerShell 语法。
- 不要复用 `$HOME`、`$home`、`$CODEX_HOME` 等系统变量。命令中的文本要正确转义，非 ASCII 原生工具输入使用 UTF-8。
- 删除临时目录前核对绝对路径位于本工作区；有依赖 junction／符号链接时先单独移除链接，不能递归删除实际依赖目录。
- GitHub 部署记录可用连接器或 `gh`；Cloudflare 配置可用连接器或 Wrangler。先读取实际工具参数与相关技能，使用能完成任务的最直接工具，不猜测工具能力。
- 页面验证优先检查用户正在看的实际标签页，可用浏览器／计算机使用工具；没有相应工具时使用现有 Playwright。分别遵循各工具文档，不用未授权的替代操作。
- 简单局部修改不委派。跨文件实现需要协作时，使用当前可用的实现 worker；明确文件归属并告知保留其他代理的改动。困难架构、安全和数据风险使用 `sol_expert` 等对应专家（工具存在时）。
- 面向客户的 HTML、界面和文档在完成前使用可用的 `client_delivery_finalizer` 检查；保留合法的工具指令、许可证和无障碍内容。AGENTS.md 本身是内部工作指令。

## 本地运行与验证

项目使用 npm，CI 使用 Node.js 22；依赖以 `package-lock.json` 为准。

```text
npm ci
npm test -- --reporter dot
npm run build:worker
npm start
```

- `npm start` 使用 `deploy/worker/wrangler.local.toml`，默认端口 8787，数据保存在 `data/`，绑定使用本地模拟。
- `npm run build:worker` 会生成 `deploy/worker/index.js`，并构建 CharInfo 核心与复制视频依赖。它不是通用前端编译器。
- CharInfo 单独构建：`node deploy/worker/build-charinfo-editor.js`；视频依赖复制：`node deploy/worker/build-video-compression.js`。
- `deploy/worker/index.js`、`frontend-dist/charinfo/profile-core.js` 及账户页 `vendor/` 依赖应由相应脚本生成。测试也可能触发部分构建，运行后检查差异，不盲目回退。
- 相关测试可用 `npx mocha test/accountUi.test.js --reporter dot` 等明确文件命令；新增测试要能捕捉实际行为，避免只复制实现。
- 无完整运行环境时，可做本地静态预览或隔离接口测试，但必须说明模拟范围。静态服务器不能验证真实登录、权限、数据库保存或 Worker 路由。
- UI 至少验证相关交互、错误／空状态、桌面和窄屏，以及涉及的明暗主题。共享导航需检查文件、图库、详情深链和管理工具返回路径。
- 页面看起来仍是旧版时，读取实际加载的样式和脚本，必要时强制刷新并检查缓存。不能只拿一个全新浏览器的截图证明用户当前标签页已更新。

## Staging 发布：以完整分支版本为单位

**默认开发与测试发布使用 `staging` 分支。不能按“本轮由我编辑的文件”擅自裁剪发布内容。**

仓库还保留 `main` 及其生产部署流程；不要因为它存在就新建功能分支、切换生产分支或合并到生产。只有用户明确要求时才改变发布目标。

发布流程：

1. 用户要求部署时，核对本地 `staging`、远端 `staging` 与工作区待发布状态。已确认的功能及本地待发布改动必须完整进入分支；不能以“不是本轮写的”认定为无关并排除。
2. 真正的临时试验、敏感文件或归属不明改动不能盲目提交；如果会影响本次发布范围，明确说明差异并澄清。既不能擅自全加，也不能静默漏发已确认功能。
3. 在实际将发布的完整版本上运行测试和构建检查；确认已有功能没有倒退。若用隔离副本验证，必须与待发布提交内容完全一致。
4. 提交完整待发布状态并推送 `staging`。不要挑拣几个文件重建一个缺少既有功能的替代发布版本。
5. 推送会触发 `.github/workflows/deploy-staging-worker.yml`（也支持手动运行）。等待对应提交的流程完成，核对其提交 SHA；运行旧提交的工作流不能发布本地新改动。
6. 确认测试、构建检查、Worker 部署、Discord 密钥同步和线上烟雾检查全部成功，再验证实际线上行为。流程目前只自动烟测 `/api/public/discover`，不能据此声称登录或新设置也已验证。
7. 涉及欢迎页／壁纸时，检查页面、相关静态资源及 `/api/userConfig`；涉及认证或部署配置时，检查 `/api/auth/discord` 是否正常跳转。涉及权限时，验证相应拒绝路径；不要用真实线上数据做破坏性测试。
8. 最后报告已部署的提交、流程链接、线上地址和验证结果；清理本次临时文件，保留用户其他改动。

Staging 地址：`https://imgbed-staging.uika.cc.cd/`。实际 Worker 名称、域名和资源绑定以工作流及仓库变量为准。

### 部署配置注意事项

- 首选既有 GitHub Actions 流程，使用仓库的 staging Variables／Secrets；不要另建一套凭据或手工同步来源。
- `.github/workflows/deploy-worker.yml` 在 `main` 推送时部署生产，不得用它代替 staging 流程。
- `generate-staging-toml.js` 生成 `deploy/worker/wrangler.staging.toml`，该文件被忽略；它不是可随意复用的完整线上配置来源。
- `npm run start:staging` 与 `npm run deploy:staging` 使用生成的 staging 配置，其中数据绑定可能是远程资源。它们不是普通的本地预览命令，使用前核对配置及操作影响。
- 缺少 OAuth 变量的本机配置可能在直接部署时覆盖线上普通变量，造成登录失效。不要用过期生成文件直接部署；也不能只上传代码、遗漏流程中的密钥同步步骤。
- 必须直接使用 Wrangler 时，先核对目标 Worker、完整变量、密钥和绑定，并查当前 CLI 文档；`--keep-vars` 不能代替完整配置核对或补齐缺失密钥。
- 不把配置值、令牌、本地数据、`.wrangler/`、`node_modules/` 或临时参考目录提交到 Git。

## 维护本说明

源码归属、入口、产品行为、验证命令或发布流程变化时同步更新本文件。记录可复用的规则和实际依据，不记录一次性运行编号、固定测试数量、账户凭据或已经失效的操作记录。用户明确的新要求优先于这里的既有约定。
