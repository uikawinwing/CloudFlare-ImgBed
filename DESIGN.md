---
version: alpha
colors:
  background: "#ffffff"
  surface: "rgba(255, 255, 255, .94)"
  text: "#111111"
  muted: "#767676"
  accent: "#587463"
  success: "#2ca875"
  danger: "#d92d3d"
typography:
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif"
rounded:
  small: "10px"
  medium: "14px"
  large: "18px"
omitted:
  - section: spacing
    reason: "Existing account stylesheet is the runtime source of layout spacing."
---

## Overview

CloudFlare ImgBed is a Chinese administration workspace for managing files and site settings. `frontend-dist/theme.css` and `frontend-dist/account/unified.css` define the effective light and dark themes; `account.css` supplies the shared layout and controls. New settings pages reuse their tokens, rounded panels, and system-font layout.

## Colors

Use a muted sage accent for primary actions, green for confirmed success, and the danger token for destructive operations. Light mode uses #587463 for the accent, #465e50 on hover, and white text on accent fills. Dark mode uses #a3bfa9 for the accent, #b9d0be on hover, and #18271e text on accent fills. Light mode uses white surfaces and dark text; dark mode uses a #121212 background, #1a1a1a surfaces, and #f5f5f5 text. Keep explanatory text muted and form labels readable. Use theme variables rather than fixed dark backgrounds on shared controls.

`frontend-dist/theme.css` owns the runtime palette through `--app-accent`, `--app-accent-hover`, `--app-accent-soft`, and `--app-on-accent`. Public pages consume these directly; `frontend-dist/account/unified.css` maps the same palette to the workspace controls. This document records the accepted palette; it does not generate CSS.

## Typography

Use the existing system font stack so Simplified Chinese labels stay stable without a remote font dependency. Headings are concise and task-focused.

The Charatopia brand uses the serif English vector wordmark at `frontend-dist/brand/charatopia-wordmark.svg`, with no Chinese subtitle inside the logo. Its paths follow the supplied artwork; the PNG remains the authoring reference, while the browser renders opaque vector outlines to keep fine strokes clear at navigation and heading sizes. `frontend-dist/theme.css` owns its shared mask treatment: the transparent asset follows the surrounding text color in light and dark themes. Public navigation, the account sidebar, and the welcome heading share this artwork; the heading retains its semantic text, and site names remain available to assistive technology. A 4:1 display area removes transparent padding while preserving the letter descenders. Existing Chinese welcome copy is separate from the logo and remains unchanged.

## Layout

The account sidebar owns navigation on large screens. Content uses the existing `.page-section` width and becomes a single column below 720px. Settings sections are grouped by external service or operational purpose, rather than by implementation details.

## Shapes

Reuse `--radius-sm`, `--radius-md`, and `--radius-lg` from `frontend-dist/account/account.css`. New controls follow the existing button, form field, toast, and dialog patterns.

## Components

Sensitive values are masked by default and use a local reveal control. Save uses server-confirmed feedback; unsaved settings use the existing app dialog treatment before navigation.

Welcome-page wallpapers use the existing native settings shell, fields, save feedback, and unsaved-change dialog. Their ordered queue is independent of workspace wallpaper settings. Administrators can adjust desktop and phone crop positions separately; the welcome page retains its theme-aware text overlay and pauses automatic changes when the page is hidden or reduced motion is requested.

Website settings use that same native shell and only expose controls consumed by the current pages. Brand names, titles, icons, logo links, and public file link prefixes are owned by `frontend-dist/site-config.js`; page entry points load `site.js`, while dynamic headings and titles use the shared APIs. Channel selection uses a native select with the operating system's popup behavior. Workspace wallpaper playback shares `frontend-dist/wallpaper-player.js` with the welcome page, retaining separate settings and existing millisecond units for workspace intervals.

Security settings reuse the native shell for active moderation, upload location records, file access, and management API tokens. The interface explains Discord sign-in and excludes legacy password and session controls. Review service credentials stay masked; only the selected service's credential is shown. Token creation is optional, displays the complete token only after successful creation, and keeps creation and revocation separate from saving site policies. Whitelist wording makes clear that it affects public access to all files.

## Do's and Don'ts

Do explain what an administrator controls in plain Chinese. Do preserve clear loading, error, and empty states. Do not add a second design-token system, store sensitive settings in browser storage, or expose retired storage providers as configurable options.
