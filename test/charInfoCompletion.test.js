import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../functions/api/user/charinfo/complete.js';
import { onRequest as userMiddleware } from '../functions/api/user/_middleware.js';
import { TestD1 } from './helpers/d1.js';

const draftId = '12345678-1234-4234-8234-123456789abc';

function fixture() {
    const db = new TestD1();
    db.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO users (discord_id, username, public_handle, created_at, updated_at)
        VALUES ('owner', 'Master', 'master', 1, 1), ('other', 'Other', 'other', 1, 1);
        INSERT INTO files (id, metadata, file_type, owner_id, visibility, moderation_status)
        VALUES ('first.png', '{}', 'image/png', 'owner', 'private', 'active'),
            ('second.png', '{}', 'image/png', 'owner', 'public', 'active'),
            ('third.png', '{}', 'image/png', 'owner', 'public', 'active'),
            ('foreign.png', '{}', 'image/png', 'other', 'public', 'active'),
            ('pending.png', '{}', 'image/png', 'owner', 'public', 'pending'),
            ('clip.webm', '{}', 'video/webm', 'owner', 'public', 'active');`);
    const env = {
        img_d1: db,
        img_url: { get: async key => key === 'manage@session@token' ? JSON.stringify({
            authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: 'owner' },
        }) : null },
    };
    return { db, env };
}

function payload(overrides = {}) {
    return {
        draftId, characterName: '旅行者', fileIds: ['first.png', 'second.png'],
        config: { mainFileId: 'first.png', avatarFileId: 'first.png', coverFileId: 'second.png' },
        ...overrides,
    };
}

function complete(env, body = payload(), headers = {}) {
    const request = new Request('https://example.test/api/user/charinfo/complete', {
        method: 'POST', headers: { Cookie: 'user_session=token', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
    return userMiddleware({ env, request, next: () => onRequestPost({ env, request }) });
}

describe('CharInfo workflow completion', () => {
    let db;
    afterEach(() => db?.db.close());

    it('atomically publishes owned media and returns stable links without storing the original prompt', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        const response = await complete(fixtureData.env, payload({
            originalPrompt: 'Private character text',
            config: { mainFileId: 'first.png', metadata: { race: '人类' }, originalPrompt: 'Private character text' },
        }));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(result.album, { id: draftId, name: '旅行者', slug: `character-${draftId}` });
        assert.equal(result.remoteGalleryUrl, `https://example.test/api/public/charinfo/${draftId}?view=gallery`);
        assert.equal(result.albumUrl, `https://example.test/gallery/master/character-${draftId}`);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_items').get().n, 2);
        assert.equal(db.db.prepare("SELECT visibility FROM files WHERE id = 'first.png'").get().visibility, 'private');
        const stored = db.db.prepare('SELECT value FROM other_data WHERE key = ?').get(`charinfo.visual:${draftId}`).value;
        assert.equal(JSON.parse(stored).metadata.race, '人类');
        assert.ok(!stored.includes('Private character text'));
        assert.equal(result.config.originalPrompt, undefined);
    });

    it('reuses the same draft on a lost-response retry', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        assert.equal((await complete(fixtureData.env)).status, 200);
        assert.equal((await complete(fixtureData.env, payload({ characterName: '新名字' }))).status, 200);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM albums').get().n, 1);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_items').get().n, 2);
        assert.equal(db.db.prepare('SELECT name FROM albums').get().name, '新名字');
    });

    it('preserves unknown existing members and only removes explicitly selected memberships', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        await complete(fixtureData.env);
        db.exec(`INSERT INTO album_items (album_id, file_id, position, created_at) VALUES ('${draftId}', 'third.png', 0, 2);`);
        const response = await complete(fixtureData.env, payload({
            albumId: draftId, fileIds: ['second.png'], removedFileIds: ['first.png'], config: { mainFileId: 'second.png' },
        }));
        assert.equal(response.status, 200);
        assert.deepEqual(db.db.prepare('SELECT file_id FROM album_items ORDER BY position').all().map(row => row.file_id), ['second.png', 'third.png']);
        assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM files WHERE id = 'first.png'").get().n, 1);
        assert.equal((await complete(fixtureData.env, payload({ albumId: draftId, fileIds: ['second.png'], config: {} }))).status, 200);
        assert.deepEqual(db.db.prepare('SELECT position FROM album_items ORDER BY position').all().map(row => row.position), [0, 1]);
    });

    it('rejects missing handles before creating a gallery', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        db.exec("UPDATE users SET public_handle = NULL WHERE discord_id = 'owner'");
        const response = await complete(fixtureData.env);
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, 'PUBLIC_HANDLE_REQUIRED');
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM albums').get().n, 0);
    });

    it('preserves the current cover crop until that image is explicitly removed, without deleting its file', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        await complete(fixtureData.env);
        db.db.prepare('INSERT INTO album_covers (album_id, file_id, position_x, position_y, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(draftId, 'first.png', 20, 80, 1);
        assert.equal((await complete(fixtureData.env, payload({ albumId: draftId }))).status, 200);
        assert.deepEqual({ ...db.db.prepare('SELECT file_id, position_x, position_y FROM album_covers WHERE album_id = ?').get(draftId) }, {
            file_id: 'first.png', position_x: 20, position_y: 80,
        });
        const response = await complete(fixtureData.env, payload({
            albumId: draftId, fileIds: ['second.png'], removedFileIds: ['first.png'], config: { mainFileId: 'second.png' },
        }));
        assert.equal(response.status, 200);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_covers WHERE album_id = ?').get(draftId).n, 0);
        assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM files WHERE id = 'first.png'").get().n, 1);
        assert.deepEqual(db.db.prepare('SELECT file_id FROM album_items WHERE album_id = ?').all(draftId).map(row => row.file_id), ['second.png']);
    });

    it('does not permit anonymous or cross-site mutations', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        assert.equal((await complete(fixtureData.env, payload(), { Cookie: '' })).status, 401);
        assert.equal((await complete(fixtureData.env, payload(), { Origin: 'https://attacker.test' })).status, 403);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM albums').get().n, 0);
    });

    it('rejects foreign albums, foreign files, pending files, and invalid display references', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        db.exec("INSERT INTO albums (id, owner_id, slug, name, created_at, updated_at) VALUES ('foreign-album', 'other', 'foreign', 'Other', 1, 1)");
        const cases = [
            [payload({ albumId: 'foreign-album' }), 404, 'ALBUM_NOT_FOUND'],
            [payload({ albumId: 'missing-album' }), 404, 'ALBUM_NOT_FOUND'],
            [payload({ fileIds: ['foreign.png'], config: {} }), 400, 'FILES_UNAVAILABLE'],
            [payload({ fileIds: ['pending.png'], config: {} }), 409, 'FILES_NOT_READY'],
            [payload({ config: { avatarFileId: 'foreign.png' } }), 400, 'INVALID_CONFIG'],
            [payload({ fileIds: ['clip.webm'], config: { avatarFileId: 'clip.webm' } }), 400, 'INVALID_CONFIG'],
            [payload({ removedFileIds: ['first.png'] }), 400, 'INVALID_INPUT'],
        ];
        for (const [body, status, code] of cases) {
            const response = await complete(fixtureData.env, body);
            assert.equal(response.status, status);
            assert.equal((await response.json()).code, code);
        }
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_items').get().n, 0);
    });

    it('rejects legacy blocked files and retired storage while respecting explicit whitelist access', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        for (const metadata of [{ ListType: 'Block' }, { Label: 'adult' }, { Channel: 'S3' }, { Channel: 'WebDAV' }, { ModerationStatus: 'pending' }]) {
            db.db.prepare("UPDATE files SET metadata = ? WHERE id = 'first.png'").run(JSON.stringify(metadata));
            assert.equal((await complete(fixtureData.env)).status, 400);
        }
        db.db.prepare("UPDATE files SET metadata = ? WHERE id = 'first.png'").run(JSON.stringify({ ListType: 'White', Label: 'adult' }));
        assert.equal((await complete(fixtureData.env)).status, 200);
    });

    it('rolls back the album and memberships when a later statement fails', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        db.failOnStatement = 5;
        assert.equal((await complete(fixtureData.env)).status, 503);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM albums').get().n, 0);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_items').get().n, 0);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM other_data').get().n, 0);
    });

    for (const [name, mutation] of [
        ['account status', "UPDATE users SET status = 'suspended' WHERE discord_id = 'owner'"],
        ['public handle', "UPDATE users SET public_handle = 'changed' WHERE discord_id = 'owner'"],
        ['file ownership', "UPDATE files SET owner_id = 'other' WHERE id = 'first.png'"],
        ['file moderation', "UPDATE files SET moderation_status = 'deleting' WHERE id = 'first.png'"],
        ['file availability', "UPDATE files SET metadata = '{\"ListType\":\"Block\"}' WHERE id = 'first.png'"],
        ['avatar type', "UPDATE files SET file_type = 'video/webm' WHERE id = 'first.png'"],
    ]) {
        it(`rechecks ${name} inside the completion transaction`, async () => {
            const fixtureData = fixture(); db = fixtureData.db;
            const batch = db.batch.bind(db);
            db.batch = statements => { db.exec(mutation); return batch(statements); };
            const response = await complete(fixtureData.env);
            assert.equal(response.status, 409);
            assert.equal((await response.json()).code, 'COMPLETION_CONFLICT');
            assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM albums').get().n, 0);
            assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_items').get().n, 0);
        });
    }

    it('does not return an obsolete sharing slug after a concurrent rename', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        await complete(fixtureData.env);
        const batch = db.batch.bind(db);
        db.batch = statements => { db.exec(`UPDATE albums SET slug = 'changed' WHERE id = '${draftId}'`); return batch(statements); };
        const response = await complete(fixtureData.env, payload({ albumId: draftId, characterName: 'Changed name' }));
        assert.equal(response.status, 409);
        assert.equal(db.db.prepare('SELECT name FROM albums').get().name, '旅行者');
    });

    for (const [name, mutation] of [
        ['ownership changes', `UPDATE albums SET owner_id = 'other' WHERE id = '${draftId}'`],
        ['deletion', `DELETE FROM albums WHERE id = '${draftId}'`],
    ]) {
        it(`cannot update an existing album after concurrent ${name}`, async () => {
            const fixtureData = fixture(); db = fixtureData.db;
            await complete(fixtureData.env);
            const batch = db.batch.bind(db);
            db.batch = statements => { db.exec(mutation); return batch(statements); };
            const response = await complete(fixtureData.env, payload({ albumId: draftId, characterName: 'Unauthorized update' }));
            assert.equal(response.status, 409);
            assert.equal((await response.json()).code, 'COMPLETION_CONFLICT');
            const remaining = db.db.prepare('SELECT name FROM albums WHERE id = ?').get(draftId);
            assert.ok(!remaining || remaining.name === '旅行者');
        });
    }

    it('rolls back explicit removals and config changes when saving an existing gallery fails', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        await complete(fixtureData.env);
        db.db.prepare('INSERT INTO album_covers (album_id, file_id, updated_at) VALUES (?, ?, ?)').run(draftId, 'first.png', 1);
        db.failOnStatement = 5;
        const response = await complete(fixtureData.env, payload({
            albumId: draftId, characterName: 'Unsaved name', fileIds: ['second.png'], removedFileIds: ['first.png'],
            config: { mainFileId: 'second.png' },
        }));
        assert.equal(response.status, 503);
        assert.equal(db.db.prepare('SELECT name FROM albums').get().name, '旅行者');
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_items').get().n, 2);
        assert.equal(db.db.prepare('SELECT file_id FROM album_covers WHERE album_id = ?').get(draftId).file_id, 'first.png');
        assert.equal(JSON.parse(db.db.prepare('SELECT value FROM other_data WHERE key = ?').get(`charinfo.visual:${draftId}`).value).mainFileId, 'first.png');
    });

    it('supports 500 media files without exceeding the per-statement binding budget', async () => {
        const fixtureData = fixture(); db = fixtureData.db;
        db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n < 500)
            INSERT INTO files (id, metadata, file_type, owner_id) SELECT printf('file-%03d.png', n), '{}', 'image/png', 'owner' FROM numbers`);
        const fileIds = Array.from({ length: 500 }, (_, index) => `file-${String(index + 1).padStart(3, '0')}.png`);
        const batch = db.batch.bind(db);
        db.batch = statements => { assert.ok(statements.every(statement => statement.params.length < 100)); return batch(statements); };
        assert.equal((await complete(fixtureData.env, payload({ fileIds, config: { mainFileId: fileIds[0] } }))).status, 200);
        assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM album_items').get().n, 500);
    });
});
