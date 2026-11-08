# CharInfo 图库弹窗接入 v1

本文面向接入开发者。ImgBed 负责图片、视频与图库；ST 中的 CharInfo Manager 是角色资料、配色、语录、世界书／EJS 及聊天保存的唯一编辑入口。ImgBed 的旧 Creator 已退役，旧地址只提供说明和浏览器草稿备份。连接只返回公开图库引用，用户仍须在 ST 预览并保存角色。

## 入口与协议

ST 应从用户点击打开独立窗口，并保留该窗口引用：

```text
/account/?view=albums&bridge=charinfo&bridge_version=1&bridge_nonce=<nonce>&opener_origin=<encoded-origin>[&album=<uuid>]
```

| 字段 | 要求 |
| --- | --- |
| `bridge` | 固定为 `charinfo` |
| `bridge_version` | 固定为 `1` |
| `bridge_nonce` | ST 每次发起连接重新生成的不可预测随机值，16–128 位字母、数字、`_` 或 `-`；推荐至少 128 位随机熵 |
| `opener_origin` | ST 宿主窗口的完整 origin（协议、主机和可选端口），不含路径、查询或尾斜线；它只是待验证提示 |
| `album` | 可选的小写 UUID，指向当前账号自己的图库；无此字段时列出图库 |

参数不得重复，完整本地返回路径不超过 500 字符。非法参数显示安全错误，要求重新从 ST 打开窗口。参数不作为重定向地址或认证信息。

所有跨窗口消息使用以下固定格式：

```js
{
  protocol: 'charinfo-imgbed-bridge',
  version: 1,
  type: 'bridge.hello', // 或 bridge.ready、album.selected、bridge.cancelled
  nonce: '<same nonce>'
}
```

ST 向 ImgBed 的精确 origin 发送 `bridge.hello`，可在加载／登录期间有界重发。ImgBed 在读取当前登录账号、启动账户页后才接受握手；必须同时匹配原始 `window.opener`、浏览器提供的 `event.source`、规范 HTTP／HTTPS 的 `event.origin`、查询中的 origin，以及协议、数字版本、消息类型和 nonce。查询只声明本次来源，不赋予权限。hello 只能包含上述四个字段。验证后将真实来源绑定为本次 `verifiedOrigin`，在当前文档仅回复一次 `bridge.ready`；后续选择、取消消息也只发送到此绑定值，绝不使用 `*`。

用户点击“使用此图库 / 返回 ST”后，ImgBed 重新读取当前登录身份、图库详情和公开 v1 图库包，核对图库确属此账号、有有效 CharInfo 角色全名、包内 UUID 与图库一致，发送前再次核对登录身份。即使站点所有者能通过管理权限读取他人图库，也不能通过桥接选择它。

成功时仅发送：

```js
{
  protocol: 'charinfo-imgbed-bridge',
  version: 1,
  type: 'album.selected',
  nonce: '<same nonce>',
  albumId: '<lowercase uuid>',
  remoteGalleryUrl: '<ImgBed origin>/api/public/album-gallery/<same uuid>'
}
```

URL 来自弹窗自身的 origin，不写死 staging，不依赖公开用户名，不附加查询或片段。桥接消息不发送角色姓名、账号 ID、私有接口内容、Cookie 或令牌；ST 从公开图库包读取真实角色姓名。原有 `/api/public/charinfo/{id}` 和 slug 分享链接保持原用途。

## 动态 ST 来源

任意玩家的标准 HTTP／HTTPS origin 均可连接，包括局域网地址 `http://192.168.1.41:8000`、Tailscale 地址 `http://100.75.12.3:8000`、回环地址和 HTTPS 自定义域名。无需向 ImgBed 运营者登记白名单，也无需启用 Chrome 的“不安全来源视为安全”、安装证书、将 ST 改为 HTTPS 或修改浏览器安全设置。

`frontend-dist/account/charinfo-bridge.js` 的 `isValidStOrigin` 要求严格等于浏览器序列化的 HTTP／HTTPS origin。不接受路径、查询、片段、凭据、额外空白、非规范端口／主机写法、编码主机、`null`、`file:`、`data:` 或 `javascript:`。协议和端口不同就是不同来源。只有真实 opener 发出来源、nonce 和版本均匹配的 hello，才会绑定来源；仅修改 URL 参数不能建立会话。

此动态接入仅允许用户显式返回已公开的图库引用，不授权 ST 读取私有接口、跨来源上传或删除文件。所有特权操作仍留在 ImgBed 自己的已登录页面，现有认证及跨站请求校验不变，不增加携带凭据的跨来源接口。

## 登录、导航与生命周期

