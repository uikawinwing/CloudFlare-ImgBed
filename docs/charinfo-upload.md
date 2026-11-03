# CharInfo 编辑器内上传接受方 v1

本文面向 ImgBed／CharInfo Manager 接入开发者，对齐 CharInfo Manager 的 `docs/imgbed-upload-protocol.md`。本功能管理账号授权、媒体和图库，不接收角色正文、世界书、配色或 metadata。旧 `charinfo-imgbed-bridge` 选择图库窗口继续独立工作；新协议失败不会自动打开旧窗口。

## 页面与消息

- 隐藏上传 iframe 挂在实际执行桥接代码的 TavernHelper 脚本窗口：`/charinfo-upload/?parent_origin=<origin>&connection_id=<48hex>`，sandbox 为 `allow-scripts allow-same-origin`。不能挂在 ST 顶层后从脚本窗口代发消息。
- 编辑器先复用有效授权，无授权时自动准备 `/charinfo-upload/launcher?parent_origin=<origin>&connection_id=<same id>` 专用按钮。玩家点击唯一的“连接 ImgBed”，以同源表单 POST 打开顶层授权页；未登录自动前往 Discord，再返回明确同意。日常上传不打开完整图床后台。
- 信封为 `{protocol:'charinfo-imgbed-upload',version:1,connectionId,type,...}`。文件使用结构化克隆的原 `File`，不转 JSON／Base64。
- 接受所有严格、规范的 HTTP／HTTPS 父源，包括 LAN、Tailscale 与回环地址。iframe 必须验证 `event.source === parent` 及真实 `event.origin` 与查询声明完全一致。所有发送使用精确 `targetOrigin`。
- `bridge.ready` 只表示协议就绪，不表示登录或授权。只有 `auth.connected` 后才接受图库操作。
- launcher 在严格父源 hello 后向可见父窗口发送 `launcher.ready` 公共信封。CharInfo 在该窗口监听并核对来源与精确 launcher 引用后才显示按钮；缺少确认时隐藏回退页并报错。OAuth 使用公开 `login_attempted=1` 回调标记避免无会话时自动跳转循环，有效授权仍在原有 24 小时绝对期限内复用。

类型与字段沿用上传协议 v1：`bridge.hello/ready`；`auth.status/connect/resume/connected/required/failed/disconnect/cancelled`；`gallery.read/loaded/save/progress/saved/error`；`bridge.cancel`。`auth.cancelled` 仅带当前 `requestId`，表示服务端已撤销本次授权上下文，父端此后才移除 iframe。仅接收合法字段，响应逐字回显请求与会话编号。`auth.status` 可带公开 `sessionId`，不会据此授权。

ID 为 1–128 位 ASCII 字母、数字、下划线或短横线；连接编号为 24 字节随机值的 48 位小写 hex。图库 UUID 必须小写。姓名 trim 后 1–80 字符，每次最多 100 个新文件、500 个最终成员；仅接受现有七种图片／视频 MIME、文件签名及 95 MiB 单文件限制。文件保存名仍为 `users/{owner}/{UUID}.{ext}` 的末段。`FileInput.title` 用于不可变请求摘要，不改写系统文件名；返回标题使用实际公开图库包的标题。

## 私有配对与明确同意

普通 Discord 会话仍是 `HttpOnly; SameSite=Strict; Secure`；不改 Cookie、普通用户接口的 CSRF 或 CORS。iframe 内所有授权／上传请求使用 `credentials:'omit'`，只携带留在 ImgBed 的私有配对证明。顶层授权页才使用现有 Discord 登录 Cookie。

