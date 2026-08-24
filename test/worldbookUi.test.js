import assert from 'assert';
import fs from 'fs';

const studioHtml = fs.readFileSync(new URL('../frontend-dist/charinfo/index.html', import.meta.url), 'utf8');
const studioSource = fs.readFileSync(new URL('../frontend-dist/charinfo/charinfo.js', import.meta.url), 'utf8');
const worldbookSource = fs.readFileSync(new URL('../frontend-dist/charinfo/worldbook/index.html', import.meta.url), 'utf8');

describe('CharInfo Worldbook frontend integration', () => {
  it('opens the packager for the selected Album', () => {
    assert.match(studioHtml, /id="worldbookEditorLink" href="\/charinfo\/worldbook\//);
    assert.match(studioSource, /worldbookEditorLink.*\?album=\$\{encodeURIComponent\(state\.album\?\.id/);
  });

  it('keeps the complete Worldbook editor capabilities from the supplied editor', () => {
    ['importWorldbookFile', 'renderEntryPicker', 'checkoutWorldbook', 'openCart', 'buildManagedBlock', 'restoreWorkspace', 'previewBtn', 'addStoryBtn', 'galleryList'].forEach(marker => assert.match(worldbookSource, new RegExp(marker)));
  });

  it('loads the public CharInfo pack and preserves all visual mappings', () => {
    assert.match(worldbookSource, /\/api\/public\/charinfo\/\$\{encodeURIComponent\(albumId\)\}/);
    assert.match(worldbookSource, /function profileFromCharInfoPack\(pack\)/);
    assert.match(worldbookSource, /characterName:String\(pack\?\.characterName\|\|''\)/);
    assert.match(worldbookSource, /avatarUrl:String\(visual\.avatarUrl\|\|''\)/);
    assert.match(worldbookSource, /coverUrl:String\(visual\.coverUrl\|\|''\)/);
    assert.match(worldbookSource, /raceColor:String\(visual\.raceColor\|\|''\)/);
    assert.match(worldbookSource, /gallery:Array\.isArray\(pack\?\.gallery\)/);
  });

  it('keeps Album visuals when a Worldbook entry is selected for editing', () => {
    assert.match(worldbookSource, /function mergeAlbumProfile\(entryProfile\)/);
    assert.match(worldbookSource, /loadProfile\(mergeAlbumProfile\(entryProfile\)\)/);
    assert.match(worldbookSource, /currentEntryDirty=!!albumProfile/);
  });

  it('keeps the Studio role selectors aligned with the pack fallback image', () => {
    assert.match(studioSource, /const firstImage = state\.items\.find\(isImage\)/);
    assert.match(studioSource, /if \(firstImage && !state\.config\.avatarFileId\) state\.config\.avatarFileId = firstImage\.id/);
    assert.match(studioSource, /if \(firstImage && !state\.config\.coverFileId\) state\.config\.coverFileId = state\.config\.avatarFileId/);
  });
});
