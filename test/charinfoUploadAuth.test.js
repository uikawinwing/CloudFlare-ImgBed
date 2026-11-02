import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TestD1 } from './helpers/d1.js';
import { onRequestPost as pairRoute } from '../functions/api/charinfo-upload/pair.js';
import { onRequestPost as authRoute } from '../functions/api/charinfo-upload/auth.js';
import { authorizeUploadRequest } from '../functions/utils/charinfoUploadAuth.js';

const origin = 'https://imgbed-staging.uika.cc.cd';
const connectionId = 'a'.repeat(48);
const proof = 'b'.repeat(64);
const parentOrigin = 'http://192.168.1.41:8000';

function fixture() {
    const db = new TestD1();
    db.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO users(discord_id,username,role,status,created_at,updated_at) VALUES ('a','Player A','member','active',1,1),('b','Player B','member','active',1,1)");
    const env = { img_d1: db, img_url: { get: async key => {
        const id = { 'manage@session@a-token': 'a', 'manage@session@b-token': 'b' }[key];
        return id ? JSON.stringify({ authType: 'user', expiresAt: Date.now() + 600000, identity: { id, username: `Player ${id.toUpperCase()}` } }) : null;
    } } };
    function context(body, { user, secret = proof, suppliedOrigin = origin, fetchSite = 'same-origin' } = {}) {
        return { env, request: new Request(`${origin}/api/charinfo-upload/auth`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: suppliedOrigin, 'Sec-Fetch-Site': fetchSite,
                ...(secret ? { 'X-CharInfo-Pair-Proof': secret } : {}), ...(user ? { Cookie: `user_session=${user}-token` } : {}) }, body: JSON.stringify(body) }) };
    }
    const call = (action, extra = {}, options) => authRoute(context({ action, connectionId, ...extra }, options));
    const register = (extra = {}, options) => pairRoute(context({ connectionId, parentOrigin, proof, ...extra }, options));
    async function approve() {
        assert.equal((await register()).status, 200);
        assert.equal((await call('approve', {}, { user: 'a' })).status, 200);
        return (await call('status')).json();
    }
    return { db, env, context, call, register, approve };
}