账户页首次载入即捕获参数；`buildWorkspaceUrl` 调用桥接模块保留当前会话，使文件／图库切换、图库详情和浏览器前后退不丢失 nonce。普通账户页不添加桥接参数。

未登录时仍使用现有 `/login?returnTo=<local pathname+search>`。Discord 登录入口将经过 `sanitizeReturnTo` 校验的本地路径放入短期 HttpOnly Cookie，回调再次校验后返回。查询中的 `opener_origin` 从不作为跳转目标，认证不与 ST 交换。

会话上限为首次打开后 15 分钟，握手等待上限为 30 秒。标签页级 `sessionStorage` 按 nonce 保存创建时间、来源、首次登录账号及消费状态，不写入永久存储或认证凭据。不同 nonce 独立记录，避免新连接覆盖旧连接的终止标记；关闭标签页时由浏览器清理。

握手成功不消费 nonce；同源刷新或页面恢复会清除当前文档的握手状态和未完成发送，必须重新从真实 opener 收到 hello，且不能改变原来源、原账号或首次截止时间。ST 在其等待期限内应支持重新握手。仅在成功选择前、显式取消或过期时消费 nonce，随后历史 URL 也不能恢复该连接。存储受限时只提供手动连接。页面隐藏／卸载不会将旧的异步选择带入恢复后的会话。

成功／取消后移除消息监听和当前 URL 的桥接参数。只在已验证握手后取消才发送 `bridge.cancelled`；直接关闭窗口由 ST 检测关闭或超时。新建图库、上传和编辑都复用原有界面及同源接口，不会自动发送选择。

## 错误与手动连接

没有可用 opener（包括登录后浏览器隔离窗口）、发送被浏览器拒绝或握手超时，会显示手动连接提示。第三方 OAuth、COOP 或浏览器策略可能切断 opener；不会为此降低隔离头或引入配对令牌服务。选择图库后，仍核对身份、归属、角色名和公开包，再展示可复制的 UUID 链接，供粘贴到 ST 的“远程图库 URL”。复制被浏览器拒绝时可选中完整链接手动复制。

没有图库时可新建；指定图库已删除或不属于当前账号时可选择其他图库。缺少角色名时，用现有“编辑信息”填写“关联角色全名”，它仅对应图库身份字段 `charInfoCharacterName`。接口失败保留页面并显示错误；登录过期或身份变化会结束连接，需从 ST 重新打开。

## 验证

```text
npx mocha test/charInfoBridge.test.js test/charInfoBridgeUi.test.js test/accountUi.test.js --reporter dot
npm test -- --reporter dot
npm run build:worker
node --check frontend-dist/account/charinfo-bridge.js
node --check frontend-dist/account/account.js
git diff --check
```

协议单元测试使用模拟 opener、时钟、临时存储和接口。账户集成测试覆盖未登录返回路径、OAuth 入口 Cookie、回调返回、账户初始化、内部切换、握手和选择；回调中的 Discord 身份交换与会话签发使用替身，不访问真实 Discord。

本地浏览器烟测可从真实 HTTP 局域网页面打开测试 HTTPS origin，验证 opener、来源、刷新及消息顺序，但拦截提供的 HTTPS 资源和模拟账户接口不等于真实线上端到端验证。本地 Wrangler 已验证旧编辑器及 worldbook 别名不再提供编辑界面。静态别名由资源目录的 `_redirects` 处理，规则见 [Cloudflare Workers 静态资源重定向](https://developers.cloudflare.com/workers/static-assets/redirects/)。

真实 Discord 与 ST 仍需以下端到端联调：

1. 在普通 HTTP 局域网／Tailscale ST 地址和 HTTPS 自定义域名，分别从 CharInfo Manager 点击连接；不改浏览器安全设置。先退出 ImgBed 登录以覆盖首次登录。
2. 在弹窗内完成 Discord 登录，确认返回带原 nonce 的本地账户页，并出现“已连接 ST”。若浏览器切断 opener，确认能手动复制链接。
3. 新建图库，填写角色全名，上传或加入本人文件，调整顺序，然后点击使用图库；确认 ST 只接收一次同 UUID 的规范 URL，预览真实角色名，并仍需用户保存角色。
4. 管理已有图库，再切换文件／图库、使用浏览器前后退和同源刷新，确认重新握手仍可用；测试取消、关闭、超时、重复 hello 和成功后刷新，已结束的会话不能再次发送选择。
5. 尝试他人／已删除图库、空角色名、登录过期和不可用公开包，均不得成功发送。普通文件／图库管理、公开图库与历史 feed 保持现有行为；旧 `/charinfo/` 及其 worldbook、album 形式只能打开退役说明，草稿备份不得删除 IndexedDB 内容。
