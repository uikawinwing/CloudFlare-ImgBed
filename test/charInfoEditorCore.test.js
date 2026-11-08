import assert from 'node:assert/strict';
import '../deploy/worker/build-charinfo-editor.js';
let
    buildManagedEjsBlock,
    buildStatusGalleryImages,
    createEmptyProfile,
    inspectLegacyVisualProfile,
    inspectManagedBlock,
    normalizeProfile,
    upsertManagedEjsBlock,
    upsertManagedEjsBlockWithLegacyMigration,
    validateProfile;

before(async () => {
    ({ buildManagedEjsBlock, buildStatusGalleryImages, createEmptyProfile,
        inspectLegacyVisualProfile, inspectManagedBlock, normalizeProfile,
        upsertManagedEjsBlock, upsertManagedEjsBlockWithLegacyMigration,
        validateProfile } = await import('../frontend-dist/charinfo/profile-core.js'));
});

function exampleProfile() {
    return {
        ...createEmptyProfile('傲雪'),
        remoteGalleryUrl: 'https://img.example.test/api/public/gallery/owner/snow-album',
        avatarUrl: 'https://img.example.test/thumb/avatar.webp',
        coverUrl: 'https://img.example.test/thumb/cover.webp',
        gallery: [{
            title: '视频',
            sources: ['https://img.example.test/file/snow.mp4', 'https://mirror.example.test/snow.webm'],
            thumbnail: 'https://img.example.test/thumb/snow.webp',
            viewerVisible: false,
        }],
        metadata: {
            author: '作者',
            version: 'v2',
            sex: '女',
            race: '人类',
            author_note: '完整保留资料。',
            story_sections: [{ title: '雪夜', content: '故事正文。' }],
        },
    };
}

