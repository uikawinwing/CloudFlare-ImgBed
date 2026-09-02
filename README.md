<div align="center">
    <a href="https://github.com/uikawinwing/CloudFlare-ImgBed"><img width="80%" alt="logo" src="readme/banner.png" /></a>
    <p><em>🗂️ Beyond image hosting: an all-in-one, open-source file management hub.</em></p>
    <p>
        <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/blob/main/README_zh.md">简体中文</a> | <a href="https://github.com/uikawinwing/CloudFlare-ImgBed/blob/main/README.md">English</a> | <a href="https://imgbed.uika.cc.cd">Live Site</a>
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
> **For bugs, compatibility problems, or feature requests, use this repository's [Issues](https://github.com/uikawinwing/CloudFlare-ImgBed/issues).**


# 1. 💡 Introduction

CloudFlare ImgBed is a self-hosted image and file hosting solution for Docker and serverless environments, bringing **Telegram**, **Discord**, **Cloudflare R2**, **S3-compatible storage**, **Hugging Face**, **WebDAV**, and more into one management interface. It provides file management, authentication, directory organization, content moderation, a RESTful API, and WebDAV for personal image hosting, website asset management, and lightweight file distribution.

## Public entry points

- `/` is a lightweight welcome page with upload, Discover, and CharInfo Creator shortcuts. It displays one item from the operator-curated Featured set and does not load the recent public feed, public albums, or infinite scrolling.
- `/discover/` is the full public catalog. Featured works, public albums, recent media, filters, and pagination load only after a visitor enters Discover.

Featured welcome content is limited to public files whose owner and moderation status are active and whose `featured_at` value is set. The welcome page reads a bounded Featured manifest, renders one media item at a time, and reuses browser and edge caches to keep default-page traffic predictable. If no Featured item is available, the page shows an empty state without falling back to the Discover feed.

![CloudFlare](readme/海报.png)

# 2. 🖥️ Demo

**Live site**: [CloudFlare ImgBed](https://imgbed.uika.cc.cd/)

![Creator Studio upload page](readme/upload.png)

<details>
    <summary>Other page screenshots</summary>

<table>
  <tr>
    <td align="center" width="50%">
      <strong>Login Page</strong><br>
      <img src="readme/login.png" alt="Login Page" width="100%">
    </td>
    <td align="center" width="50%">
      <strong>Upload Progress</strong><br>
      <img src="readme/uploading.png" alt="Upload Progress" width="100%">
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>File Management</strong><br>
      <img src="readme/dashboard.png" alt="File Management" width="100%">
    </td>
    <td align="center" width="50%">
      <strong>User Management</strong><br>
      <img src="readme/customer-config.png" alt="User Management" width="100%">
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <strong>Status Page</strong><br>
      <img src="readme/status-page.png" alt="Status Page" width="100%">
    </td>
    <td align="center" width="50%">
      <strong>Public Gallery</strong><br>
      <img src="readme/public-gallery.png" alt="Public Gallery" width="100%">
    </td>
  </tr>
</table>

</details>

# 3. 📚 Documentation & Updates

## 📖 Documentation

Deployment and maintenance notes are kept with this standalone repository. Use the English or Chinese README as the current entry point, and report missing or outdated instructions through [Issues](https://github.com/uikawinwing/CloudFlare-ImgBed/issues).

## 📝 Changelog

Follow this standalone version's latest features, fixes, and compatibility notes on the [Releases](https://github.com/uikawinwing/CloudFlare-ImgBed/releases) page.

# 4. 👥 Community

## 🧑‍💻 Contributors

Thank you to everyone who has contributed code, documentation, ideas, and feedback!

[![Contributors](https://contrib.rocks/image?repo=uikawinwing/CloudFlare-ImgBed)](https://github.com/uikawinwing/CloudFlare-ImgBed/graphs/contributors)

## ⭐ Star History

**If you find the project useful, please consider giving it a Star ⭐. Thank you for your support!**

<a href="https://star-history.com/#uikawinwing/CloudFlare-ImgBed&Date">
  <img alt="Star History" src="https://api.star-history.com/svg?repos=uikawinwing/CloudFlare-ImgBed&type=Date" />
</a>

# 5. ⚖️ License & Related Projects

## 📄 License

> [!IMPORTANT]
> This project is licensed under the [MIT License](LICENSE). You may use, modify, and distribute it, provided that the original copyright and license notices are retained in all copies or substantial portions of the software.

## 🔗 Related Open Source Projects

- **Web frontend**: [MarSeventh/Sanyue-ImgHub](https://github.com/MarSeventh/Sanyue-ImgHub)
- **Desktop client**: [MarSeventh/satellite](https://github.com/MarSeventh/satellite)
- **Upstream project**: [cf-pages/Telegraph-Image](https://github.com/cf-pages/Telegraph-Image)

CloudFlare ImgBed evolved from Telegraph-Image. Thanks to its original authors and contributors.
