const STORAGE_KEY = 'imgbed-theme';
const media = window.matchMedia?.('(prefers-color-scheme: dark)');

function normalizeTheme(value) {
  return value === 'dark' || value === 'light' ? value : null;
}

function preferredTheme() {
  try {
    const stored = normalizeTheme(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {}
  return media?.matches ? 'dark' : 'light';
}

function themeColor(theme) {
  return theme === 'dark' ? '#08111e' : '#f6f4ef';
}

function syncThemeButtons(theme) {
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.dataset.themeState = theme;
    button.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
    button.setAttribute('title', theme === 'dark' ? '浅色主题' : '深色主题');
  });
}

export function applyTheme(theme, { persist = false } = {}) {
  const next = normalizeTheme(theme) || preferredTheme();
  document.documentElement.dataset.theme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor(next));
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }
  syncThemeButtons(next);
  window.dispatchEvent(new CustomEvent('imgbed-theme-change', { detail: { theme: next } }));
  return next;
}

export function toggleTheme() {
  const current = normalizeTheme(document.documentElement.dataset.theme) || preferredTheme();
  return applyTheme(current === 'dark' ? 'light' : 'dark', { persist: true });
}

export function getTheme() {
  return normalizeTheme(document.documentElement.dataset.theme) || preferredTheme();
}

window.ImgBedTheme = { apply: applyTheme, toggle: toggleTheme, get: getTheme };
applyTheme(preferredTheme());

document.addEventListener('click', event => {
  if (event.target.closest('[data-theme-toggle]')) toggleTheme();
});

document.addEventListener('DOMContentLoaded', () => syncThemeButtons(getTheme()));
media?.addEventListener?.('change', () => {
  let stored = null;
  try { stored = normalizeTheme(localStorage.getItem(STORAGE_KEY)); } catch {}
  if (!stored) applyTheme(preferredTheme());
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY) applyTheme(normalizeTheme(event.newValue) || preferredTheme());
});
