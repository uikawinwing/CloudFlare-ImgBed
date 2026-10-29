const defaultConfig = Object.freeze({
  siteTitle: 'Charatopia',
  ownerName: 'Charatopia',
  siteIcon: '/static/media/logo.png',
  logoUrl: '',
  logoLink: '/',
  urlPrefix: '',
});

let configPromise;
let requestVersion = 0;
let siteConfig = defaultConfig;
let pageLabel = null;

export function safeSiteUrl(value, fallback = '') {
  if (typeof value !== 'string' || /[\\\u0000-\u001f\u007f-\u009f]/.test(value)) return fallback;
  const candidate = value.trim();
  if (!/^https?:\/\//i.test(candidate) && (!candidate.startsWith('/') || candidate.startsWith('//'))) return fallback;
  try {
    const url = new URL(candidate, 'https://site.invalid');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? candidate : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeSiteConfig(config = {}) {
  const value = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const text = (name, fallback) => typeof value[name] === 'string' && value[name].trim() ? value[name].trim() : fallback;
  let urlPrefix = safeSiteUrl(value.urlPrefix);
  if (/[?#]/.test(urlPrefix)) urlPrefix = '';
  return {
    ...value,
    siteTitle: text('siteTitle', defaultConfig.siteTitle),
    ownerName: text('ownerName', defaultConfig.ownerName),
    siteIcon: safeSiteUrl(value.siteIcon, defaultConfig.siteIcon),
    logoUrl: safeSiteUrl(value.logoUrl),
    logoLink: safeSiteUrl(value.logoLink, defaultConfig.logoLink),
    urlPrefix,
  };
}

export function getSiteConfig({ rejectOnError = false } = {}) {
  if (!configPromise) {
    const version = ++requestVersion;
    configPromise = (async () => {
      let config = siteConfig;
      try {
        const response = await fetch('/api/userConfig', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('站点设置暂时无法读取');
        config = normalizeSiteConfig(await response.json());
      } catch (error) {
        if (version !== requestVersion) return getSiteConfig();
        if (rejectOnError) throw error;
        console.warn('站点设置暂时无法读取，将使用当前设置。', error);
      }
      if (version !== requestVersion) return getSiteConfig();
      siteConfig = config;
      return config;
    })();
  }
  return configPromise;
}

export function setSitePageTitle(label = '', config = siteConfig) {
  pageLabel = String(label || '');
  const title = normalizeSiteConfig(config).siteTitle;
  document.title = pageLabel ? `${pageLabel} · ${title}` : title;
}

export function applySiteBranding(root = document, config = siteConfig) {
  const value = normalizeSiteConfig(config);
  root.querySelectorAll('[data-site-name]').forEach(element => { element.textContent = value.ownerName; });
  root.querySelectorAll('[data-site-link]').forEach(element => {
    element.setAttribute('href', value.logoLink);
    element.setAttribute('aria-label', `${value.ownerName} 首页`);
  });
  root.querySelectorAll('[data-site-logo]').forEach(element => {
    element.querySelector('[data-site-logo-image]')?.remove();
    const fallback = element.querySelector('[data-site-logo-fallback]');
    if (fallback) fallback.hidden = Boolean(value.logoUrl);
    if (!value.logoUrl) return;
    const image = document.createElement('img');
    image.setAttribute('data-site-logo-image', '');
    image.src = value.logoUrl;
    image.alt = '';
    image.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain';
    image.addEventListener('error', () => { image.remove(); if (fallback) fallback.hidden = false; }, { once: true });
    element.append(image);
  });
  if (root === document) {
    let icon = document.querySelector('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.append(icon);
    }
    icon.href = value.siteIcon;
    setSitePageTitle(pageLabel ?? document.documentElement.dataset.sitePageTitle ?? '', value);
  }
}

export async function refreshSiteConfig() {
  configPromise = null;
  let config;
  try {
    config = await getSiteConfig({ rejectOnError: true });
  } catch (error) {
    configPromise = Promise.resolve(siteConfig);
    throw error;
  }
  applySiteBranding(document, config);
  window.dispatchEvent(new CustomEvent('charatopia:site-config-change', { detail: config }));
  return config;
}

export function publicFileUrl(fileId, config = siteConfig, origin = globalThis.location?.origin) {
  const path = String(fileId).split('/').map(encodeURIComponent).join('/');
  const prefix = normalizeSiteConfig(config).urlPrefix.replace(/\/+$/, '');
  const target = prefix ? `${prefix}/${path}` : `/file/${path}`;
  return origin ? new URL(target, origin).href : target;
}