1. iframe 从真实父窗口收到 hello 后，用 `getRandomValues` 生成独立私有证明，登记父源、连接编号与证明。服务器只存证明哈希，重复登记不能替换另一证明或来源。
2. launcher 也先验证真实父窗口的 hello/source/Origin。可见编辑器窗口中的固定函数发送公开 hello，不能从脚本窗口代发。launcher 有界遍历同一顶层窗口的帧，发送同源 `launch.request` 挑战；上传 iframe 核对同源、同顶层窗口、精确连接与已经实测的父源，才直接返回 `launch.proof`。launcher 只收已挑战窗口的精确响应。私有证明不经过 ST。
3. launcher 的原生表单向 `/api/charinfo-upload/launch` 提交 `{connectionId,proof}`。服务端限定同源 Origin、`Sec-Fetch-Site: same-origin`、`Mode: navigate`、`Dest: document`，拒绝 GET、查询参数和额外字段。验证证明后，签发按连接独立的十分钟 `__Host-` HttpOnly/Secure/SameSite=Lax Cookie；D1 只存哈希，303 地址只含公开编号和服务端来源。
4. 顶层页 `inspect/approve/deny` 必须持有该私有 Cookie。inspect 绑定真实 Discord 账号，页面显示服务端来源及账号；approve 提交页面展示的公开 `accountId` 并再次核对登录身份，原子消费上下文。只有玩家显式同意才授予权限。攻击者即使用后台请求伪造 Origin 登记配对，也不能通过 GET 链接在受害者浏览器兑换 Cookie 或批准连接。

流程不使用 popup.opener、BroadcastChannel 或顶层与第三方 iframe 的共享存储，因此支持 COOP 切断 opener。launcher 响应必须使用 `Referrer-Policy: same-origin`，表单仅 `rel=noopener`；`noreferrer`／`no-referrer` 会使原生导航 Origin 为 null，不能放宽校验来接受它。授权页继续禁止嵌入。私有证明、刷新证明、Cookie 和 Discord Token 不进入 ST 消息、地址栏或日志。

待确认配对有效 12 分钟。用户同意后的 grant 最长 24 小时，内部短会话 12 分钟；续期旋转公开 `sessionId`，不能延长原 grant 的绝对截止时间。按精确父源存储的刷新证明仅在 ImgBed 分区存储中使用，可让新连接恢复同账号授权；浏览器不能保证永久免登录。主动断开需先完成服务端撤销，失败返回 `auth.failed`，不会声称已退出。更换账号产生不同的公开 `accountId`，真实文件归属始终取自服务端身份。

## 内部接口与恢复账本

接口均为 ImgBed 同源 POST、`no-store`，不提供跨来源凭据访问：

| 路径 | 用途 |
| --- | --- |
| `/api/charinfo-upload/pair` | 登记 `{connectionId,parentOrigin,proof}`，不授权 |
| `/api/charinfo-upload/launch` | 严格同源顶层表单 POST，签发短期授权 Cookie，禁止 GET 兑换 |
| `/api/charinfo-upload/auth` | `inspect/approve/deny` 使用授权 Cookie，前两者还需真实登录；approve 必须匹配已展示的 accountId。`status/resume/renew/disconnect` 继续使用 `X-CharInfo-Pair-Proof` |
| `/api/charinfo-upload/gallery` | `read/prepare/commit/cancel`；包含连接、公开 session 和 request ID，仍需私有证明 |
| `/api/charinfo-upload/file` | 单文件原始流暂存，查询仅含公开编号，私有证明及 session 分别通过专用头发送 |

服务器直接在 D1 `other_data` 保存配对、授权与 `(真实账号,requestId)` 操作账本，不复制账号／图库数据库，不执行数据库迁移。操作摘要绑定原图库、姓名、文件元数据、顺序及逐文件完整 SHA-256；同 request ID 换内容会被拒绝。Item ID 是相册 UUID 与真实文件 ID 的稳定 SHA-256，不把含斜杠的内部路径当成 wire ID。

保存按 `prepare → 逐文件 stage → 逐步 commit` 执行。完整输入、文件签名、大小及总配额验证通过后，才预留一次总配额、晋升正式文件并最终写图库；不把最多 100 个大文件塞进一个请求。暂存流只保留小段头部供检测，完整摘要由 Worker 流式计算。每次 commit 最多处理一个新文件。固定文件 UUID、原子配额记录、独占租约及取消栅栏防止常规重试重复扣额或创建重复图库。

最终图库、成员顺序及完成结果在同一个 D1 事务保存，并比对完整旧成员／展示配置快照和实时授权条件。省略成员只解除关联，原文件保留；不会按姓名查找并合并另一角色。结果必须对应实际公开 v1 包，不返回半成品；历史头像、封面及隐藏设置继续保留。