describe('CharInfo editor shared core', () => {
    it('round trips remote gallery, thumbnails, media order, visibility and metadata through managed EJS', () => {
        const profile = exampleProfile();
        const code = buildManagedEjsBlock(profile);
        const inspection = inspectManagedBlock(code);
        assert.equal(inspection.state, 'valid');
        assert.deepEqual(inspection.profile, profile);
        assert.match(code, /gallery_pack_url: profile\.remoteGalleryUrl/);
        assert.match(code, /thumbnail: image\.thumbnail/);
        assert.match(code, /status\.externalGalleries\.partners/);
        assert.deepEqual(buildStatusGalleryImages(profile.gallery), [{
            title: '视频', url: 'https://img.example.test/thumb/snow.webp',
        }]);
    });

    it('reads legacy v1 UTF-8 data and upgrades it to v2 without losing remote fields', () => {
        const profile = exampleProfile();
        const oldProfile = { ...profile, galleryPackUrl: profile.remoteGalleryUrl };
        delete oldProfile.remoteGalleryUrl;
        const encoded = Buffer.from(JSON.stringify(oldProfile), 'utf8').toString('base64url');
        const source = `<%# char-info-ejs-builder:start:v1 %>\n<%# char-info-ejs-builder:data:v1:${encoded} %>\n<%# char-info-ejs-builder:end:v1 %>`;
        const inspection = inspectManagedBlock(source);
        assert.equal(inspection.state, 'valid');
        assert.deepEqual(inspection.profile, profile);
        const upgraded = upsertManagedEjsBlock(source, inspection.profile);
        assert.match(upgraded, /char-info-ejs-builder:start:v2/);
        assert.doesNotMatch(upgraded, /char-info-ejs-builder:(?:start|data):v1/);
        assert.deepEqual(inspectManagedBlock(upgraded).profile, profile);
    });

    it('edits only the managed block and preserves unrelated content, decorators and line endings', () => {
        const original = exampleProfile();
        const before = '\uFEFF@@activate\r\n原始前文\r\n';
        const after = '\r\n<%_ setLocalVar("unrelated", 42); _%>\r\n原始后文';
        const source = before + buildManagedEjsBlock(original).replace(/\n/g, '\r\n') + after;
        const changed = { ...original, entranceQuote: '新台词。' };
        const result = upsertManagedEjsBlock(source, changed);
        assert.equal(result.startsWith(before), true);
        assert.equal(result.endsWith(after), true);
        assert.equal(/(?<!\r)\n/.test(result), false);
        assert.deepEqual(inspectManagedBlock(result).profile, changed);
        assert.throws(() => upsertManagedEjsBlock(source + buildManagedEjsBlock(original), changed), /多个/);
    });

    it('migrates only a statically readable legacy assignment and never executes imported code', () => {
        const before = `@@activate\n角色前文\n<%_ const keepMe = true; _%>\n`;
        const after = `\n<%_ setLocalVar('unrelated.path', 42); _%>\n角色正文`;
        const source = before + `<%_\nsetLocalVar('char_info_visuals["傲雪"]', { url: 'https://img.example.test/snow.webp' });\n_%>` + after;
        const inspection = inspectLegacyVisualProfile(source, '傲雪');
        assert.equal(inspection.state, 'importable');
        const migrated = upsertManagedEjsBlockWithLegacyMigration(source, inspection.profile);
        assert.equal(inspectManagedBlock(migrated).state, 'valid');
        assert.doesNotMatch(migrated, /char_info_visuals\[/);
        assert.match(migrated, /const keepMe = true/);
        assert.match(migrated, /setLocalVar\('unrelated\.path', 42\)/);
        assert.match(migrated, /角色正文$/);
        assert.equal(migrated.endsWith(after), true);
        assert.equal(migrated.includes(before.slice('@@activate\n'.length)), true);

        globalThis.__charInfoImporterExecuted = false;
        try {
            const executable = `setLocalVar('char_info_visuals["傲雪"]', { url: (() => { globalThis.__charInfoImporterExecuted = true; return 'https://img.example.test/snow.webp'; })() });`;
            assert.equal(inspectLegacyVisualProfile(executable, '傲雪').state, 'unsupported');
            assert.throws(() => upsertManagedEjsBlockWithLegacyMigration(executable, inspection.profile));
            assert.equal(globalThis.__charInfoImporterExecuted, false);
        } finally {
            delete globalThis.__charInfoImporterExecuted;
        }
        const unknownEjs = 'setLocalVar("char_info.profiles", dynamicProfile);';
        assert.throws(() => upsertManagedEjsBlock(unknownEjs, inspection.profile), /未标记/);
    });

    it('rejects invalid thumbnails even when a remote gallery allows empty local sources', () => {
        for (const thumbnail of ['%><% globalThis.charInfoInjected = true; %><%', 'javascript:alert(1)', 'http://img.example.test/thumb.webp']) {
            const profile = { ...exampleProfile(), gallery: [{ title: 'Empty', sources: [], thumbnail }] };
            assert.notEqual(validateProfile(profile).length, 0);
            assert.throws(() => buildManagedEjsBlock(profile));
        }
        const profile = { ...exampleProfile(), gallery: [{ title: 'Empty', sources: [], thumbnail: 'https://img.example.test/thumb.webp' }] };
        assert.deepEqual(validateProfile(profile), []);
        assert.equal(inspectManagedBlock(buildManagedEjsBlock(profile)).state, 'valid');
    });

    it('does not migrate or remove prose, quoted calls, comments or mixed JavaScript', () => {
        const call = `setLocalVar('char_info_visuals["傲雪"]', { url: 'https://img.example.test/snow.webp' });`;
        const examples = [
            `这只是文档里的示例：${call}`,
            JSON.stringify(call),
            `\`${call}\``,
            `// ${call}`,
            `/* ${call} */`,
            `<%_\n// ${call}\n_%>`,
            `<%_\n/* ${call} */\n_%>`,
            `<%_\nconst example = ${JSON.stringify(call)};\n_%>`,
            `<%_\nconst keepMe = true;\n${call}\n_%>`,
            `<%_\n${call}\nsetLocalVar('unrelated', 42);\n_%>`,
            `<%= ${call} %>`,
            `<%_\nconst example = \`\n<%_\n${call}\n_%>\`;\n_%>`,
            `<%_\n${call}\n_%>\n注释里的另一个 char_info_visuals`,
        ];
        for (const source of examples) {
            assert.equal(inspectLegacyVisualProfile(source, '傲雪').state, 'unsupported', source);
            assert.throws(() => upsertManagedEjsBlockWithLegacyMigration(source, exampleProfile()), undefined, source);
        }
        assert.equal(inspectLegacyVisualProfile(call, '傲雪').state, 'importable');
    });

    it('round trips assignment-like text inside profile JSON and rejects real duplicate configurations', () => {
        const profile = exampleProfile();
        profile.entranceQuote = '这段文字包含 const profile = 字样';
        profile.metadata.story_sections[0].content = '第一行 const profile =\n第二行仍是普通文字';
        const code = buildManagedEjsBlock(profile);
        assert.deepEqual(inspectManagedBlock(code).profile, profile);
        const duplicate = code.replace('  const npcName =', '  const profile = {};\n  const npcName =');
        assert.equal(inspectManagedBlock(duplicate).state, 'malformed');
    });

    it('rejects reserved names and unsafe media while allowing a remote-only profile', () => {
        const profile = exampleProfile();
        for (const characterName of ['__proto__', 'constructor', 'prototype']) {
            assert.match(validateProfile({ ...profile, characterName }).join('\n'), /保留名称/);
        }
        assert.match(validateProfile({ ...profile, entranceQuote: '<% globalThis.hacked = true %>' }).join('\n'), /分隔符/);
        assert.match(validateProfile({ ...profile, gallery: [{ title: '非法', sources: ['javascript:alert(1)'] }] }).join('\n'), /HTTPS/);
        assert.deepEqual(validateProfile({ ...profile, gallery: [] }), []);
        assert.deepEqual(normalizeProfile({ ...profile, galleryPackUrl: profile.remoteGalleryUrl, remoteGalleryUrl: undefined }).remoteGalleryUrl, profile.remoteGalleryUrl);
        assert.equal(Object.prototype.hacked, undefined);
    });
});
