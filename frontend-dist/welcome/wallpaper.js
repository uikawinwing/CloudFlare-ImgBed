function validImage(item) {
  if (!item || typeof item.url !== 'string' || !item.url.trim()) return false;
  if (item.url.includes('\\') || (!/^https?:\/\//i.test(item.url) && !/^\/(?!\/)/.test(item.url))) return false;
  return ['positionX', 'positionY', 'mobilePositionX', 'mobilePositionY'].every(key =>
    Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= 100);
}

export function applyWallpaperConfig(config) {
  const style = document.body.style;
  if (config?.enabled === false || (Array.isArray(config?.items) && !config.items.length)) {
    style.setProperty('--welcome-wallpaper-image', 'none');
    return () => {};
  }
  if (config?.enabled !== true || !Array.isArray(config.items) || !config.items.every(validImage)
    || !Number.isInteger(config.intervalSeconds) || config.intervalSeconds < 5 || config.intervalSeconds > 3600
    || !Number.isFinite(config.opacity) || config.opacity < 0 || config.opacity > 1) {
    console.warn('Welcome wallpaper configuration is invalid; keeping the default wallpaper.');
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
    timer = window.setTimeout(showNext, config.intervalSeconds * 1000);
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
      style.setProperty('--welcome-wallpaper-image', `url(${JSON.stringify(item.url)})`);
      style.setProperty('--welcome-wallpaper-opacity', String(config.opacity));
      style.setProperty('--welcome-wallpaper-x', `${item.positionX}%`);
      style.setProperty('--welcome-wallpaper-y', `${item.positionY}%`);
      style.setProperty('--welcome-wallpaper-mobile-x', `${item.mobilePositionX}%`);
      style.setProperty('--welcome-wallpaper-mobile-y', `${item.mobilePositionY}%`);
      finish();
    };
    image.onerror = () => {
      if (stopped) return;
      console.warn('Welcome wallpaper could not be loaded; keeping the current wallpaper.');
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
    if (!event.persisted) {
      stop();
      return;
    }
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

export async function initializeWelcomeWallpaper() {
  try {
    const response = await fetch('/api/userConfig', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Wallpaper configuration returned ${response.status}`);
    const config = (await response.json()).welcomeWallpaper;
    if (config === undefined || config === null) {
      console.warn('Welcome wallpaper configuration is unavailable; keeping the default wallpaper.');
      return () => {};
    }
    return applyWallpaperConfig(config);
  } catch (error) {
    console.warn('Welcome wallpaper configuration could not be loaded; keeping the default wallpaper.', error);
    return () => {};
  }
}
