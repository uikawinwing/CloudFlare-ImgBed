---
version: alpha
colors:
  background: "#ffffff"
  surface: "rgba(255, 255, 255, .94)"
  text: "#111111"
  muted: "#767676"
  accent: "#e60023"
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

Use the existing red accent for primary actions, green for confirmed success, and the danger token for destructive operations. Light mode uses white surfaces and dark text; dark mode uses a #121212 background, #1a1a1a surfaces, and #f5f5f5 text. Keep explanatory text muted and form labels readable. Use theme variables rather than fixed dark backgrounds on shared controls.

## Typography

Use the existing system font stack so Simplified Chinese labels stay stable without a remote font dependency. Headings are concise and task-focused.

## Layout

The account sidebar owns navigation on large screens. Content uses the existing `.page-section` width and becomes a single column below 720px. Settings sections are grouped by external service or operational purpose, rather than by implementation details.

## Shapes

Reuse `--radius-sm`, `--radius-md`, and `--radius-lg` from `frontend-dist/account/account.css`. New controls follow the existing button, form field, toast, and dialog patterns.

## Components

Sensitive values are masked by default and use a local reveal control. Save uses server-confirmed feedback; unsaved settings use the existing app dialog treatment before navigation.

## Do's and Don'ts

Do explain what an administrator controls in plain Chinese. Do preserve clear loading, error, and empty states. Do not add a second design-token system, store sensitive settings in browser storage, or expose retired storage providers as configurable options.
