import { getSiteConfig, safeSiteUrl } from './site-config.js';

export function isWallpaperUrl(value) {
  return Boolean(safeSiteUrl(value));
}

function validImage(item) {
  return item && isWallpaperUrl(item.url) && ['positionX', 'positionY', 'mobilePositionX', 'mobilePositionY'].every(key =>
    Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= 100);
}

export function startWallpaperPlayer(config, { prefix }) {
  const style = document.body.style;
  if (config?.enabled === false || (Array.isArray(config?.items) && !config.items.length)) {
    style.setProperty(`--${prefix}-image`, 'none');
    style.setProperty(`--${prefix}-overlay`, 'none');
    return () => {};
  }
  if (config?.enabled !== true || !Array.isArray(config.items) || !config.items.every(validImage)
    || !Number.isFinite(config.intervalMs) || config.intervalMs <= 0
    || !Number.isFinite(config.opacity) || config.opacity < 0 || config.opacity > 1) {
    console.warn('Wallpaper configuration is invalid; keeping the current background.');
    return () => {};
  }

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = null;
  let nextIndex = 0;
  let stopped = false;
  let suspended = false;
  let loading = false;
  let pendingImage = null;

  function pause() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    pause();
    if (stopped || suspended || loading || document.hidden || motion.matches || config.items.length < 2) return;
    timer = window.setTimeout(showNext, config.intervalMs);
  }

  function showNext() {
    timer = null;
    if (stopped || loading) return;
    const item = config.items[nextIndex];
    nextIndex = (nextIndex + 1) % config.items.length;
    loading = true;
    const image = new Image();
    pendingImage = image;
    image.onload = () => {
      if (stopped) return;
      style.setProperty(`--${prefix}-image`, `url(${JSON.stringify(item.url)})`);
      style.setProperty(`--${prefix}-opacity`, String(config.opacity));
      style.setProperty(`--${prefix}-x`, `${item.positionX}%`);
      style.setProperty(`--${prefix}-y`, `${item.positionY}%`);
      style.setProperty(`--${prefix}-mobile-x`, `${item.mobilePositionX}%`);
      style.setProperty(`--${prefix}-mobile-y`, `${item.mobilePositionY}%`);
      style.removeProperty(`--${prefix}-overlay`);
      finish();
    };
    image.onerror = () => {
      if (stopped) return;
      console.warn('Wallpaper could not be loaded; keeping the current background.');
      finish();
    };
    image.decoding = 'async';
    image.src = item.url;
  }

  function finish() {
    pendingImage.onload = null;
    pendingImage.onerror = null;
    pendingImage = null;
    loading = false;
    schedule();
  }

  function onVisibilityChange() {
    if (document.hidden) pause();
    else schedule();
  }

  function onMotionChange() {
    if (motion.matches) pause();
    else schedule();
  }

  function onPageHide(event) {
    if (!event.persisted) { stop(); return; }
    suspended = true;
    pause();
  }

  function onPageShow(event) {
    if (!event.persisted) return;
    suspended = false;
    schedule();
  }

  function stop() {
    stopped = true;
    pause();
    if (pendingImage) {
      pendingImage.onload = null;
      pendingImage.onerror = null;
      pendingImage = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    motion.removeEventListener('change', onMotionChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  motion.addEventListener('change', onMotionChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  showNext();
  return stop;
}

function workspaceWallpaperItems(value) {
  if (value === undefined || value === null || value === '') return [];
  if (value === 'bing') {
    console.warn('Bing wallpaper rotation is unavailable in this workspace. Configure image URLs instead.');
    return [];
  }
  const entries = Array.isArray(value) ? value : [value];
  const urls = entries.filter(isWallpaperUrl).map(url => url.trim());
  if (urls.length !== entries.length) console.warn('Some workspace wallpaper URLs are invalid and were ignored.');
  return urls.map(url => ({ url, positionX: 50, positionY: 50, mobilePositionX: 50, mobilePositionY: 50 }));
}

function resetWorkspaceBackground() {
  for (const field of ['image', 'opacity', 'overlay', 'x', 'y', 'mobile-x', 'mobile-y']) {
    document.body.style.removeProperty(`--account-wallpaper-${field}`);
  }
}

export async function initializeWorkspaceWallpaper({ isAdmin = false } = {}) {
  let stopPlayer = null;
  let disposed = false;
  let revision = 0;

  function apply(config) {
    if (disposed) return;
    stopPlayer?.();
    if (config.wallpaperEnabled === false) {
      stopPlayer = startWallpaperPlayer({ enabled: false }, { prefix: 'account-wallpaper' });
      return;
    }
    const adminImage = config.adminBkImg;
    const hasAdminImage = Array.isArray(adminImage) ? adminImage.length > 0 : typeof adminImage === 'string' && adminImage.trim();
    const items = workspaceWallpaperItems(isAdmin && hasAdminImage ? adminImage : config.uploadBkImg);
    if (!items.length) {
      resetWorkspaceBackground();
      stopPlayer = null;
      return;
    }
    const interval = Number(config.bkInterval ?? 3000);
    const opacity = Number(config.bkOpacity ?? 1);
    if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      console.warn('Workspace wallpaper timing or opacity is invalid; using the default value.');
    }
    stopPlayer = startWallpaperPlayer({
      enabled: true, items,
      intervalMs: Number.isFinite(interval) && interval > 0 ? interval : 3000,
      opacity: Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 ? opacity : 1,
    }, { prefix: 'account-wallpaper' });
  }

  function onConfigChange(event) { revision += 1; apply(event.detail); }
  function onPageHide(event) { if (!event.persisted) stop(); }
  function stop() {
    disposed = true;
    stopPlayer?.();
    window.removeEventListener('charatopia:site-config-change', onConfigChange);
    window.removeEventListener('pagehide', onPageHide);
  }

  window.addEventListener('charatopia:site-config-change', onConfigChange);
  window.addEventListener('pagehide', onPageHide);
  try {
    const config = await getSiteConfig();
    if (revision === 0) apply(config);
  } catch (error) {
    console.warn('Workspace wallpaper configuration could not be loaded; keeping the current background.', error);
  }
  return stop;
}
