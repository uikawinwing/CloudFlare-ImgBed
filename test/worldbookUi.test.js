import assert from 'assert';
import { existsSync, readFileSync } from 'fs';

const creatorSource = readFileSync(new URL('../frontend-dist/charinfo/index.html', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../frontend-dist/_redirects', import.meta.url), 'utf8');

describe('CharInfo Worldbook frontend integration', () => {
  it('makes the root CharInfo route the complete Creator Editor', () => {
    assert.match(creatorSource, /<title>CharInfo Creator · Charatopia<\/title>/);
    assert.match(creatorSource, /data-site-page-title="CharInfo Creator"/);
    ['importWorldbookFile', 'renderEntryPicker', 'checkoutWorldbook', 'openCart', 'currentExport', 'mergeSource', 'restoreWorkspace', 'previewBtn', 'addStoryBtn', 'galleryList'].forEach(marker => assert.match(creatorSource, new RegExp(marker)));
  });

  it('retires the duplicate Studio files and redirects the nested legacy route', () => {
    assert.strictEqual(existsSync(new URL('../frontend-dist/charinfo/charinfo.js', import.meta.url)), false);
    assert.strictEqual(existsSync(new URL('../frontend-dist/charinfo/charinfo.css', import.meta.url)), false);
    assert.strictEqual(existsSync(new URL('../frontend-dist/charinfo/worldbook/index.html', import.meta.url)), false);
    assert.match(redirects, /^\/charinfo\/worldbook \/charinfo\/ 302$/m);
    assert.match(redirects, /^\/charinfo\/worldbook\/ \/charinfo\/ 302$/m);
    assert.doesNotMatch(creatorSource, /visualStudioLink/);
  });

  it('loads the public CharInfo pack and preserves all visual mappings', () => {
    assert.match(creatorSource, /\/api\/public\/charinfo\/\$\{encodeURIComponent\(albumId\)\}/);
    assert.match(creatorSource, /function profileFromCharInfoPack\(pack\)/);
    assert.match(creatorSource, /characterName:String\(pack\?\.characterName\|\|''\)/);
    assert.match(creatorSource, /avatarUrl:String\(visual\.avatarUrl\|\|''\)/);
    assert.match(creatorSource, /coverUrl:String\(visual\.coverUrl\|\|''\)/);
    assert.match(creatorSource, /raceColor:String\(visual\.raceColor\|\|''\)/);
    assert.match(creatorSource, /gallery:Array\.isArray\(pack\?\.gallery\)/);
  });

  it('keeps Album visuals when a Worldbook entry is selected for editing', () => {
    assert.match(creatorSource, /function mergeAlbumProfile\(entryProfile\)/);
    assert.match(creatorSource, /const merged=mergeAlbumProfile\(entryProfile\)/);
    assert.match(creatorSource, /loadProfile\(merged\)/);
    assert.match(creatorSource, /currentEntryDirty=!!albumProfile/);
  });

  it('uses the current shared profile core and exposes quick and full web workflows', () => {
    assert.match(creatorSource, /import \* as ProfileCore from '\.\/profile-core\.js'/);
    assert.match(creatorSource, /ProfileCore\.upsertManagedEjsBlockWithLegacyMigration/);
    assert.match(creatorSource, /id="quickModeBtn"/);
    assert.match(creatorSource, /id="fullModeBtn"/);
    assert.match(creatorSource, /data-panel="5"/);
    assert.doesNotMatch(creatorSource, /step===4\)step=3/);
    assert.doesNotMatch(creatorSource, /\b(?:alert|confirm|prompt)\(/);
  });

  it('maps the real gallery URL and thumbnail without constructing an endpoint from the profile UUID', () => {
    const start = creatorSource.indexOf('function profileFromCharInfoPack(pack)');
    const end = creatorSource.indexOf('function mergeAlbumProfile(', start);
    const fromPack = new Function(`return (${creatorSource.slice(start, end).trim()});`)();
    const pack = {
      characterName: '测试角色',
      profileId: 'uuid-is-not-an-album-slug',
      galleryUrl: 'https://img.example/api/public/gallery/master/character-album',
      visual: { avatarUrl: 'https://img.example/avatar.png', coverUrl: 'https://img.example/cover.webp' },
      gallery: [{ title: '视频', sources: ['https://img.example/video.mp4'], thumbnail: 'https://img.example/poster.webp', viewer_visible: false }],
    };
    const profile = fromPack(pack);
    assert.strictEqual(profile.remoteGalleryUrl, pack.galleryUrl);
    assert.strictEqual(profile.gallery[0].thumbnail, pack.gallery[0].thumbnail);
    assert.strictEqual(profile.gallery[0].viewerVisible, false);
    assert.strictEqual(profile.coverUrl, pack.visual.coverUrl);
    assert.strictEqual(fromPack({ ...pack, galleryUrl: null }).remoteGalleryUrl, undefined);
  });
});
