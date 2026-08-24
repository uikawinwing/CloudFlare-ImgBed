import assert from 'assert';
import { existsSync, readFileSync } from 'fs';

const creatorSource = readFileSync(new URL('../frontend-dist/charinfo/index.html', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../frontend-dist/_redirects', import.meta.url), 'utf8');

describe('CharInfo Worldbook frontend integration', () => {
  it('makes the root CharInfo route the complete Creator Editor', () => {
    assert.match(creatorSource, /<title>CharInfo Creator · CloudFlare ImgBed<\/title>/);
    ['importWorldbookFile', 'renderEntryPicker', 'checkoutWorldbook', 'openCart', 'buildManagedBlock', 'restoreWorkspace', 'previewBtn', 'addStoryBtn', 'galleryList'].forEach(marker => assert.match(creatorSource, new RegExp(marker)));
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
    assert.match(creatorSource, /loadProfile\(mergeAlbumProfile\(entryProfile\)\)/);
    assert.match(creatorSource, /currentEntryDirty=!!albumProfile/);
  });
});
