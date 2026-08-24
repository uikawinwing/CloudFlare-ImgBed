import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../frontend-dist/account/account.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend-dist/account/account.css', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../frontend-dist/account/shell.js', import.meta.url), 'utf8');
const uploadSource = readFileSync(new URL('../frontend-dist/account/upload-in-files.js', import.meta.url), 'utf8');
const creatorSource = readFileSync(new URL('../frontend-dist/charinfo/index.html', import.meta.url), 'utf8');
const discoverSource = readFileSync(new URL('../frontend-dist/discover/discover.js', import.meta.url), 'utf8');
const discoverPage = readFileSync(new URL('../frontend-dist/index.html', import.meta.url), 'utf8');
const accountPage = readFileSync(new URL('../frontend-dist/account/index.html', import.meta.url), 'utf8');
const previewStyles = readFileSync(new URL('../frontend-dist/preview-style.css', import.meta.url), 'utf8');

describe('account media and album UI', () => {
  it('provides clear Creator entry points from the workspace and each configured Album', () => {
    assert.match(shellSource, /key: 'charinfo', label: 'CharInfo Creator', href: '\/charinfo\/'/);
    assert.match(source, /class="button primary" href="\/charinfo\/\?album=\$\{encodeURIComponent\(album\.id\)\}">打开 Creator/);
    assert.match(creatorSource, /href="\/account\/\?view=albums">返回我的图库/);
  });

  it('uses a compact upload entry and hides internal thumbnail actions', () => {
    assert.doesNotMatch(source, /href="\/studio"/);
    assert.doesNotMatch(uploadSource, /headActions\.append\(button\)/);
    assert.match(source, /data-integrated-upload-trigger[\s\S]*上传文件/);
    assert.match(uploadSource, /const trigger = section\.querySelector\('\[data-integrated-upload-trigger\]'\)/);
    assert.match(styles, /\.media-select[\s\S]*appearance: none/);
    assert.doesNotMatch(source, /data-copy-thumbnail/);
  });

  it('keeps the masonry feed media-first until the user opens an item', () => {
    assert.match(source, /selectionMode:\s*false/);
    assert.match(source, /id="toggleSelectionMode"[\s\S]*批量选择/);
    assert.match(source, /state\.selectionMode\s*\?\s*`<input class="media-select"/);
    assert.doesNotMatch(source, /selection-guidance/);
    assert.doesNotMatch(source, /file-visibility-help/);
    assert.doesNotMatch(uploadSource, /integrated-upload-helper/);
  });

  it('opens a viewport-sized media viewer on the first card click', () => {
    assert.match(source, /class="media-frame"[\s\S]*data-open-media/);
    assert.match(source, /\[data-open-media\][\s\S]*openFileViewer/);
    assert.match(source, /function openFileViewer\(file\)/);
    assert.match(styles, /\.media-viewer-dialog\s*\{[^}]*width:\s*100vw[^}]*height:\s*100dvh/);
    assert.match(styles, /\.media-viewer-dialog \.file-preview-media img[^}]*object-fit:\s*contain/);
    assert.match(styles, /\.dialog-backdrop:has\(\.media-viewer-dialog\)\s*\{[^}]*padding:\s*0/);
  });

  it('lets selected files be added to a newly created album from the picker', () => {
    assert.match(source, /id="createAlbumForSelection"[\s\S]*?新建图库/);
    assert.match(source, /albumDialog\(null, \{ onCreated: addSelectedFilesToAlbum \}\)/);
    assert.match(source, /await onCreated\(savedAlbum\.id\)/);
  });

  it('uses an uncropped media preview with an original-size link', () => {
    assert.match(source, /class="file-preview-media"/);
    assert.match(source, /打开原始尺寸/);
    assert.match(styles, /\.file-preview-media img, \.file-preview-media video[\s\S]*?object-fit: contain/);
    assert.match(source, /event\.key === 'Escape'/);
  });

  it('does not show a play overlay on autoplaying video cards', () => {
    assert.doesNotMatch(source, /<span class="play" aria-hidden="true"><\/span>/);
    assert.doesNotMatch(styles, /^\.play/m);
  });

  it('sizes video pins from their real frame and auto-previews them in Discover', () => {
    assert.match(source, /loadedmetadata[\s\S]*videoWidth[\s\S]*videoHeight[\s\S]*aspectRatio/);
    assert.match(discoverSource, /<video[^>]*autoplay[^>]*muted[^>]*loop[^>]*playsinline/);
    assert.match(discoverSource, /loadedmetadata[\s\S]*videoWidth[\s\S]*videoHeight[\s\S]*pinMedia\.style\.aspectRatio/);
    assert.match(discoverSource, /IntersectionObserver[\s\S]*\.play\(\)/);
    assert.match(discoverSource, /\.album-cover video/);
    assert.doesNotMatch(discoverSource, /discover-play|play-overlay|▶/);
    assert.doesNotMatch(discoverSource, /video-placeholder|play-symbol/);
  });

  it('does not let the late preview stylesheet collapse real-ratio video pins', () => {
    assert.ok(accountPage.indexOf('/preview-style.css') > accountPage.indexOf('/account/account.css'));
    assert.doesNotMatch(previewStyles, /\.media-frame video\s*\{/);
  });

  it('keeps sharing buttons available when the owner has a handle, regardless of discover visibility', () => {
    assert.match(source, /const canShare = Boolean\(state\.user\.publicHandle\)/);
    assert.match(source, /const canShareCharInfo = canShare && Boolean\(album\.charInfoCharacterName\)/);
    assert.doesNotMatch(source, /const canShare = album\.visibility === 'public'/);
    assert.match(source, /\/api\/public\/charinfo\/\$\{encodeURIComponent\(album\.id\)\}/);
  });

  it('renders public albums returned by Discover', () => {
    assert.match(discoverPage, /id="albumGrid"/);
    assert.match(discoverSource, /const firstPage = reset \|\| !state\.items\.length/);
    assert.match(discoverSource, /if \(firstPage\) state\.albums = Array\.isArray\(body\.albums\)/);
    assert.match(discoverSource, /album\.coverThumbnailUrl \|\| album\.coverUrl/);
  });

  it('keeps albums as compact cards and reveals secondary actions on demand', () => {
    assert.match(styles, /\.album-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*320px\)\)[^}]*justify-content:\s*start/);
    assert.match(styles, /\.album-cover\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/);
    assert.doesNotMatch(styles, /\.album-row\s*\{[^}]*grid-template-columns:\s*minmax\(210px,\s*280px\)\s+1fr/);
    assert.match(source, /<details class="album-actions-menu">[\s\S]*<summary[^>]*>管理图库<\/summary>[\s\S]*class="album-actions"/);
  });
});
