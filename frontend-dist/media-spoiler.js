export const spoilerAction = ' data-reveal-media aria-description="点击显示 NSFW 内容"';

export function spoilerBadge(nsfw, button = false) {
  if (!nsfw) return '';
  return button
    ? '<button class="media-spoiler-badge" type="button" data-reveal-media aria-label="显示 NSFW 内容">NSFW</button>'
    : '<span class="media-spoiler-badge">NSFW</span>';
}

export function enableSpoilerPreviews() {
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-reveal-media]');
    const preview = control?.closest('[data-media-spoiler]') || control?.querySelector('[data-media-spoiler]');
    if (!preview) return;
    event.preventDefault();
    event.stopPropagation();
    preview.removeAttribute('data-media-spoiler');
    control.removeAttribute('aria-description');
    const badge = preview.querySelector('.media-spoiler-badge');
    if (document.activeElement === badge) {
      preview.tabIndex = -1;
      preview.focus({ preventScroll: true });
    }
    badge.remove();
  }, true);
}
