import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { readLegacyDraft } from '../frontend-dist/charinfo/retired.js';

const creatorSource = readFileSync(new URL('../frontend-dist/charinfo/index.html', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../frontend-dist/_redirects', import.meta.url), 'utf8');

describe('historical Creator upload file ID contract', () => {
  let fileIdFromUpload;
  before(() => {
    const source = readFileSync(new URL('../frontend-src/charinfo/hosted-workflow.js', import.meta.url), 'utf8');
    const start = source.indexOf('function fileIdFromUpload(');
    assert.ok(start >= 0, 'upload response parsing must have a single entry point');
    const end = source.indexOf('async function requestJson(', start);
    fileIdFromUpload = new Function('location', `return (${source.slice(start, end).trim()});`)({ origin: 'https://example.test' });
  });

  it('uses the server ID without decoding it or relying on the response URL path', () => {
    assert.strictEqual(fileIdFromUpload({ fileId: 'users/owner/a%20b.png', src: 'https://cdn.example.test/different-path.png' }), 'users/owner/a%20b.png');
  });

  it('keeps the old URL format as a fallback when the server ID is absent', () => {
    assert.strictEqual(fileIdFromUpload({ src: '/file/users/owner/a%20b.png?v=1' }), 'users/owner/a b.png');
    assert.throws(() => fileIdFromUpload({ src: '/unrecognized-path.png' }), /上传响应没有返回有效的图片位置/);
  });
});

describe('retired CharInfo editor', () => {
  it('serves a read-only transition for the root, album deep link and old worldbook aliases', () => {
    assert.match(creatorSource, /角色编辑已移至 ST/);
    assert.match(creatorSource, /href="\/account\/\?view=albums">管理我的图库/);
    assert.match(creatorSource, /下载旧草稿备份/);
    assert.doesNotMatch(creatorSource, /<form\b|<textarea\b|contenteditable|profile-core\.js|hosted-workflow\.js|editor\.css|importWorldbookFile|mergeSource/);
    assert.strictEqual(existsSync(new URL('../frontend-dist/charinfo/worldbook/index.html', import.meta.url)), false);
    for (const path of ['/charinfo/worldbook', '/charinfo/worldbook/', '/charinfo/worldbook/*']) {
      assert.ok(redirects.split(/\r?\n/).includes(`${path} /charinfo/ 302`));
    }
    assert.doesNotMatch(creatorSource, /searchParams\.get\('album'\)|loadAlbumProfileFromQuery/);
  });

  it('removes normal navigation into the editor and stops building it as part of Worker deployment', () => {
    for (const path of ['index.html', 'discover/index.html', 'account/shell.js']) {
      const source = readFileSync(new URL(`../frontend-dist/${path}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /CharInfo Creator|href[=:]\s*['"]\/charinfo\//);
    }
    const build = readFileSync(new URL('../deploy/worker/generate-routes.js', import.meta.url), 'utf8');
    assert.doesNotMatch(build, /import '\.\/build-charinfo-editor\.js'/);
    assert.strictEqual(existsSync(new URL('../functions/api/public/album-gallery/[albumId].js', import.meta.url)), true);
    assert.strictEqual(existsSync(new URL('../functions/api/public/charinfo/[albumId].js', import.meta.url)), true);
    assert.strictEqual(existsSync(new URL('../functions/api/user/charinfo/complete.js', import.meta.url)), true);
  });

  it('reads the complete existing draft with a readonly transaction and never modifies it', async () => {
    const draft = { version: 3, sourceDraftText: '未完成原稿', worldbook: { document: { entries: {} } }, editor: { characterName: '角色' }, cart: { items: {} }, hosted: { albumId: 'existing' } };
    const operations = [];
    const db = {
      objectStoreNames: { contains: name => name === 'workspace' },
      transaction(store, mode) {
        operations.push([store, mode]);
        return { objectStore: () => ({ get(key) { operations.push(['get', key]); const request = { result: draft }; queueMicrotask(() => request.onsuccess()); return request; } }) };
      },
      close() { operations.push(['close']); },
    };
    const result = await readLegacyDraft({ open(name) { assert.strictEqual(name, 'charinfo-creator-editor'); const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } });
    assert.strictEqual(result, draft);
    assert.deepStrictEqual(operations, [['workspace', 'readonly'], ['get', 'current'], ['close']]);
    assert.strictEqual(draft.sourceDraftText, '未完成原稿');
  });

  it('does not create a database when this browser has no old draft', async () => {
    let aborted = false;
    const result = await readLegacyDraft({ open() {
      const request = { transaction: { abort() { aborted = true; queueMicrotask(() => request.onerror()); } } };
      queueMicrotask(() => request.onupgradeneeded());
      return request;
    } });
    assert.strictEqual(result, null);
    assert.strictEqual(aborted, true);
  });

  it('reports browser storage failures instead of deleting or silently replacing draft data', async () => {
    await assert.rejects(readLegacyDraft({ open() {
      const request = { error: new Error('Storage denied') };
      queueMicrotask(() => request.onerror());
      return request;
    } }), /Storage denied/);
  });

  it('closes a late database connection after a blocked request has already failed', async () => {
    let request, closed = false;
    await assert.rejects(readLegacyDraft({ open() {
      request = { result: { close() { closed = true; } } };
      queueMicrotask(() => request.onblocked());
      return request;
    } }), /请关闭其他使用本站的标签页后重试/);
    request.onsuccess();
    assert.strictEqual(closed, true);
  });
});