`INPUT_REJECTED` 仅在确定没有正式文件、图库或配额副作用时返回，并持久标记原操作已拒绝。格式错误等不能确认原操作状态的请求使用其他错误码。部分失败、取消与授权失效保留不可变操作，重新授权同账号后可继续；已完成结果直接复用。

**外部存储的不确定窗口**：R2 使用确定键，可以安全重试。Telegram／Discord 不支持本操作的跨服务事务；若上游可能成功但结果无法确认，记录 `UPLOAD_UNCERTAIN`、保留配额／暂存／账本，不自动再发上传请求，也不返回 `gallery.saved`。这类情况需要维护者核对上游与记录后处理，不能声称所有故障均可自动恢复。大文件仍需真实设备和渠道联调，测试替身不能证明其内存开销。

## 部署前提

用户已选择新增专用私有 R2 暂存桶，绑定名称为 `CHARINFO_UPLOAD_STAGING`。不能复用可能公开的原文件桶或改变缩略图桶职责，不能开启 r2.dev／公开域名。为孤立暂存对象配置清理生命周期；正式文件和操作账本不随临时对象自动删除。暂存对象失效后的恢复必须重新提供同一文件，不能冒充已完整保存。

- 本地 Wrangler 仅配置模拟桶，不访问远端资源。
- staging 工作流／配置生成器要求 `STAGING_CHARINFO_UPLOAD_STAGING_BUCKET_NAME`。部署前需先创建私有桶并设置该仓库变量；暂存桶采用 7 天对象清理、1 天未完成分片清理，不影响正式文件与操作账本。
- 本协议当前 ST 固定接受 `https://imgbed-staging.uika.cc.cd`，不能由导入档案或页面查询改写；返回 URL 必须是该部署自身的规范 UUID 图库地址。

## 验证边界与手动联调

自动测试覆盖协议来源／字段／File、内部挑战、明确同意、续期撤销、同账号恢复、不可变请求、配额一次、并发成员变更和取消。原生 Worker 集成测试验证真实 D1／R2 接口；本地浏览器使用模拟账号和本地存储，验证 HTTP LAN 父页面、跨源 File、明确同意、重复保存及撤销。真实 Discord OAuth、各浏览器的分区存储限制、95 MiB 文件和 Android 的完整链路仍须部署后联调：

1. 从普通 HTTP LAN／Tailscale ST 打开编辑器，确认 iframe ready 不会变为已登录；从连接按钮登录并核对准确来源、账号、权限及截止时间后同意。
2. 在原保存动作上传图片／视频，检查公开包 UUID、姓名、数量和顺序，回填链接后再保存 ST 资料；角色正文不发送到 ImgBed。
3. 断网、取消、重新授权同账号后重试同一请求，确认不重复建库／扣额；换账号不得恢复另一账号的操作，主动撤销后不能继续正式保存。
4. 检查拒绝、ST 停止等待后点击旧页批准、超时、存储被禁、恶意窗口／来源、过期会话及外部上传结果不确定。取消只有在服务端撤销确认后完成；撤销失败明确报错，旧连接与重试的新编号隔离。关闭整个页面或网络不可达时不能保证立即撤销，短期上下文到期负责兜底。

自动浏览器回归：`CHARINFO_PLAYWRIGHT_MODULE=/已有路径/playwright node --test test/browser/charinfoUpload.mjs`。它使用双方真实代码和原生 Worker D1/R2，OAuth 账号为模拟。原生 HTTP 回环服务验证浏览器真实 Fetch Metadata、HttpOnly Cookie、无 opener 授权；HTTPS/三种 ST 来源由浏览器路由隔离模拟，路由发生在 Fetch Metadata 添加前，相关导航头在测试代理中补入，不能当成真实部署验收。

实现依据：[跨文档消息](https://html.spec.whatwg.org/dev/web-messaging.html)、[安全上下文祖先规则](https://www.w3.org/TR/secure-contexts/)、[Workers Web Crypto 与流式摘要](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)。
