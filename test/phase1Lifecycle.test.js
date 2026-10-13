import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TestD1 } from './helpers/d1.js';
import { settleFileDeletion } from '../functions/utils/files/fileLifecycle.js';
import { readIndex, getIndexMeta, rebuildIndex, addFileToIndex, removeFileFromIndex } from '../functions/utils/indexManager.js';

describe('phase 1 D1 file lifecycle', () => {
    let d1;
    let context;
    beforeEach(() => {
        d1 = new TestD1();
        d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
        d1.exec(`INSERT INTO users (discord_id, username, used_bytes, created_at, updated_at)
            VALUES ('owner', 'Owner', 1000, 1, 1), ('other', 'Other', 700, 1, 1);
            INSERT INTO albums (id, owner_id, slug, name, created_at, updated_at)
            VALUES ('album', 'owner', 'album', 'Album', 1, 1);`);
        context = { env: { img_d1: d1, img_url: {
            get: async () => { throw new Error('D1 files must not read shadow indexes'); },
            put: async () => { throw new Error('D1 files must not write shadow indexes'); },
        } }, waitUntil: () => { throw new Error('D1 must not rebuild shadow indexes'); } };
    });
    afterEach(() => d1.db.close());

    async function insert(id = 'file.png', bytes = 100, timestamp = 1) {
        const metadata = { FileName: id, FileType: 'image/png', FileSizeBytes: bytes, OwnerId: 'owner', ChannelName: 'R2', TimeStamp: timestamp };
        await d1.prepare(`INSERT INTO files (id, metadata, owner_id, file_size_bytes, timestamp, channel_name)
            VALUES (?, ?, 'owner', ?, ?, 'R2')`).bind(id, JSON.stringify(metadata), bytes, timestamp).run();
    }

    it('releases quota once even when requests settle the same file repeatedly', async () => {
        await insert();
        d1.exec(`INSERT INTO album_items VALUES ('album', 'file.png', 0, 1);
            INSERT INTO album_covers VALUES ('album', 'file.png', 50, 50, 1);`);
        await Promise.all([settleFileDeletion(d1, 'file.png'), settleFileDeletion(d1, 'file.png')]);
        assert.equal((await d1.prepare("SELECT used_bytes FROM users WHERE discord_id = 'owner'").first()).used_bytes, 900);
        assert.equal((await d1.prepare("SELECT used_bytes FROM users WHERE discord_id = 'other'").first()).used_bytes, 700);
        for (const table of ['files', 'album_items', 'album_covers']) {
            assert.equal((await d1.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0);
        }
    });

    it('rolls back both quota and file references if settlement fails', async () => {
        await insert();
        d1.failOnStatement = 2;
        await assert.rejects(settleFileDeletion(d1, 'file.png'));
        assert.equal((await d1.prepare("SELECT used_bytes FROM users WHERE discord_id = 'owner'").first()).used_bytes, 1000);
        assert.ok(await d1.prepare("SELECT id FROM files WHERE id = 'file.png'").first());
    });

    it('settles legacy metadata rows and prevents negative or missing quota changes', async () => {
        await d1.prepare('INSERT INTO files (id, metadata) VALUES (?, ?)')
            .bind('legacy.png', JSON.stringify({ OwnerId: 'owner', FileSizeBytes: 250 })).run();
        await settleFileDeletion(d1, 'legacy.png');
        await insert('negative.png', -100);
        await settleFileDeletion(d1, 'negative.png');
        await settleFileDeletion(d1, 'missing.png');
        assert.equal((await d1.prepare("SELECT used_bytes FROM users WHERE discord_id = 'owner'").first()).used_bytes, 750);
    });

    it('reads current D1 rows without queued writes or stale chunk snapshots', async () => {
        await insert('a.png', 1048576, 1);
        await insert('b.png', 2097152, 2);
        await addFileToIndex(context, 'b.png', {});
        let index = await readIndex(context, { count: -1 });
        assert.equal(index.success, true);
        assert.deepEqual(index.files.map(file => file.id), ['b.png', 'a.png']);
        const meta = await getIndexMeta(context);
        assert.equal(meta.totalCount, 2);
        assert.equal(meta.totalSizeMB, 3);
        assert.deepEqual(meta.channelStats.R2, { usedMB: 3, fileCount: 2 });
        await settleFileDeletion(d1, 'b.png');
        await removeFileFromIndex(context, 'b.png');
        index = await readIndex(context, { count: -1 });
        assert.deepEqual(index.files.map(file => file.id), ['a.png']);
        assert.deepEqual(await rebuildIndex(context), { success: true, processedCount: 1, indexedCount: 1 });
        assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM index_operations').first()).n, 0);
    });

    it('migrates existing indexes and avoids temporary sorting for list queries', () => {
        d1.exec(readFileSync(new URL('../database/migrations/v2.11.0_file_query_indexes.sql', import.meta.url), 'utf8'));
        d1.exec(readFileSync(new URL('../database/migrations/v2.11.0_file_query_indexes.sql', import.meta.url), 'utf8'));
        const queries = [
            ["SELECT id FROM files WHERE owner_id = 'owner' ORDER BY COALESCE(timestamp, 0) DESC, id DESC LIMIT 51", 'idx_files_owner_id'],
            ["SELECT id FROM files WHERE owner_id = 'owner' ORDER BY LOWER(COALESCE(NULLIF(file_name, ''), id)), id LIMIT 51", 'idx_files_owner_name'],
            ["SELECT id FROM files WHERE visibility = 'public' AND moderation_status = 'active' ORDER BY timestamp DESC, id DESC LIMIT 25", 'idx_files_public_catalog'],
            ["SELECT id FROM files WHERE visibility = 'public' AND moderation_status = 'active' AND featured_at IS NOT NULL ORDER BY featured_at DESC, id DESC LIMIT 25", 'idx_files_featured_catalog'],
        ];
        for (const [sql, index] of queries) {
            const plan = d1.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => row.detail).join('\n');
            assert.ok(plan.includes(index), plan);
            assert.ok(!plan.includes('TEMP B-TREE'), plan);
        }
    });
});
