# CharInfo 编辑器内上传接受方 v1

本文面向 ImgBed／CharInfo Manager 接入开发者，对齐 CharInfo Manager 的 `docs/imgbed-upload-protocol.md`。本功能管理账号授权、媒体和图库，不接收角色正文、世界书、配色或 metadata。旧 `charinfo-imgbed-bridge` 选择图库窗口继续独立工作；新协议失败不会自动打开旧窗口。

## 页面与消息

- ST 宿主文档挂载隐藏 iframe：`/charinfo-upload/?parent_origin=<origin>&connection_id=<48hex>`，sandbox 为 `allow-scripts allow-same-origin`。
- 用户点击连接时，从宿主同步打开 `/charinfo-upload/connect?parent_origin=<origin>&connection_id=<same id>`。
- 信封为 `{protocol:'charinfo-imgbed-upload',version:1,connectionId,type,...}`。文件使用结构化克隆的原 `File`，不转 JSON／Base64。
- 接受所有严格、规范的 HTTP／HTTPS 父源，包括 LAN、Tailscale 与回环地址。iframe 必须验证 `event.source === parent` 及真实 `event.origin` 与查询声明完全一致。所有发送使用精确 `targetOrigin`。
- `bridge.ready` 只表示协议就绪，不表示登录或授权。只有 `auth.connected` 后才接受图库操作。

类型与字段沿用上传协议 v1：`bridge.hello/ready`；`auth.status/connect/resume/connected/required/failed/disconnect`；`gallery.read/loaded/save/progress/saved/error`；`bridge.cancel`。仅接收合法字段，响应逐字回显请求与会话编号。当前 ST 实现的 `auth.status` 还可能附带可选 `sessionId`，接受方允许这个公开关联字段，但不会据此授权。

ID 为 1–128 位 ASCII 字母、数字、下划线或短横线；连接编号为 24 字节随机值的 48 位小写 hex。图库 UUID 必须小写。姓名 trim 后 1–80 字符，每次最多 100 个新文件、500 个最终成员；仅接受现有七种图片／视频 MIME、文件签名及 95 MiB 单文件限制。文件保存名仍为 `users/{owner}/{UUID}.{ext}` 的末段。`FileInput.title` 用于不可变请求摘要，不改写系统文件名；返回标题使用实际公开图库包的标题。

## 私有配对与明确同意

普通 Discord 会话仍是 `HttpOnly; SameSite=Strict; Secure`；不改 Cookie、普通用户接口的 CSRF 或 CORS。iframe 内所有授权／上传请求使用 `credentials:'omit'`，只携带留在 ImgBed 的私有配对证明。顶层授权页才使用现有 Discord 登录 Cookie。

1. iframe 从真实父窗口收到 hello 后，用 `getRandomValues` 生成独立私有证明，登记父源、连接编号与证明。服务器只存证明哈希，重复登记不能替换另一证明或来源。
2. 授权页向 `opener.frames` 的直接子窗口引用发送内部随机挑战，精确目标为 ImgBed origin。iframe 只接受同源消息，且挑战窗口的 `opener` 必须就是自己的父窗口。
3. iframe 仅向这个 ImgBed 窗口返回私有证明与挑战；授权页验证同源、子窗口引用、挑战及连接编号，再用 Cookie 和私有证明读取服务器配对记录。用户看到的 ST 来源来自该记录。
4. 用户显式点击“允许连接”，服务端才将证明绑定到真实账号与授权范围。仅有公开连接编号、查询来源、session/account ID 或顶层登录 Cookie 都不能取得 iframe 授权。

如果 OAuth／COOP 切断 opener，或分区存储不可用，流程安全失败并保留 ST 草稿，不降低隔离头，不凭连接编号授予身份。授权页禁止被嵌入其他页面。私有证明、刷新证明、Cookie 和 Discord Token 不进入 ST 消息、地址栏或日志。

待确认配对有效 12 分钟。用户同意后的 grant 最长 24 小时，内部短会话 12 分钟；续期旋转公开 `sessionId`，不能延长原 grant 的绝对截止时间。按精确父源存储的刷新证明仅在 ImgBed 分区存储中使用，可让新连接恢复同账号授权；浏览器不能保证永久免登录。主动断开需先完成服务端撤销，失败返回 `auth.failed`，不会声称已退出。更换账号产生不同的公开 `accountId`，真实文件归属始终取自服务端身份。

## 内部接口与恢复账本

接口均为 ImgBed 同源 POST、`no-store`，不提供跨来源凭据访问：

| 路径 | 用途 |
| --- | --- |
| `/api/charinfo-upload/pair` | 登记 `{connectionId,parentOrigin,proof}`，不授权 |
| `/api/charinfo-upload/auth` | `inspect/approve/status/resume/renew/disconnect`；证明通过 `X-CharInfo-Pair-Proof` 头发送，inspect／approve 额外要求真实登录 Cookie |
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
4. 检查存储被禁、popup opener 丢失、恶意窗口／来源、过期会话及外部上传结果不确定，均不得假称成功或自动切换旧上传方式。

实现依据：[跨文档消息](https://html.spec.whatwg.org/dev/web-messaging.html)、[安全上下文祖先规则](https://www.w3.org/TR/secure-contexts/)、[Workers Web Crypto 与流式摘要](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)。
