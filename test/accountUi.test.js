import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../frontend-dist/account/account.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend-dist/account/account.css', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../frontend-dist/account/shell.js', import.meta.url), 'utf8');
const uploadSource = readFileSync(new URL('../frontend-dist/account/upload-in-files.js', import.meta.url), 'utf8');
const creatorSource = readFileSync(new URL('../frontend-dist/charinfo/index.html', import.meta.url), 'utf8');
const discoverSource = readFileSync(new URL('../frontend-dist/discover/discover.js', import.meta.url), 'utf8');
const welcomeSource = readFileSync(new URL('../frontend-dist/welcome/welcome.js', import.meta.url), 'utf8');
const welcomePage = readFileSync(new URL('../frontend-dist/index.html', import.meta.url), 'utf8');
const discoverRoutePage = readFileSync(new URL('../frontend-dist/discover/index.html', import.meta.url), 'utf8');
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
    assert.match(styles, /\.media-viewer-dialog\s*\{[^}]*width:\s*100%[^}]*height:\s*100dvh/);
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
    assert.match(source, /新标签页打开/);
    assert.match(styles, /\.file-preview-media img, \.file-preview-media video[\s\S]*?object-fit: contain/);
    assert.match(source, /event\.key === 'Escape'/);
  });

  it('loads the original image on the first open and bounds both axes of its preview stage', () => {
    const app = runInNewContext(`${source.replace(/^import .*;\r?\n/gm, '').replace(/\ninit\(\);\s*$/, '')}\nlet viewerMarkup; openDialog = content => { viewerMarkup = content; }; ({ openFileViewer, markup: () => viewerMarkup })`, {
      location: new URL('https://example.test/account/?view=files'), URLSearchParams,
      document: { querySelector: () => ({ querySelector: () => null }) },
    });
    app.openFileViewer({ id: 'users/owner/portrait.png', file_name: 'old-original-name.png', file_type: 'image/png', thumbnail_url: '/thumb/low-resolution.webp' });
    assert.match(app.markup(), /<img src="\/file\/users\/owner\/portrait\.png"/);
    assert.match(app.markup(), /<h2>portrait\.png<\/h2>/);
    assert.doesNotMatch(app.markup(), /old-original-name/);
    assert.doesNotMatch(app.markup(), /\/thumb\//);
    assert.match(styles, /\.media-viewer-dialog \.file-preview-media\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/);
  });

  it('does not show a play overlay on autoplaying video cards', () => {
    assert.doesNotMatch(source, /<span class="play" aria-hidden="true"><\/span>/);
    assert.doesNotMatch(styles, /^\.play/m);
  });

  it('sizes account video pins from their real frame and keeps Discover to album covers', () => {
    assert.match(source, /loadedmetadata[\s\S]*videoWidth[\s\S]*videoHeight[\s\S]*aspectRatio/);
    assert.match(discoverSource, /<video[^>]*data-video-src/);
    assert.match(discoverSource, /IntersectionObserver/);
    assert.doesNotMatch(discoverSource, /originalUrl\(/);
    assert.match(discoverSource, /album\.coverThumbnailUrl/);
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

  it('renders paginated albums returned by Discover', () => {
    assert.match(discoverRoutePage, /id="albumGrid"/);
    assert.match(discoverSource, /Array\.isArray\(body\.albums\)/);
    assert.match(discoverSource, /state\.albums\.push\(album\)/);
    assert.match(discoverSource, /state\.cursor = body\.nextCursor/);
    assert.doesNotMatch(discoverSource, /body\.files|sort=featured/);
  });

  it('keeps the root welcome page simple and the full feed in Discover', () => {
    assert.match(welcomePage, /href="\/discover\/"/);
    assert.match(welcomePage, /href="\/charinfo\/"/);
    assert.match(welcomePage, /class="primary-button welcome-primary"[^>]*>登录<\/a>/);
    assert.doesNotMatch(welcomePage, /id="albumGrid"|welcomeFeature|welcome-shortcut|Featured|精选作品/);
    assert.doesNotMatch(welcomeSource, /loadFeed|featured|localStorage/);
    assert.match(welcomePage, /returnTo=%2Faccount%2F%3Fview%3Dfiles"/);
  });

  it('keeps public section headings free of designer commentary', () => {
    assert.doesNotMatch(discoverRoutePage, /section-intro[^>]*>[\s\S]*?<p>/);
    assert.doesNotMatch(discoverRoutePage, /浏览创作者选择展示|所有设为公开的作品|由站点精选与推荐系统/);
  });

  it('keeps albums as compact cards and reveals secondary actions on demand', () => {
    assert.match(styles, /\.album-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(260px,\s*320px\)\)[^}]*justify-content:\s*start/);
    assert.match(styles, /\.album-cover\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/);
    assert.doesNotMatch(styles, /\.album-row\s*\{[^}]*grid-template-columns:\s*minmax\(210px,\s*280px\)\s+1fr/);
    assert.match(source, /<details class="album-actions-menu">[\s\S]*<summary[^>]*>分享与更多<\/summary>[\s\S]*class="album-actions"/);
    assert.match(source, /class="album-card-actions"[\s\S]*data-manage-album>打开图库/);
  });

  it('lets an owner choose an image cover and drag its focal point without changing album order', () => {
    assert.match(source, /function isStaticCoverFile\(file\)[\s\S]*file_type[\s\S]*image\//);
    assert.match(source, /data-edit-cover[\s\S]*调整封面/);
    assert.match(source, /function openAlbumCoverEditor\(album, item\)/);
    assert.match(source, /type="range"[\s\S]*水平焦点[\s\S]*type="range"[\s\S]*垂直焦点/);
    assert.match(source, /pointerdown[\s\S]*setPointerCapture[\s\S]*pointermove[\s\S]*updateFromDrag/);
    assert.match(source, /drag\.focusX\s*-\s*\(event\.clientX\s*-\s*drag\.clientX\)/);
    assert.match(source, /let activeDialogClose = null[\s\S]*activeDialogClose\?\.\(\)[\s\S]*document\.removeEventListener\('keydown', closeOnEscape\)/);
    assert.match(source, /coverFileId: item\.id, coverPositionX: Number\(xInput\.value\), coverPositionY: Number\(yInput\.value\)/);
    assert.match(discoverSource, /album\.coverPositionX[\s\S]*object-position/);
    assert.match(styles, /\.cover-focus-preview\s*\{[^}]*cursor:\s*grab[^}]*touch-action:\s*none/);
    assert.doesNotMatch(source, /把文件整理成可分享的图库/);
  });
});

describe('homepage sign-in routing', () => {
  async function welcome(response) {
    const redirects = [];
    const revealed = [];
    const requests = [];
    let timeout;
    const signal = {};
    let wallpaperInitializations = 0;
    await runInNewContext(welcomeSource.replace(/^import .*;\r?\n/gm, ''), {
      initializeWelcomeWallpaper: () => { wallpaperInitializations += 1; },
      fetch: async (url, options) => {
        requests.push({ url, options });
        if (response instanceof Error) throw response;
        return response;
      },
      AbortSignal: { timeout: milliseconds => { timeout = milliseconds; return signal; } },
      location: { replace: url => redirects.push(url) },
      document: { documentElement: { classList: { remove: value => revealed.push(value) } } },
    });
    return { redirects, revealed, requests, timeout, signal, wallpaperInitializations };
  }

  it('takes signed-in visitors directly to their studio without revealing the welcome page', async () => {
    const result = await welcome({ ok: true, json: async () => ({ authenticated: true }) });
    assert.deepEqual(result.redirects, ['/account/?view=files']);
    assert.deepEqual(result.revealed, []);
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].url, '/api/user/me');
    assert.equal(result.requests[0].options.cache, 'no-store');
    assert.equal(result.requests[0].options.signal, result.signal);
    assert.equal(result.timeout, 5000);
    assert.equal(result.wallpaperInitializations, 0);
  });

  it('shows the welcome page to guests without requesting Featured media', async () => {
    const result = await welcome({ ok: true, json: async () => ({ authenticated: false }) });
    assert.deepEqual(result.redirects, []);
    assert.deepEqual(result.revealed, ['welcome-checking']);
    assert.equal(result.requests.length, 1);
    assert.equal(result.requests[0].url, '/api/user/me');
    assert.equal(result.wallpaperInitializations, 1);
  });

  it('keeps welcome and login available when authentication cannot be checked', async () => {
    for (const response of [
      { ok: false, status: 401 },
      { ok: false, status: 500 },
      { ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } },
      new Error('Network unavailable'),
      Object.assign(new Error('Request timed out'), { name: 'TimeoutError' }),
    ]) {
      const result = await welcome(response);
      assert.deepEqual(result.redirects, []);
      assert.deepEqual(result.revealed, ['welcome-checking']);
    }
  });
});

