import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../frontend-dist/account/storage-settings.js', import.meta.url), 'utf8');

function editor() {
  return runInNewContext(`${source.replace(/^import .*;\r?\n/gm, '')}\n({ state, pageMarkup, validateSiteSettings })`, {
    location: new URL('https://example.test/account/?view=albums&album=summer'),
    URL,
    document: { querySelector: () => null },
    window: { addEventListener() {} },
  });
}

describe('native website settings', () => {
  const liveIds = ['siteTitle', 'ownerName', 'siteIcon', 'logoUrl', 'logoLink', 'defaultUploadChannel', 'defaultChannelName', 'urlPrefix', 'wallpaperEnabled', 'uploadBkImg', 'adminBkImg', 'bkInterval', 'bkOpacity'];
  const removedIds = ['announcement', 'footerLink', 'disableFooter', 'loginBkImg', 'adminLoginBkImg', 'defaultConvertToWebp', 'defaultCustomerCompress', 'welcomeWallpaper'];

  it('only renders settings consumed by the new pages and links the separate welcome queue', () => {
    const app = editor();
    app.state.page = { config: [...liveIds, ...removedIds].map(id => ({ id, label: id, value: '' })) };
    app.state.activeKey = 'system-page';
    const markup = app.pageMarkup();
    for (const id of liveIds) assert.ok(markup.includes(`data-site-setting="${id}"`), id);
    for (const id of removedIds) assert.ok(!markup.includes(`data-site-setting="${id}"`), id);
    assert.match(markup, /管理欢迎页壁纸/);
    assert.match(markup, /album=summer/);
    assert.match(markup, /data-save-settings disabled/);
  });

  it('renders workspace wallpaper arrays as lines without exposing raw JSON', () => {
    const app = editor();
    app.state.page = { config: [{ id: 'uploadBkImg', label: '壁纸', value: '["/one.jpg","/two.jpg"]' }] };
    const markup = app.pageMarkup();
    assert.match(markup, />\/one\.jpg\n\/two\.jpg<\/textarea>/);
    assert.doesNotMatch(markup, /\[&quot;/);
  });

  it('validates only changed fields so untouched legacy values do not block a brand update', () => {
    const app = editor();
    app.state.page = { config: [{ id: 'uploadBkImg', value: 'bing' }] };
    app.state.pageChanges = { siteTitle: 'New title' };
    assert.equal(app.validateSiteSettings(), null);
    for (const values of [{ logoLink: 'javascript:alert(1)' }, { urlPrefix: 'https://example.test/file/?token=abc' }, { bkInterval: 0 }, { bkOpacity: 1.2 }, { uploadBkImg: ['//example.test/image.jpg'] }]) {
      app.state.pageChanges = values;
      assert.equal(app.validateSiteSettings().id, Object.keys(values)[0]);
    }
  });
});
