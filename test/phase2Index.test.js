import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readIndex } from '../functions/utils/indexManager.js';
import { TestD1 } from './helpers/d1.js';

function metadata(overrides = {}) {
    return {
        FileName: 'file',
        FileType: 'image/png',
        TimeStamp: 1,
        Directory: '',
        Channel: 'Discord',
        ChannelName: 'default',
        ListType: 'None',
        Label: 'everyone',
        Tags: [],
        ...overrides,
    };
}

const entries = [
    ['assets/deep/clip.mp4', metadata({ FileName: 'Clip', FileType: 'video/mp4', TimeStamp: 60, Directory: 'assets/deep/', Tags: ['Featured', 'Video'] })],
    ['assets/photo.png', metadata({ FileName: 'Photo', TimeStamp: 50, Directory: 'assets/', Tags: ['Featured'] })],
    ['assets_%/literal.png', metadata({ FileName: 'Literal', TimeStamp: 45, Directory: 'assets_%/', Tags: ['Featured'] })],
    ['assetsXX/not-literal.png', metadata({ FileName: 'Wrong directory', TimeStamp: 44, Directory: 'assetsXX/', Tags: ['Featured'] })],
    ['legacy/root.png', metadata({ FileName: 'Legacy', TimeStamp: 40, Directory: undefined, Tags: ['Legacy'] })],
    ['empty-dir/nested.png', metadata({ FileName: 'Empty directory', TimeStamp: 39, Directory: '', ListType: undefined, Label: undefined })],
    ['😀/sub/photo.png', metadata({ FileName: 'Emoji directory', TimeStamp: 38, Directory: '😀/sub/' })],
    ['😀/legacy/deep.png', metadata({ FileName: 'Legacy emoji directory', TimeStamp: 37, Directory: undefined })],
    ['unicode.png', metadata({ FileName: 'Äpfel Kelvin', TimeStamp: 36, Tags: ['Äpfel', 'K'] })],
    ['root.png', metadata({ FileName: 'Root', TimeStamp: 30, Directory: '', Tags: [] })],
    ['adult-white.png', metadata({ FileName: 'Allowed adult', TimeStamp: 20, Label: 'adult', ListType: 'White' })],
    ['adult-block.png', metadata({ FileName: 'Blocked adult', TimeStamp: 10, Label: 'adult', ListType: 'Block' })],
];

function createD1() {
    const d1 = new TestD1();
    d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    const statement = d1.db.prepare('INSERT INTO files (id, metadata) VALUES (?, ?)');
    for (const [id, fileMetadata] of entries) statement.run(id, JSON.stringify(fileMetadata));
    return d1;
}

function createLegacyKv() {
    const values = new Map([
        ['manage@index@meta', JSON.stringify({ chunkCount: 1, totalCount: entries.length, lastUpdated: 123, lastOperationId: null })],
        ['manage@index_0', JSON.stringify(entries
            .map(([id, fileMetadata]) => ({ id, metadata: fileMetadata }))
            .sort((a, b) => b.metadata.TimeStamp - a.metadata.TimeStamp || b.id.localeCompare(a.id)))],
    ]);
    return {
        get: async key => values.get(key) ?? null,
        list: async ({ prefix = '' } = {}) => ({
            keys: [...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })),
            cursor: null,
        }),
    };
}

function comparable(result) {
    return {
        ids: result.files.map(file => file.id),
        directories: result.directories,
        totalCount: result.totalCount,
        directFileCount: result.directFileCount,
        directFolderCount: result.directFolderCount,
        returnedCount: result.returnedCount,
        success: result.success,
    };
}

