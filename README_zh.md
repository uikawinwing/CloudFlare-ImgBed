<div align="center">
    <a href="https://github.com/uikawinwing/CloudFlare-ImgBed"><img width="80%" alt="logo" src="readme/banner.png" /></a>
    <p><em>🗂️ 打破图床边界，构建你的专属开源文件托管引擎。</em></p>
    <p>
        <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/blob/main/README_zh.md">简体中文</a> | <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/blob/main/README.md">English</a> | <a href="https://imgbed.uika.cc.cd">在线站点</a>
    </p>
    <p align="center">
        <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/blob/main/LICENSE"><img src="https://img.shields.io/github/license/uikawinwing/CloudFlare-ImgBed" alt="License" /></a>
        <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/releases"><img src="https://img.shields.io/github/v/release/uikawinwing/CloudFlare-ImgBed?display_name=tag" alt="Latest release" /></a>
        <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/stargazers"><img src="https://img.shields.io/github/stars/uikawinwing/CloudFlare-ImgBed" alt="Stars" /></a>
        <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/network/members"><img src="https://img.shields.io/github/forks/uikawinwing/CloudFlare-ImgBed" alt="Forks" /></a>
    </p>
</div>

---

> [!IMPORTANT]
>
> **如遇到缺陷、兼容性问题或希望提出功能建议，请使用本仓库的 [Issues](https://github.com/uikawinwing/CloudFlare-ImgBed/issues)。**

> [!NOTE]
> 本仓库现由 **uikawinwing 独立维护**，不再跟随原仓库的开发分支、发布节奏或自动同步流程。生产与测试环境均以本仓库的 Cloudflare Workers 部署为准。


# 1. 💡 项目介绍

CloudFlare ImgBed 是支持 Docker 与 Serverless 部署的自建图床和文件托管方案，可将 **Telegram**、**Discord**、**Cloudflare R2**、**S3 兼容存储**、**Hugging Face**、**WebDAV** 等渠道统一接入一个管理界面。项目提供文件管理、身份认证、目录组织、内容审核、RESTful API 与 WebDAV，适用于个人图床、网站资源管理和轻量文件分发。

## 当前独立版本重点

- **Workers-first 部署**：生产与 Staging 统一运行在 Cloudflare Workers，并使用 Worker Static Assets 提供前端资源。
- **Cloudflare 原生存储**：按用途接入 R2、D1 与 KV，管理文件、元数据和站点状态。
- **Creator Studio**：提供上传、文件管理、图库、成员与站点管理等后台能力。
- **Discover 与公开图库**：支持公开内容浏览、Featured 内容、筛选、分页及创作者入口。
- **CharInfo Creator**：作为站点内独立创作工具入口，与 ImgBed 的媒体能力配合使用。
- **独立维护的认证与部署流程**：Discord OAuth、生产/Staging Worker 与仓库 CI 均由本仓库自行维护。

## 公共入口

- `/` 是轻量欢迎页，提供上传、Discover 与 CharInfo Creator 入口。页面只展示一项由站点运营者控制的 Featured 内容，不加载近期公开 Feed、公开图库或无限滚动。
- `/discover/` 是完整的公共发现页。访客主动进入后，页面才加载 Featured 作品、公开图库、近期媒体、筛选与分页内容。

欢迎页的 Featured 内容仅来自所属用户状态正常、审核状态正常、可见性为公开且已设置 `featured_at` 的文件。页面读取数量有上限的 Featured 清单，每次只渲染一项媒体，并复用浏览器与边缘缓存，使默认入口的请求量保持可控。没有可用 Featured 内容时，页面显示空状态，不会回退加载 Discover Feed。

![CloudFlare](readme/海报.png)

# 2. 🖥️ 在线演示

**在线站点**：[CloudFlare ImgBed](https://imgbed.uika.cc.cd/)

![Creator Studio 文件上传页面](readme/upload.png)

<details>
    <summary>其他页面效果展示</summary>

<table>
  <tr>
    <td align="center" width="50%">
      <strong>登录页面</strong><br>
      <img src="readme/login.png" alt="登录页面" width="100%">
    </td>
    <td align="center" width="50%">
      <strong>上传进度</strong><br>
      <img src="readme/uploading.png" alt="上传进度" width="100%">
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>文件管理</strong><br>
      <img src="readme/dashboard.png" alt="文件管理" width="100%">
    </td>
    <td align="center" width="50%">
      <strong>用户管理</strong><br>
      <img src="readme/customer-config.png" alt="用户管理" width="100%">
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>状态页面</strong><br>
      <img src="readme/status-page.png" alt="状态页面" width="100%">
    </td>
    <td align="center" width="50%">
      <strong>公开画廊</strong><br>
      <img src="readme/public-gallery.png" alt="公开画廊" width="100%">
    </td>
  </tr>
</table>

</details>

# 3. 📚 文档与更新

## 📖 项目文档

本独立版本的部署与维护说明随仓库共同维护。请以中英文 README 为当前入口；如发现说明缺失或过期，请通过 [Issues](https://github.com/uikawinwing/CloudFlare-ImgBed/issues) 反馈。

## 📝 更新日志

本独立版本的最新功能、修复与兼容性说明发布在 [Releases](https://github.com/uikawinwing/CloudFlare-ImgBed/releases) 页面。

# 4. 👥 项目社区

## 🧑‍💻 贡献者

感谢所有为项目贡献代码、文档、创意和反馈的开发者！

[![贡献者](https://contrib.rocks/image?repo=uikawinwing/CloudFlare-ImgBed)](https://github.com/uikawinwing/CloudFlare-ImgBed/graphs/contributors)

## ⭐ Star 趋势

**如果这个项目对您有所帮助，欢迎点亮一个 Star ⭐，感谢您的支持！**

<a href="https://star-history.com/#uikawinwing/CloudFlare-ImgBed&Date">
  <img alt="Star History" src="https://api.star-history.com/svg?repos=uikawinwing/CloudFlare-ImgBed&type=Date" />
</a>

# 5. ⚖️ 开源协议与致谢

## 📄 开源协议

> [!IMPORTANT]
> 本项目基于 [MIT License](LICENSE) 开源。您可以自由使用、修改和分发本项目，但须在软件的所有副本或重要部分中保留原始版权及许可声明。

## 🙏 项目来源与致谢

本项目基于 [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) 持续开发，目前由本仓库独立维护，不再跟随原仓库的开发分支或发布节奏。



感谢 **MarSeventh** 以及原项目的所有贡献者为 CloudFlare ImgBed 打下基础。
