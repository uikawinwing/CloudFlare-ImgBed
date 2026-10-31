import assert from 'node:assert/strict';
import '../deploy/worker/build-charinfo-editor.js';
import { inspectSource, mergeSource } from '../frontend-src/charinfo/source-document.js';

let core;
before(async () => { core = await import('../frontend-dist/charinfo/profile-core.js'); });

function profile(name = '傲雪') {
    return { ...core.createEmptyProfile(name), gallery: [{ title: '主立绘', sources: ['https://img.example.test/snow.png'] }] };
}

describe('CharInfo source documents', () => {
    it('returns only EJS when no original was supplied', () => {
        const source = inspectSource('  \n', {}, core);
        const result = mergeSource(source, profile(), core);
        assert.equal(result.text, core.buildManagedEjsBlock(profile()));
        assert.equal(result.filenameExtension, 'txt');
    });

    it('keeps raw text whitespace, decorators and CRLF while adding EJS once', () => {
        const content = '\uFEFF@@activate\r\n\r\n  人物原稿。  \r\n\r\n';
        const result = mergeSource(inspectSource(content, {}, core), profile(), core);
        assert.equal(result.text.startsWith('\uFEFF@@activate\r\n'), true);
        assert.equal(result.text.endsWith('\r\n\r\n  人物原稿。  \r\n\r\n'), true);
        assert.equal(/(?<!\r)\n/u.test(result.text), false);
        const updated = mergeSource(inspectSource(result.text, {}, core), { ...profile(), entranceQuote: '来了。' }, core);
        assert.equal(updated.text.split('char-info-ejs-builder:start:v2').length, 2);
        assert.equal(core.inspectManagedBlock(updated.text).profile.entranceQuote, '来了。');
    });

    it('prefills explicit static fields without reading EJS, nested fields or generating story metadata', () => {
        const content = '<%_\n姓名: 错误姓名\n性别: 错误性别\n_%>\n姓名： "傲雪"\n性别: 女\n种族: 人类\n作者: 作者甲\n版本: 1.2\n  作者: 其他人\n性格: 原稿要保留。';
        const source = inspectSource(content, {}, core);
        assert.equal(source.profile.characterName, '傲雪');
        assert.deepEqual(source.profile.metadata, { sex: '女', race: '人类', author: '作者甲', version: '1.2' });
        assert.equal(source.content, content);
        const dynamic = inspectSource('姓名: {{user}}\n性别: ${value}\n种族: >\n  人类', {}, core);
        assert.equal(dynamic.profile.characterName, '');
        assert.equal(dynamic.profile.metadata, undefined);
    });

    it('accepts bracketed prompt headings and recognizes tagged worldbook comments', () => {
        const text = '[角色设定]\n姓名: 傲雪\n角色正文';
        assert.equal(inspectSource(text, {}, core).profile.characterName, '傲雪');
        const raw = JSON.stringify({ comment: '[WS][DLC][角色][傲雪]', content: '角色正文' });
        assert.equal(inspectSource(raw, {}, core).profile.characterName, '傲雪');
    });

    it('reads managed profiles and safely migrates a static legacy profile', () => {
        const original = { ...profile(), metadata: { author: '原作者', sex: '女' } };
        const source = inspectSource('原稿\n' + core.buildManagedEjsBlock(original), {}, core);
        assert.deepEqual(source.profile, original);
        const legacy = inspectSource('角色正文\n<%_\nsetLocalVar(\'char_info_visuals["傲雪"]\', { url: \'https://img.example.test/snow.png\' });\n_%>\n原稿结尾', {}, core);
        const result = mergeSource(legacy, profile(), core);
        assert.equal(result.text.includes('char_info_visuals['), false);
        assert.equal(result.text.endsWith('原稿结尾'), true);
        assert.equal(core.inspectManagedBlock(result.text).state, 'valid');
    });

    it('stops on damaged, duplicate or dynamic legacy EJS without executing code', () => {
        assert.throws(() => inspectSource('<%# char-info-ejs-builder:start:v2 %>', {}, core), /EJS|区块|标记|缺少|不完整/u);
        const block = core.buildManagedEjsBlock(profile());
        assert.throws(() => inspectSource(block + block, {}, core), /多个/u);
        globalThis.__charInfoSourceExecuted = false;
        try {
            assert.throws(() => inspectSource('<%_ globalThis.__charInfoSourceExecuted = true; setLocalVar("char_info_visuals", getDynamic()); _%>', {}, core), /旧版|静态|安全/u);
            assert.equal(globalThis.__charInfoSourceExecuted, false);
        } finally { delete globalThis.__charInfoSourceExecuted; }
    });

    it('preserves single-entry unknown fields and only changes its content', () => {
        const original = { uid: 12, name: '[DLC][角色]傲雪', content: '性别: 女\n设定正文', enabled: false, extensions: { custom: [1, 2] } };
        const source = inspectSource(JSON.stringify(original), {}, core);
        assert.equal(source.kind, 'entry');
        assert.equal(source.profile.characterName, '傲雪');
        const result = JSON.parse(mergeSource(source, profile(), core).text);
        assert.deepEqual({ ...result, content: original.content }, original);
        assert.deepEqual(source.document, original);
        assert.equal(result.content.endsWith(original.content), true);
    });

    it('requires an explicit worldbook selection and preserves all other entries and root fields', () => {
        const original = { name: '完整世界书', custom: { x: 1 }, entries: { '0': { comment: '傲雪', key: ['傲雪'], content: '种族: 人类\n原稿', constant: true }, '2': { content: '其他条目', extensions: { x: 3 } } } };
        const source = inspectSource(JSON.stringify(original), {}, core);
        assert.equal(source.needsEntrySelection, true);
        assert.deepEqual(source.entries.map(entry => entry.key), ['0', '2']);
        assert.throws(() => mergeSource(source, profile(), core), /选择/u);
        assert.throws(() => inspectSource(JSON.stringify(original), { entryKey: 'missing' }, core), /不存在/u);
        const selected = inspectSource(JSON.stringify(original), { entryKey: '0' }, core);
        assert.equal(selected.profile.characterName, '傲雪');
        const result = JSON.parse(mergeSource(selected, profile(), core).text);
        assert.deepEqual(result.entries['2'], original.entries['2']);
        assert.deepEqual(result.custom, original.custom);
        assert.deepEqual({ ...result.entries['0'], content: original.entries['0'].content }, original.entries['0']);
    });

    for (const version of ['v1', 'v2', 'v3']) {
        it(`preserves a SillyTavern ${version} card while updating only its description`, () => {
            const data = { name: '傲雪', description: '性别: 女\n种族: 人类\n角色正文', personality: '原始性格', scenario: '原始场景', first_mes: '原始开场白', creator: '作者', character_version: '2', extensions: { private: { keep: true } } };
            const original = version === 'v1' ? data : { spec: `chara_card_${version}`, spec_version: '3.0', data, extra: ['keep'] };
            const source = inspectSource(JSON.stringify(original), {}, core);
            assert.equal(source.profile.characterName, '傲雪');
            assert.deepEqual(source.profile.metadata, { sex: '女', race: '人类', author: '作者', version: '2' });
            const result = JSON.parse(mergeSource(source, profile(), core).text);
            if (version === 'v1') result.description = data.description;
            else result.data.description = data.description;
            assert.deepEqual(result, original);
        });
    }

    it('rejects unsupported or invalid JSON without choosing an arbitrary prompt field', () => {
        assert.throws(() => inspectSource('{"prompt":"原稿"}', {}, core), /未找到角色正文/u);
        assert.throws(() => inspectSource('{"spec":"chara_card_v2","data":{},"content":"不是角色卡正文"}', {}, core), /缺少 data.description/u);
        assert.throws(() => inspectSource('{"content":', {}, core), /JSON 格式/u);
        assert.throws(() => inspectSource('[{"content":"正文"}]', {}, core), /JSON/u);
    });
});
