// Static-field reading follows CharInfo-Manager's characterEntryLibrary.ts:
// https://github.com/uikawinwing/CharInfo-Manager (MIT; see upstream/LICENSE).
// Imported EJS is inspected by the shared core and is never evaluated here.

const FIELD_NAMES = new Map([
    ['姓名', 'characterName'], ['name', 'characterName'],
    ['性别', 'sex'], ['sex', 'sex'], ['gender', 'sex'],
    ['种族', 'race'], ['race', 'race'],
    ['作者', 'author'], ['author', 'author'],
    ['版本', 'version'], ['version', 'version'],
]);

function sourceError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function staticText(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!text || /[\r\n]|<%|%>|\$\{|\{\{|\}\}/u.test(text)) return '';
    return text;
}

function readStaticFields(content) {
    const fields = {};
    let insideEjs = false;
    for (const line of content.split(/\r?\n/u)) {
        if (insideEjs) {
            if (line.includes('%>')) insideEjs = false;
            continue;
        }
        if (line.includes('<%')) {
            insideEjs = !line.slice(line.indexOf('<%') + 2).includes('%>');
            continue;
        }
        const match = line.match(/^([^\s:#：][^:：]*?)[：:][ \t]*(.*?)\s*$/u);
        if (!match) continue;
        const field = FIELD_NAMES.get(match[1].trim().toLowerCase());
        if (!field || /^[>|[\]{&*!]/u.test(match[2])) continue;
        const value = match[2];
        const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
        const text = staticText(quoted ? value.slice(1, -1) : value);
        if (text && fields[field] === undefined) fields[field] = text;
    }
    return fields;
}

function entryName(entry) {
    const name = staticText(entry?.name);
    const title = name || staticText(entry?.comment);
    if (!/^(?:\[WS\])?\[DLC\]\[角色\]/u.test(title)) {
        return name || (Array.isArray(entry?.key) ? staticText(entry.key[0]) : '');
    }
    const remainder = title.replace(/^(?:\[WS\])?\[DLC\]\[角色\]\s*/u, '');
    const afterBrackets = remainder.replace(/^(?:\[[^\]]+\])+/u, '').trim();
    const bracketName = remainder.match(/^\[([^\]]+)\]/u)?.[1] || '';
    return (afterBrackets || bracketName).replace(/\s*[（(][^\r\n]*[）)]\s*$/u, '').trim();
}

function readProfile(content, record, core) {
    const inspection = core.inspectManagedBlock(content);
    if (inspection.state === 'malformed' || inspection.state === 'multiple') {
        throw sourceError('unsafe_ejs', inspection.reason);
    }
    if (inspection.state === 'valid') return inspection.profile;

    const legacy = core.inspectLegacyVisualProfile(content);
    if (legacy.state === 'unsupported') throw sourceError('unsafe_ejs', legacy.reason);
    if (legacy.state === 'importable') return legacy.profile;
    if (core.hasUnmanagedVisualEjs(content)) {
        throw sourceError('unsafe_ejs', '检测到无法安全更新的旧版角色视觉 EJS，请先检查原稿。');
    }

    const fields = readStaticFields(content);
    const profile = core.createEmptyProfile(fields.characterName || entryName(record));
    const author = staticText(record?.creator) || fields.author;
    const version = staticText(record?.character_version) || fields.version;
    const metadata = {
        ...(fields.sex ? { sex: fields.sex } : {}),
        ...(fields.race ? { race: fields.race } : {}),
        ...(author ? { author } : {}),
        ...(version ? { version } : {}),
    };
    if (Object.keys(metadata).length) profile.metadata = metadata;
    return profile;
}

/** Inspect a local source without changing its body or executing its EJS. */
export function inspectSource(raw, { entryKey } = {}, core) {
    if (typeof raw !== 'string') throw sourceError('invalid_source', '原稿必须是文本。');
    if (!raw.trim()) return { kind: 'none', content: '', profile: null };

    const trimmed = raw.replace(/^\uFEFF/u, '').trim();
    if (!trimmed.startsWith('{') && !/^\[\s*(?:[{"\]]|true\b|false\b|null\b|-?\d)/u.test(trimmed)) {
        return { kind: 'text', content: raw, profile: readProfile(raw, null, core) };
    }

    let document;
    try {
        document = JSON.parse(trimmed);
    } catch {
        throw sourceError('invalid_json', 'JSON 格式不正确，请检查后重新导入。');
    }
    if (!isRecord(document)) throw sourceError('unsupported_json', '请导入角色卡、角色条目或世界书 JSON。');

    let kind, record, content;
    if (isRecord(document.entries)) {
        kind = 'worldbook';
        const entries = Object.entries(document.entries)
            .filter(([, entry]) => isRecord(entry) && typeof entry.content === 'string')
            .map(([key, entry]) => ({ key, name: staticText(entry.comment) || staticText(entry.name) || entryName(entry) || key }));
        if (!entries.length) throw sourceError('unsupported_json', '世界书中没有可以编辑的角色正文。');
        if (entryKey === undefined || entryKey === null || entryKey === '') {
            return { kind, document, entries, needsEntrySelection: true, content: '', profile: null };
        }
        entryKey = String(entryKey);
        if (!Object.prototype.hasOwnProperty.call(document.entries, entryKey) || !entries.some(entry => entry.key === entryKey)) {
            throw sourceError('entry_not_found', '选择的世界书条目不存在或没有正文。');
        }
        record = document.entries[entryKey];
        content = record.content;
        return { kind, document, entryKey, entries, content, profile: readProfile(content, record, core) };
    }
    if (document.spec === 'chara_card_v2' || document.spec === 'chara_card_v3') {
        if (!isRecord(document.data) || typeof document.data.description !== 'string') {
            throw sourceError('unsupported_json', '角色卡缺少 data.description 正文，请检查文件。');
        }
        kind = 'card';
        record = document.data;
        content = record.description;
    } else if (typeof document.content === 'string') {
        kind = 'entry';
        record = document;
        content = record.content;
    } else if (typeof document.name === 'string' && typeof document.description === 'string') {
        kind = 'card-v1';
        record = document;
        content = record.description;
    } else {
        throw sourceError('unsupported_json', '未找到角色正文。请导入角色卡、包含 content 的角色条目或世界书 JSON。');
    }
    return { kind, document, content, profile: readProfile(content, record, core) };
}

/** Return the same document format, changing only its selected managed EJS. */
export function mergeSource(source, profile, core) {
    if (!source || source.kind === 'none') {
        return { text: core.buildManagedEjsBlock(profile), filenameExtension: 'txt', mime: 'text/plain;charset=utf-8' };
    }
    if (source.needsEntrySelection) throw sourceError('entry_required', '请先选择要更新的世界书条目。');
    if (source.kind === 'text') {
        return { text: core.upsertManagedEjsBlockWithLegacyMigration(source.content, profile), filenameExtension: 'txt', mime: 'text/plain;charset=utf-8' };
    }
    const document = JSON.parse(JSON.stringify(source.document));
    let target, field;
    if (source.kind === 'worldbook' && isRecord(document.entries) && Object.prototype.hasOwnProperty.call(document.entries, source.entryKey)) {
        target = document.entries[source.entryKey];
        field = 'content';
    } else if (source.kind === 'entry') {
        target = document;
        field = 'content';
    } else if (source.kind === 'card') {
        target = document.data;
        field = 'description';
    } else if (source.kind === 'card-v1') {
        target = document;
        field = 'description';
    }
    if (!isRecord(target) || typeof target[field] !== 'string') {
        throw sourceError('invalid_source', '原稿的正文位置已失效，请重新导入。');
    }
    target[field] = core.upsertManagedEjsBlockWithLegacyMigration(target[field], profile);
    return { text: JSON.stringify(document, null, 2), filenameExtension: 'json', mime: 'application/json;charset=utf-8' };
}