describe('phase 2 D1 management index', () => {
    it('matches the legacy KV filters while reading only the requested D1 page', async () => {
        const d1 = createD1();
        const preparedSql = [];
        const originalPrepare = d1.prepare.bind(d1);
        d1.prepare = sql => {
            preparedSql.push(sql);
            return originalPrepare(sql);
        };
        const options = {
            directory: 'assets',
            includeSubdirFiles: true,
            fileType: ['image', 'video'],
            channel: ['discord'],
            count: 1,
            start: 1,
        };
        try {
            const d1Result = await readIndex({ env: { img_d1: d1 } }, options);
            const kvResult = await readIndex({ env: { img_url: createLegacyKv() }, waitUntil: () => {} }, options);

            assert.deepEqual(comparable(d1Result), comparable(kvResult));
            assert.deepEqual(d1Result.files.map(file => file.id), ['assets/photo.png']);
            const pageSql = preparedSql.find(sql => sql.includes('JOIN files ON files.id = page.id'));
            assert.match(pageSql, /WHERE/);
            assert.match(pageSql, /ORDER BY timestamp_value DESC, id DESC/);
            assert.match(pageSql, /LIMIT \? OFFSET \?/);
            assert.equal(preparedSql.length, 2, 'one aggregate query and one bounded metadata page');
            assert.doesNotMatch(pageSql, /SELECT id, metadata FROM candidates/);
        } finally {
            d1.db.close();
        }
    });

    it('keeps legacy rows without indexed columns and prevents directory wildcard matches', async () => {
        const d1 = createD1();
        try {
            const legacy = await readIndex({ env: { img_d1: d1 } }, { directory: 'legacy', count: 50, includeSubdirFiles: false });
            assert.deepEqual(legacy.files.map(file => file.id), ['legacy/root.png']);

            const literal = await readIndex({ env: { img_d1: d1 } }, { directory: 'assets_%', count: 50, includeSubdirFiles: true });
            assert.deepEqual(literal.files.map(file => file.id), ['assets_%/literal.png']);
            const options = { accessStatus: ['normal'], count: 50, includeSubdirFiles: false };
            const normal = await readIndex({ env: { img_d1: d1 } }, options);
            const oldNormal = await readIndex({ env: { img_url: createLegacyKv() }, waitUntil: () => {} }, options);
            assert.deepEqual(comparable(normal), comparable(oldNormal));
            const emojiOptions = { directory: '😀', count: 50, includeSubdirFiles: false };
            assert.deepEqual(comparable(await readIndex({ env: { img_d1: d1 } }, emojiOptions)),
                comparable(await readIndex({ env: { img_url: createLegacyKv() }, waitUntil: () => {} }, emojiOptions)));
            const upperCaseDirectory = await readIndex({ env: { img_d1: d1 } }, { directory: 'ASSETS', count: 50 });
            assert.equal(upperCaseDirectory.totalCount, 0);
        } finally {
            d1.db.close();
        }
    });

    it('preserves whitelist priority, direct-folder accounting, and count=-1 without truncation', async () => {
        const d1 = createD1();
        try {
            const normal = await readIndex({ env: { img_d1: d1 } }, { accessStatus: ['normal'], count: -1, includeSubdirFiles: true });
            assert.ok(normal.files.some(file => file.id === 'adult-white.png'));
            assert.ok(!normal.files.some(file => file.id === 'adult-block.png'));

            const directory = await readIndex({ env: { img_d1: d1 } }, { directory: 'assets', count: -1, includeSubdirFiles: false });
            assert.equal(directory.totalCount, 2);
            assert.equal(directory.directFileCount, 1);
            assert.equal(directory.directFolderCount, 1);
            assert.deepEqual(directory.directories, ['assets/deep']);
            assert.deepEqual(directory.files.map(file => file.id), ['assets/photo.png']);

            const all = await readIndex({ env: { img_d1: d1 } }, { count: -1, includeSubdirFiles: true });
            assert.equal(all.returnedCount, entries.length);
        } finally {
            d1.db.close();
        }
    });

    it('preserves Unicode case-insensitive keyword and tag matching', async () => {
        const d1 = createD1();
        for (const [id, fileMetadata] of entries) d1.db.prepare('UPDATE files SET timestamp = ? WHERE id = ?').run(fileMetadata.TimeStamp, id);
        try {
            for (const filter of [{ search: 'äpfel' }, { search: 'kelvin' }, { includeTags: ['äpfel'] }, { includeTags: ['k'] }, { excludeTags: ['k'] }]) {
                const options = { ...filter, count: 1, includeSubdirFiles: true };
                assert.deepEqual(comparable(await readIndex({ env: { img_d1: d1 } }, options)),
                    comparable(await readIndex({ env: { img_url: createLegacyKv() }, waitUntil: () => {} }, options)));
            }
        } finally { d1.db.close(); }
    });

    it('uses the covering index in the actual query and retrieves page metadata by primary key', async () => {
        const d1 = createD1();
        try {
            const originalPrepare = d1.prepare.bind(d1);
            const statements = [];
            d1.prepare = sql => { const statement = originalPrepare(sql); statements.push(statement); return statement; };
            for (const directory of ['', 'assets']) {
                await readIndex({ env: { img_d1: d1 } }, { directory, count: 1 });
                const statement = statements.at(-1);
                const plan = d1.db.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`).all(...statement.params);
                assert.ok(plan.some(row => row.detail.includes('COVERING INDEX idx_files_management_order')));
                assert.ok(!plan.some(row => /MATERIALIZE (filtered|candidates)/.test(row.detail)));
                assert.ok(plan.some(row => /SEARCH files USING INDEX sqlite_autoindex_files_1 \(id=\?\)/.test(row.detail)));
                assert.ok(plan.filter(row => row.detail === 'SCAN files').length <= 1);
            }
        } finally {
            d1.db.close();
        }
    });
});
