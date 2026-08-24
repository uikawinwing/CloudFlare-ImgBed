import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../frontend-dist/account/account.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend-dist/account/account.css', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../frontend-dist/account/shell.js', import.meta.url), 'utf8');
const uploadSource = readFileSync(new URL('../frontend-dist/account/upload-in-files.js', import.meta.url), 'utf8');
const creatorSource = readFileSync(new URL('../frontend-dist/charinfo/index.html', import.meta.url), 'utf8');
const discoverSource = readFileSync(new URL('../frontend-dist/discover/discover.js', import.meta.url), 'utf8');
const discoverPage = readFileSync(new URL('../frontend-dist/index.html', import.meta.url), 'utf8');

describe('account media and album UI', () => {
  it('provides clear Creator entry points from the workspace and each configured Album', () => {
    assert.match(shellSource, /key: 'charinfo', label: 'CharInfo Creator', href: '\/charinfo\/'/);
    assert.match(source, /class="button primary" href="\/charinfo\/\?album=\$\{encodeURIComponent\(album\.id\)\}">打开 Creator/);
    assert.match(creatorSource, /href="\/account\/\?view=albums">返回我的图库/);
  });

  it('uses one upload entry, explains selection, and hides internal thumbnail actions', () => {
    assert.doesNotMatch(source, /href="\/studio"/);
    assert.doesNotMatch(uploadSource, /headActions\.append\(button\)/);
    assert.match(uploadSource, /integrated-upload-helper[\s\S]*选择文件/);
    assert.match(source, /勾选文件卡左上角/);
    assert.match(styles, /\.media-select[\s\S]*appearance: none/);
    assert.doesNotMatch(source, /data-copy-thumbnail/);
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
});
