import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readIndex } from '../functions/utils/indexManager.js';

describe('phase 2 local D1 read costs', function () {
    this.timeout(15000);

    it('reduces first-page and empty-directory reads without returning all metadata', async () => {
        const mf = new Miniflare(convertV4MiniflareOptions({
            modules: true, script: 'export default { fetch() { return new Response(); } }',
            d1Databases: { DB: 'phase2-cost-test' }, compatibilityDate: '2026-08-25',
        }));
        try {
            const db = await mf.getD1Database('DB');
            // These reads do not update rows, so update triggers are irrelevant.
            const schema = readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8')
                .split('CREATE TRIGGER')[0].replace(/--.*$/gm, '');
            for (const sql of schema.split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
            await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
                INSERT INTO files (id, metadata, timestamp, directory)
                SELECT (CASE WHEN i % 2 = 0 THEN 'assets/' ELSE '' END) || printf('%04d.png', i),
                    json_object('TimeStamp', i, 'Directory', CASE WHEN i % 2 = 0 THEN 'assets/' ELSE '' END),
                    i, CASE WHEN i % 2 = 0 THEN 'assets/' ELSE '' END FROM n`).run();
            const baseline = await db.prepare('SELECT id, metadata FROM files ORDER BY timestamp DESC, id DESC').all();
            let rowsRead = 0;
            const traced = { prepare(sql) {
                let statement = db.prepare(sql);
                return { bind(...params) { statement = statement.bind(...params); return this; }, async all() {
                    const result = await statement.all(); rowsRead += result.meta.rows_read; return result;
                } };
            } };
            const measurements = [];
            for (const options of [{ includeSubdirFiles: true }, {}, { directory: 'assets' }, { directory: 'missing' }]) {
                rowsRead = 0;
                const result = await readIndex({ env: { img_d1: traced } }, { count: 50, ...options });
                assert.equal(result.success, true);
                assert.equal(result.files.length, options.directory === 'missing' ? 0 : 50);
                assert.ok(rowsRead < baseline.meta.rows_read, `${JSON.stringify(options)}: ${rowsRead} vs ${baseline.meta.rows_read}`);
                measurements.push({ options, rowsRead });
            }
            rowsRead = 0;
            const bulk = await readIndex({ env: { img_d1: traced } }, { count: -1, includeSubdirFiles: true });
            assert.equal(bulk.files.length, 1000);
            assert.equal(rowsRead, baseline.meta.rows_read, 'bulk reads keep the existing single full read');
            rowsRead = 0;
            const deepPage = await readIndex({ env: { img_d1: traced } }, { count: 50, start: 950, includeSubdirFiles: true });
            assert.equal(deepPage.files.length, 50);
            assert.ok(rowsRead <= baseline.meta.rows_read + 100, 'deep offsets retain a bounded page lookup overhead');
            measurements.push({ options: { start: 950 }, rowsRead });
            await db.prepare('DROP INDEX idx_files_management_order').run();
            const withoutMigration = await readIndex({ env: { img_d1: traced } }, { count: 50, directory: 'assets' });
            assert.equal(withoutMigration.files.length, 50, 'the migration improves cost without becoming a correctness dependency');
            assert.equal(withoutMigration.totalCount, 500);
            const migration = readFileSync(new URL('../database/migrations/v2.12.0_management_queries.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
            for (let attempt = 0; attempt < 2; attempt++) {
                for (const sql of migration.split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
            }
            rowsRead = 0;
            await readIndex({ env: { img_d1: traced } }, { count: 50, directory: 'assets' });
            assert.ok(rowsRead < baseline.meta.rows_read, 'the repeatable migration restores the lower read cost');
            console.log('Local D1 read comparison:', JSON.stringify({ baseline: baseline.meta.rows_read, measurements }));
        } finally { await mf.dispose(); }
    });
});
