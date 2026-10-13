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

> [!NOTE]
> This repository is now **independently maintained by uikawinwing**. It no longer follows the original repository's development branches, release cadence, or automatic synchronization. Production and staging are maintained through this repository's Cloudflare Workers deployments.


# 1. 💡 Introduction

CloudFlare ImgBed is a self-hosted image and file hosting solution that runs on **Cloudflare Workers**. It uses **Telegram**, **Discord**, and **Cloudflare R2** as active storage backends. Existing Hugging Face files can still be read and deleted; new uploads are disabled. It provides file management, authentication, directory organization, content moderation, and a RESTful API for personal image hosting, website asset management, and lightweight file distribution.

Setting a file or album to Private hides it from Discover. Anyone with its share link can still access it.

## Current standalone focus

- **Workers-only deployment**: production and staging run on Cloudflare Workers with Worker Static Assets serving the frontend. Docker and the Node.js server are not supported.
- **Cloudflare-native storage**: R2, D1, and KV are used for files, metadata, and site state where appropriate.
- **Creator Studio**: upload, file management, galleries, member administration, and site management are maintained in this repository.
- **Discover and public galleries**: public browsing, Featured content, filtering, pagination, and creator entry points are part of the standalone experience.
- **CharInfo Creator**: an integrated creative-tool entry point that works alongside ImgBed's media capabilities.
- **Independent auth and deployment flow**: Discord OAuth, production/staging Workers, and repository CI are maintained here.

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

## Worker development and deployment

Install dependencies and run the Worker with local binding storage:

```bash
npm ci
npm start
```

`npm start` regenerates the Worker route adapter and starts `wrangler dev` on port 8787. Use `npm test` for the repository test suite. `npm run start:staging` and `npm run deploy:staging` require the `STAGING_D1_DATABASE_ID`, `STAGING_KV_NAMESPACE_ID`, and `STAGING_R2_BUCKET_NAME` environment variables and connect to staging bindings only. Production deployment uses `npm run deploy:worker` with the corresponding production deployment variables.

The GitHub Actions workflows run `npm test` before route generation, bundle validation, and deployment. Database schema changes are intentionally separate from routine deployments. For a new local D1 database, run a reviewed initialization explicitly:

```bash
npx wrangler d1 execute img_d1 --config deploy/worker/wrangler.local.toml --local --persist-to ./data --file database/init.sql
```

For staging or production, review one migration file and the target database name before using `--remote`; no workflow applies remote D1 schema or data changes automatically. Existing databases can apply `database/migrations/v2.11.0_file_query_indexes.sql` separately to improve file list and Discover query indexes. See the [D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/) for database selection and local persistence options.

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

# 5. ⚖️ License & Acknowledgements

## 📄 License

> [!IMPORTANT]
> This project is licensed under the [MIT License](LICENSE). You may use, modify, and distribute it, provided that the original copyright and license notices are retained in all copies or substantial portions of the software.

## 🙏 Project origin and thanks

This project continues development based on [MarSeventh/CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed). It is now maintained independently in this repository and no longer follows the original repository's branches or release cadence.



Thank you to **MarSeventh** and every contributor to the original project for building the foundation of CloudFlare ImgBed.
