function normalizeVisibilityControls(root = document) {
  root.querySelectorAll?.('.file-visibility').forEach(select => {
    const legacyUnlisted = select.querySelector('option[value="unlisted"]');
    if (legacyUnlisted) {
      const wasUnlisted = select.value === 'unlisted';
      legacyUnlisted.remove();
      if (wasUnlisted) {
        select.value = 'private';
        queueMicrotask(() => select.dispatchEvent(new Event('change', { bubbles: true })));
      }
    }
    const card = select.closest('.media-card');
    const help = card?.querySelector('.file-visibility-help');
    if (help) help.textContent = select.value === 'public'
      ? '公开后会进入发现页，并可用于公开图库。'
      : '仅在自己的工作室管理，不进入公开目录。';
  });
  root.querySelectorAll?.('.discover-option').forEach(node => node.remove());
  root.querySelectorAll?.('.toast').forEach(node => {
    if (/已公开.*发现页/.test(node.textContent)) node.textContent = '已设为公开，会出现在发现页。';
  });
}

function toggleUnifiedTheme() {
  const nativeToggle = !location.pathname.startsWith('/account')
    ? document.querySelector('#themeToggle, .toggle-dark-button.desktop-only, .toggle-dark-button')
    : null;
  nativeToggle?.click();
  window.ImgBedTheme?.toggle?.();
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-legacy-command="theme"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleUnifiedTheme();
}, true);

const observer = new MutationObserver(records => {
  for (const record of records) {
    record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) normalizeVisibilityControls(node);
    });
  }
});

if (document.body) {
  normalizeVisibilityControls();
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    normalizeVisibilityControls();
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
