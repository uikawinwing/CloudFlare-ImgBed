import { getSiteConfig } from '../site-config.js';
import { startWallpaperPlayer } from '../wallpaper-player.js';

export function applyWallpaperConfig(config) {
  if (config?.enabled !== false && config?.items?.length
    && (!Number.isInteger(config.intervalSeconds) || config.intervalSeconds < 5 || config.intervalSeconds > 3600)) {
    console.warn('Welcome wallpaper configuration is invalid; keeping the default wallpaper.');
    return () => {};
  }
  return startWallpaperPlayer({ ...config, intervalMs: config?.intervalSeconds * 1000 }, { prefix: 'welcome-wallpaper' });
}

export async function initializeWelcomeWallpaper() {
  try {
    const config = (await getSiteConfig()).welcomeWallpaper;
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
