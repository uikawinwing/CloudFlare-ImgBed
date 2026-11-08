import { initializeWelcomeWallpaper } from './wallpaper.js';

async function enterWorkspace() {
  try {
    const response = await fetch('/api/user/me', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok && (await response.json()).authenticated) {
      location.replace('/account/?view=files');
      return;
    }
  } catch {}
  document.documentElement.classList.remove('welcome-checking');
  initializeWelcomeWallpaper();
}

enterWorkspace();
