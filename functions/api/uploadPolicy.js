import { fetchPageConfig } from '../utils/sysConfig.js';

const DEFAULT_POLICY = Object.freeze({
    convertToWebp: false,
    customerCompress: false,
    compressBar: 5,
    compressQuality: 4,
    serverCompress: false,
});

function getConfigItem(pageConfig, id) {
    return pageConfig?.config?.find(item => item?.id === id) || null;
}

function readConfigValue(pageConfig, id, fallback) {
    const item = getConfigItem(pageConfig, id);
    if (!item) return fallback;

    const rawValue = item.value;
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return item.default !== undefined ? item.default : fallback;
    }

    if (typeof rawValue !== 'string') return rawValue;

    try {
        return JSON.parse(rawValue);
    } catch {
        return rawValue;
    }
}

function toBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return fallback;
}

function toNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function buildPolicy(pageConfig) {
    const customerCompress = toBoolean(
        readConfigValue(pageConfig, 'defaultCustomerCompress', DEFAULT_POLICY.customerCompress),
        DEFAULT_POLICY.customerCompress,
    );

    const policy = {
        convertToWebp: toBoolean(
            readConfigValue(pageConfig, 'defaultConvertToWebp', DEFAULT_POLICY.convertToWebp),
            DEFAULT_POLICY.convertToWebp,
        ),
        customerCompress,
        compressBar: toNumber(
            readConfigValue(pageConfig, 'defaultCompressBar', DEFAULT_POLICY.compressBar),
            DEFAULT_POLICY.compressBar,
            1,
            20,
        ),
        compressQuality: toNumber(
            readConfigValue(pageConfig, 'defaultCompressQuality', DEFAULT_POLICY.compressQuality),
            DEFAULT_POLICY.compressQuality,
            0.5,
            20,
        ),
        // There is no independent admin field in the current management UI yet.
        // Use defaultServerCompress when available; otherwise follow the admin's
        // general compression policy instead of a browser/user preference.
        serverCompress: toBoolean(
            readConfigValue(pageConfig, 'defaultServerCompress', customerCompress),
            customerCompress,
        ),
    };

    // The bundled client compressor does not preserve WebP output correctly when
    // it runs after WebP conversion. Never allow the two destructive preprocessing
    // stages to run together. WebP conversion wins when the admin explicitly enables it.
    if (policy.convertToWebp && policy.customerCompress) {
        policy.customerCompress = false;
    }

    // A target larger than the trigger threshold is meaningless.
    policy.compressQuality = Math.min(policy.compressQuality, policy.compressBar);

    return policy;
}

function buildBootstrapScript(policy) {
    const serializedPolicy = JSON.stringify(policy).replace(/</g, '\\u003c');

    return `(() => {
  const policy = Object.freeze(${serializedPolicy});
  window.__IMGBED_UPLOAD_POLICY__ = policy;

  // vuex-persistedstate uses the "vuex" localStorage key in the bundled client.
  // Replace old per-user image-processing choices before Vue creates the store,
  // so the admin policy is authoritative on every page load.
  try {
    const rawState = localStorage.getItem('vuex');
    const persistedState = rawState ? JSON.parse(rawState) : {};
    persistedState.compressConfig = {
      convertToWebp: policy.convertToWebp,
      customerCompress: policy.customerCompress,
      compressBar: policy.compressBar,
      compressQuality: policy.compressQuality,
      serverCompress: policy.serverCompress,
    };
    localStorage.setItem('vuex', JSON.stringify(persistedState));
  } catch (error) {
    console.warn('[ImgBed] Unable to apply upload policy to persisted state:', error);
  }

  // Only simplify the creator upload UI. Admin configuration pages use the same
  // legacy shell and must keep the processing controls visible.
  const isStudioPage = () => /^\\/studio\\/?$/.test(window.location.pathname);

  const hideTechnicalImageControls = () => {
    if (!isStudioPage()) return;

    document.querySelectorAll('.setting-item').forEach((item) => {
      const text = (item.textContent || '').trim();
      if (/webp|compress|compression|压缩/i.test(text)) {
        item.style.display = 'none';
        item.setAttribute('aria-hidden', 'true');
      }
    });

    // Do not leave an empty technical section/header behind after its controls
    // are hidden. User-facing settings such as folder and naming stay untouched.
    document.querySelectorAll('.section-content').forEach((content) => {
      const items = Array.from(content.querySelectorAll('.setting-item'));
      if (items.length === 0) return;
      const allHidden = items.every(item => item.style.display === 'none');
      if (!allHidden) return;

      content.style.display = 'none';
      const header = content.previousElementSibling;
      if (header?.classList?.contains('section-header')) {
        header.style.display = 'none';
      }
    });
  };

  const startUiGuard = () => {
    if (!isStudioPage()) return;
    hideTechnicalImageControls();
    const observer = new MutationObserver(hideTechnicalImageControls);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUiGuard, { once: true });
  } else {
    startUiGuard();
  }
})();`;
}

export async function onRequest(context) {
    if (context.request.method !== 'GET') {
        return new Response('Method Not Allowed', {
            status: 405,
            headers: { Allow: 'GET' },
        });
    }

    const pageConfig = await fetchPageConfig(context.env);
    const policy = buildPolicy(pageConfig);

    return new Response(buildBootstrapScript(policy), {
        status: 200,
        headers: {
            'Content-Type': 'application/javascript; charset=UTF-8',
            'Cache-Control': 'private, no-store, max-age=0',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}