describe('unified file workspace navigation', () => {
  function workspace(url = 'https://imgbed.example/account/?view=albums&album=summer') {
    return runInNewContext(`${source.replace(/^import .*;\r?\n/gm, '').replace(/\ninit\(\);\s*$/, '')}\n({ state, workspaceTargetFromUrl, buildWorkspaceUrl, workspaceHeader, albumDetailMarkup })`, {
      location: new URL(url), URL, URLSearchParams, document: { querySelector: () => ({}) },
    });
  }

  it('keeps the album deep link and a single sidebar entry for the workspace', () => {
    const app = workspace();
    assert.equal(app.state.albumId, 'summer');
    assert.equal(app.buildWorkspaceUrl().searchParams.get('album'), 'summer');
    assert.equal(app.workspaceTargetFromUrl('/account/?view=albums&album=winter').albumId, 'winter');
    assert.equal(app.workspaceTargetFromUrl('/account/?view=files&album=winter').albumId, null);
    assert.equal(app.workspaceTargetFromUrl('https://other.example/account/'), null);
    assert.doesNotMatch(shellSource, /key: 'albums', label:/);
  });

  it('renders both file and album navigation in the same workspace header', () => {
    const app = workspace();
    app.state.user = { role: 'member' };
    app.state.albums = [{ id: 'summer' }];
    const header = app.workspaceHeader();
    assert.match(header, /<h1>我的文件<\/h1>/);
    assert.match(header, /view=files/);
    assert.match(header, /view=albums" aria-current="page"/);
  });

  it('exposes adding and editing inside an empty album and escapes its name', () => {
    const app = workspace();
    app.state.user = { role: 'member', publicHandle: 'master' };
    const detail = app.albumDetailMarkup({ id: 'summer', name: '<Summer>', slug: 'summer', items: [] });
    assert.match(detail, /&lt;Summer&gt;/);
    assert.match(detail, /id="addAlbumFiles"[^>]*>[\s\S]*?添加已有文件/);
    assert.match(detail, /data-edit-album>编辑信息/);
    assert.doesNotMatch(detail, /请从“我的文件”选择内容加入/);
  });
});

describe('workspace wallpaper scope navigation', () => {
  function workspace() {
    const calls = [], stopped = [];
    const app = runInNewContext(`${source.replace(/^import .*;\r?\n/gm, '').replace(/\ninit\(\);\s*$/, '')}\nshowView = async () => {}; rememberScroll = () => {}; ({ state, syncWorkspaceWallpaper, navigateWorkspace })`, {
      location: new URL('https://imgbed.example/account/?view=files'), URL, URLSearchParams,
      document: { querySelector: () => ({}) }, history: { pushState() {}, replaceState() {} },
      initializeWorkspaceWallpaper: ({ isAdmin }) => new Promise(resolve => calls.push({ isAdmin, finish: () => resolve(() => stopped.push(isAdmin)) })),
    });
    app.state.user = { role: 'owner' };
    return { ...app, calls, stopped };
  }

  it('changes players only when navigation crosses the administration boundary', async () => {
    const app = workspace();
    const first = app.syncWorkspaceWallpaper();
    app.calls[0].finish();
    await first;
    await app.navigateWorkspace({ view: 'albums', albumId: 'summer' });
    assert.equal(app.calls.length, 1);
    await app.navigateWorkspace({ view: 'admin', section: 'content' });
    assert.equal(app.calls.length, 2);
    assert.equal(app.calls[1].isAdmin, true);
    assert.deepEqual(app.stopped, [false]);
    app.calls[1].finish();
    await Promise.resolve();
    await app.navigateWorkspace({ view: 'admin', section: 'users' });
    assert.equal(app.calls.length, 2);
    await app.navigateWorkspace({ view: 'files' });
    assert.equal(app.calls.length, 3);
    assert.equal(app.calls[2].isAdmin, false);
    assert.deepEqual(app.stopped, [false, true]);
    app.calls[2].finish();
    await Promise.resolve();
  });

  it('disposes a pending old player before starting the current scope', async () => {
    const app = workspace();
    const old = app.syncWorkspaceWallpaper();
    app.state.view = 'admin';
    const current = app.syncWorkspaceWallpaper();
    assert.equal(app.calls.length, 1);
    app.calls[0].finish();
    await old;
    assert.deepEqual(app.stopped, [false]);
    assert.equal(app.calls.length, 2);
    app.calls[1].finish();
    await current;
    app.state.view = 'files';
    const next = app.syncWorkspaceWallpaper();
    assert.deepEqual(app.stopped, [false, true]);
    app.calls[2].finish();
    await next;
  });
});