describe('private CharInfo upload authorization', () => {
    let f;
    beforeEach(() => { f = fixture(); });
    afterEach(() => f.db.db.close());

    it('keeps hello/pairing distinct from authorization and refuses public IDs as credentials', async () => {
        assert.equal((await f.register()).status, 200);
        assert.deepEqual(await (await f.call('status')).json(), { connected: false });
        assert.equal((await f.call('status', {}, { secret: null })).status, 401);
        assert.equal((await f.call('approve')).status, 401);
        assert.equal((await f.call('approve', {}, { secret: null, user: 'a' })).status, 401);
        assert.equal((await f.call('inspect', {}, { user: 'a', secret: 'c'.repeat(64) })).status, 401);
        const info = await (await f.call('inspect', {}, { user: 'a' })).json();
        assert.equal(info.parentOrigin, parentOrigin);
        assert.equal(info.accountName, 'Player A');
        assert.equal(info.approved, false);
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 200);
        const result = await (await f.call('status')).json();
        assert.equal(result.connected, true);
        assert.notEqual(result.accountId, 'a');
        assert.match(result.sessionId, /^[A-Za-z0-9_-]{1,128}$/);
        assert.match(result.resumeProof, /^[a-f0-9]{64}$/);
        assert.equal(result.userId, undefined);
        const identity = await authorizeUploadRequest(f.context({}), connectionId, result.sessionId);
        assert.equal(identity.id, 'a');
    });

    it('rejects changed pairing claims and does not overwrite another iframe proof', async () => {
        await f.register();
        assert.equal((await f.register()).status, 200);
        for (const extra of [{ proof: 'c'.repeat(64) }, { parentOrigin: 'https://other.example' }]) assert.equal((await f.register(extra)).status, 409);
        for (const extra of [{ parentOrigin: 'null' }, { parentOrigin: 'https://example.org/' }, { parentOrigin: 'https://user@example.org' }, { connectionId: 'short' }, { connectionId: [connectionId] }, { proof: [proof] }]) assert.equal((await f.register(extra)).status, 400);
    });

    it('preserves existing same-origin CSRF boundaries and adds no credentialed CORS', async () => {
        for (const options of [{ suppliedOrigin: 'https://evil.example' }, { suppliedOrigin: '', fetchSite: 'same-origin' }, { fetchSite: 'cross-site' }]) assert.equal((await f.register({}, options)).status, 403);
        await f.register();
        const response = await f.call('approve', {}, { user: 'a', suppliedOrigin: 'https://evil.example' });
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await f.call('approve', { ownerId: 'b' }, { user: 'a' })).status, 400);
    });

    it('resumes only with a private refresh proof for the same exact parent origin', async () => {
        const current = await f.approve();
        const second = 'd'.repeat(48);
        await f.register({ connectionId: second });
        const resume = extra => authRoute(f.context({ action: 'resume', connectionId: second, ...extra }));
        assert.equal((await resume({ resumeProof: current.accountId })).status, 401);
        const resumed = await (await resume({ resumeProof: current.resumeProof })).json();
        assert.equal(resumed.accountId, current.accountId);
        assert.notEqual(resumed.sessionId, current.sessionId);
        assert.equal(resumed.connected, true);
        const third = 'e'.repeat(48);
        await f.register({ connectionId: third, parentOrigin: 'https://other.example' });
        assert.equal((await authRoute(f.context({ action: 'resume', connectionId: third, resumeProof: current.resumeProof }))).status, 401);
    });

    it('rotates sessions without sliding the absolute grant deadline and rejects stale sessions', async () => {
        const before = await f.approve();
        const renewed = await (await f.call('renew', { sessionId: before.sessionId })).json();
        assert.notEqual(renewed.sessionId, before.sessionId);
        assert.equal(renewed.grantExpiresAt, before.grantExpiresAt);
        await assert.rejects(authorizeUploadRequest(f.context({}), connectionId, before.sessionId), { code: 'AUTH_REQUIRED' });
        assert.equal((await authorizeUploadRequest(f.context({}), connectionId, renewed.sessionId)).id, 'a');
        f.db.exec("UPDATE other_data SET value=json_set(value,'$.expiresAt',0) WHERE type='charinfo_upload_grant'");
        assert.deepEqual(await (await f.call('status')).json(), { connected: false });
        assert.equal((await f.call('renew', { sessionId: renewed.sessionId })).status, 401);
    });

    it('revokes the server grant before confirming disconnect, including other resumed connections', async () => {
        const current = await f.approve();
        f.db.failOnStatement = 0;
        assert.equal((await f.call('disconnect', { sessionId: current.sessionId })).status, 409);
        assert.equal((await (await f.call('status')).json()).connected, true);
        f.db.failOnStatement = null;
        assert.deepEqual(await (await f.call('disconnect', { sessionId: current.sessionId })).json(), { connected: false });
        assert.equal((await f.call('resume', { resumeProof: current.resumeProof })).status, 401);
        await assert.rejects(authorizeUploadRequest(f.context({}), connectionId, current.sessionId), { code: 'AUTH_REQUIRED' });
    });

    it('changes the public account and session identifiers after explicit consent with another account', async () => {
        const first = await f.approve();
        await f.call('approve', {}, { user: 'b' });
        const second = await (await f.call('status')).json();
        assert.notEqual(second.accountId, first.accountId);
        assert.notEqual(second.sessionId, first.sessionId);
        assert.equal((await authorizeUploadRequest(f.context({}), connectionId, second.sessionId)).id, 'b');
        assert.equal((await f.call('resume', { resumeProof: first.resumeProof })).status, 401);
    });

    it('rejects suspended owners and expired pending connections', async () => {
        await f.approve();
        f.db.exec("UPDATE users SET status='suspended' WHERE discord_id='a'");
        assert.deepEqual(await (await f.call('status')).json(), { connected: false });
        f.db.exec("UPDATE users SET status='active' WHERE discord_id='a'; UPDATE other_data SET value=json_set(value,'$.expiresAt',0) WHERE type='charinfo_upload_pair'");
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 410);
    });
});
