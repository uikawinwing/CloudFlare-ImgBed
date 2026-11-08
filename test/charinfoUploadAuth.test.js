import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TestD1 } from './helpers/d1.js';
import { onRequestPost as pairRoute } from '../functions/api/charinfo-upload/pair.js';
import { onRequestPost as authRoute } from '../functions/api/charinfo-upload/auth.js';
import { onRequestPost as launchRoute } from '../functions/api/charinfo-upload/launch.js';
import { authorizeUploadRequest } from '../functions/utils/charinfoUploadAuth.js';
import { createDiscordSession } from '../functions/utils/auth/discordIdentity.js';

const origin = 'https://imgbed-staging.uika.cc.cd';
const connectionId = 'a'.repeat(48);
const proof = 'b'.repeat(64);
const parentOrigin = 'http://192.168.1.41:8000';

function fixture() {
    let launchCookie, inspectedAccountId;
    const kvWrites = { put: 0, delete: 0 };
    const db = new TestD1();
    db.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    db.exec("INSERT INTO users(discord_id,username,role,status,created_at,updated_at) VALUES ('a','Player A','member','active',1,1),('b','Player B','member','active',1,1)");
    const env = { img_d1: db, img_url: { get: async key => {
        const id = { 'manage@session@a-token': 'a', 'manage@session@b-token': 'b' }[key];
        return id ? JSON.stringify({ authType: 'user', expiresAt: Date.now() + 600000, identity: { id, username: `Player ${id.toUpperCase()}` } }) : null;
    }, put: async () => { kvWrites.put++; }, delete: async () => { kvWrites.delete++; } } };
    function context(body, { user, secret = proof, suppliedOrigin = origin, fetchSite = 'same-origin', cookie = launchCookie } = {}) {
        const cookies = [user ? `user_session=${user}-token` : '', cookie || ''].filter(Boolean).join('; ');
        return { env, request: new Request(`${origin}/api/charinfo-upload/auth`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: suppliedOrigin, 'Sec-Fetch-Site': fetchSite,
                ...(secret ? { 'X-CharInfo-Pair-Proof': secret } : {}), ...(cookies ? { Cookie: cookies } : {}) }, body: JSON.stringify(body) }) };
    }
    const call = async (action, extra = {}, options) => {
        const response = await authRoute(context({ action, connectionId,
            ...(action === 'approve' ? { accountId: inspectedAccountId } : {}), ...extra }, options));
        if (action === 'inspect' && response.ok) inspectedAccountId = (await response.clone().json()).accountId;
        return response;
    };
    const register = (extra = {}, options) => pairRoute(context({ connectionId, parentOrigin, proof, ...extra }, options));
    async function launch({ body = { connectionId, proof }, headers = {}, method = 'POST', search = '' } = {}) {
        const response = await launchRoute({ env, request: new Request(`${origin}/api/charinfo-upload/launch${search}`, { method,
            headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
                'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: method === 'POST' ? new URLSearchParams(body) : undefined }) });
        if (response.status === 303) launchCookie = response.headers.get('Set-Cookie').split(';')[0];
        return response;
    }
    async function approve() {
        assert.equal((await register()).status, 200);
        assert.equal((await launch()).status, 303);
        assert.equal((await call('inspect', {}, { user: 'a', secret: null })).status, 200);
        assert.equal((await call('approve', {}, { user: 'a' })).status, 200);
        return (await call('status')).json();
    }
    return { db, env, context, call, register, launch, approve, kvWrites };
}

describe('private CharInfo upload authorization', () => {
    let f;
    beforeEach(() => { f = fixture(); });
    afterEach(() => f.db.db.close());

    it('keeps hello/pairing distinct from authorization and refuses public IDs as credentials', async () => {
        assert.equal((await f.register()).status, 200);
        assert.deepEqual(await (await f.call('status')).json(), { connected: false });
        assert.equal((await f.call('status', {}, { secret: null })).status, 401);
        assert.equal((await f.call('approve')).status, 403);
        assert.equal((await f.call('approve', {}, { secret: null, user: 'a' })).status, 403);
        assert.equal((await f.call('inspect', {}, { user: 'a' })).status, 403);
        assert.equal((await f.launch()).status, 303);
        assert.equal((await f.call('approve')).status, 401);
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 403);
        const info = await (await f.call('inspect', {}, { user: 'a', secret: null })).json();
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

    it('issues a fixed 30-day media grant and keeps daily pair/status/resume/renew/disconnect out of KV writes', async () => {
        const initial = await f.approve();
        const grant = JSON.parse((await f.db.prepare("SELECT value FROM other_data WHERE type='charinfo_upload_grant'").first()).value);
        assert.equal(grant.expiresAt - grant.approvedAt, 30 * 24 * 60 * 60 * 1000);
        assert.equal(initial.grantExpiresAt, grant.expiresAt);
        assert.ok(initial.expiresAt <= grant.approvedAt + 12 * 60 * 1000);
        for (let index = 0; index < 50; index++) assert.equal((await f.call('status')).status, 200);
        const second = 'd'.repeat(48);
        assert.equal((await f.register({ connectionId: second })).status, 200);
        const secondCall = (action, fields = {}) => authRoute(f.context({ action, connectionId: second, ...fields }));
        let resumed = await (await secondCall('resume', { resumeProof: initial.resumeProof })).json();
        assert.equal(resumed.grantExpiresAt, initial.grantExpiresAt);
        assert.equal(resumed.connected, true);
        for (let index = 0; index < 3; index++) {
            resumed = await (await secondCall('renew', { sessionId: resumed.sessionId })).json();
            assert.equal(resumed.grantExpiresAt, initial.grantExpiresAt);
            assert.ok(resumed.expiresAt <= Date.now() + 12 * 60 * 1000);
        }
        assert.equal((await secondCall('disconnect', { sessionId: resumed.sessionId })).status, 200);
        assert.deepEqual(await (await f.call('status')).json(), { connected: false });
        assert.equal((await f.call('resume', { resumeProof: initial.resumeProof })).status, 401);
        assert.deepEqual(f.kvWrites, { put: 0, delete: 0 });
    });

    it('does not extend an existing shorter grant when resuming or renewing its internal session', async () => {
        const initial = await f.approve();
        const existingDeadline = Date.now() + 24 * 60 * 60 * 1000;
        await f.db.prepare("UPDATE other_data SET value=json_set(value,'$.expiresAt',?) WHERE type='charinfo_upload_grant'").bind(existingDeadline).run();
        const second = 'd'.repeat(48);
        await f.register({ connectionId: second });
        const secondCall = (action, fields = {}) => authRoute(f.context({ action, connectionId: second, ...fields }));
        const resumed = await (await secondCall('resume', { resumeProof: initial.resumeProof })).json();
        assert.equal(resumed.grantExpiresAt, existingDeadline);
        const renewed = await (await secondCall('renew', { sessionId: resumed.sessionId })).json();
        assert.equal(renewed.grantExpiresAt, existingDeadline);
        const nearDeadline = Date.now() + 30000;
        await f.db.prepare("UPDATE other_data SET value=json_set(value,'$.expiresAt',?) WHERE type='charinfo_upload_grant'").bind(nearDeadline).run();
        const limited = await (await secondCall('renew', { sessionId: renewed.sessionId })).json();
        assert.equal(limited.expiresAt, nearDeadline);
        assert.equal(limited.grantExpiresAt, nearDeadline);
        assert.deepEqual(f.kvWrites, { put: 0, delete: 0 });
    });

    it('retains the existing single KV session write and 24-hour cookie for a Discord login', async () => {
        const session = await createDiscordSession(f.env, { id: 'a', username: 'Player A' });
        assert.match(session.cookie, /Max-Age=86400(?:;|$)/);
        assert.match(session.cookie, /; Secure(?:;|$)/);
        assert.deepEqual(f.kvWrites, { put: 1, delete: 0 });
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
        assert.equal((await f.launch()).status, 303);
        assert.equal((await f.call('inspect', {}, { user: 'b' })).status, 200);
        assert.equal((await f.call('approve', {}, { user: 'b' })).status, 200);
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
        assert.equal((await f.launch()).status, 410);
    });

    it('rejects forged out-of-browser pair registrations unless the current browser performed the same-origin launch POST', async () => {
        await f.register();
        assert.equal((await f.call('inspect', {}, { user: 'a' })).status, 403);
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 403);
        for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' },
            { 'Sec-Fetch-Site': '' }, { 'Sec-Fetch-Mode': '' }, { 'Sec-Fetch-Dest': '' },
            { 'Sec-Fetch-Mode': 'cors' }, { 'Sec-Fetch-Dest': 'iframe' }]) {
            const response = await f.launch({ headers });
            assert.equal(response.status, 403);
            assert.equal(response.headers.get('Set-Cookie'), null);
        }
        assert.equal((await f.launch({ method: 'GET' })).status, 403);
        assert.equal((await f.launch({ search: '?proof=' + proof })).status, 403);
        assert.equal((await f.launch({ body: { connectionId, proof, parentOrigin: 'https://evil.example' } })).status, 400);
        assert.equal((await f.launch({ body: [['connectionId', connectionId], ['connectionId', connectionId], ['proof', proof]] })).status, 400);
        const response = await f.launch();
        assert.equal(response.status, 303);
        assert.equal(response.headers.get('Location'), '/charinfo-upload/connect?' + new URLSearchParams({ connection_id: connectionId, parent_origin: parentOrigin }));
        assert.match(response.headers.get('Set-Cookie'), /^__Host-charinfo-upload-[a-f0-9]{48}=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
        assert.equal((await response.text()).includes(proof), false);
    });

    it('binds confirmation to the inspected account and consumes the launch context exactly once', async () => {
        await f.register(); await f.launch();
        assert.equal((await f.call('inspect', {}, { user: 'a' })).status, 200);
        const changed = await f.call('approve', {}, { user: 'b' });
        assert.equal(changed.status, 409);
        assert.equal((await changed.json()).code, 'ACCOUNT_CHANGED');
        assert.equal((await f.call('inspect', {}, { user: 'b' })).status, 200);
        assert.equal((await f.call('approve', {}, { user: 'b' })).status, 200);
        assert.equal((await f.call('approve', {}, { user: 'b' })).status, 403);
        assert.equal((await f.call('inspect', {}, { user: 'b' })).status, 403);
        assert.equal((await (await f.call('status')).json()).accountName, 'Player B');
    });

    it('does not authorize an account inspected in another tab without matching the current page', async () => {
        await f.register(); await f.launch();
        const oldPage = await (await f.call('inspect', {}, { user: 'a' })).json();
        const newPage = await (await f.call('inspect', {}, { user: 'b' })).json();
        assert.equal((await f.call('approve', { accountId: oldPage.accountId }, { user: 'b' })).status, 409);
        assert.equal((await f.call('approve', { accountId: newPage.accountId }, { user: 'b' })).status, 200);
    });

    it('invalidates old launch cookies on retry, rejects duplicate cookies and expires unused contexts', async () => {
        await f.register(); await f.launch();
        const previous = f.context({}).request.headers.get('Cookie');
        await f.launch();
        assert.equal((await f.call('inspect', {}, { user: 'a', cookie: previous })).status, 403);
        const current = f.context({}).request.headers.get('Cookie');
        assert.equal((await f.call('inspect', {}, { user: 'a', cookie: `${current}; ${current}` })).status, 403);
        f.db.exec("UPDATE other_data SET value=json_set(value,'$.launchExpiresAt',0) WHERE type='charinfo_upload_pair'");
        assert.equal((await f.call('inspect', {}, { user: 'a' })).status, 410);
    });

    it('allows only one concurrent approval and invalidates a waiting launch when ST cancels', async () => {
        await f.register(); await f.launch(); await f.call('inspect', {}, { user: 'a' });
        const approvals = await Promise.all([f.call('approve', {}, { user: 'a' }), f.call('approve', {}, { user: 'a' })]);
        assert.deepEqual(approvals.map(response => response.status).sort(), [200, 409]);
        assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM other_data WHERE type='charinfo_upload_grant'").first()).count, 1);
        await f.launch(); await f.call('inspect', {}, { user: 'a' });
        assert.equal((await f.call('disconnect')).status, 200);
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 403);
        assert.deepEqual(await (await f.call('status')).json(), { connected: false });
    });

    it('preserves the private refresh proof of an already-issued legacy grant', async () => {
        await f.approve();
        const key = `charinfo-upload:pair:${connectionId}`;
        const pair = JSON.parse((await f.db.prepare('SELECT value FROM other_data WHERE key=?').bind(key).first()).value);
        const oldGrant = JSON.parse((await f.db.prepare('SELECT value FROM other_data WHERE key=?').bind(`charinfo-upload:grant:${pair.grantHash}`).first()).value);
        const legacyProof = createHash('sha256').update(`charinfo-upload-resume-v1:${proof}:a:${pair.resumeSalt}`).digest('hex');
        const legacyGrantHash = createHash('sha256').update(legacyProof).digest('hex');
        delete pair.resumeVersion;
        pair.grantHash = legacyGrantHash;
        await f.db.prepare('UPDATE other_data SET value=? WHERE key=?').bind(JSON.stringify(pair), key).run();
        await f.db.prepare("INSERT INTO other_data(key,value,type) VALUES (?,?,'charinfo_upload_grant')").bind(`charinfo-upload:grant:${legacyGrantHash}`, JSON.stringify(oldGrant)).run();
        assert.equal((await (await f.call('status')).json()).resumeProof, legacyProof);
        const second = 'f'.repeat(48);
        await f.register({ connectionId: second });
        const resumed = await authRoute(f.context({ action: 'resume', connectionId: second, resumeProof: legacyProof }));
        assert.equal(resumed.status, 200);
        assert.equal((await resumed.json()).connected, true);
    });

    it('keeps failed approval atomic, and cancels pending or approved contexts without replay', async () => {
        await f.register(); await f.launch();
        await f.call('inspect', {}, { user: 'a' });
        f.db.failOnStatement = 1;
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 409);
        assert.equal((await (await f.call('status')).json()).connected, false);
        assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM other_data WHERE type='charinfo_upload_grant'").first()).count, 0);
        f.db.failOnStatement = null;
        assert.equal((await f.call('deny')).status, 200);
        assert.equal((await f.call('status')).status, 403);
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 403);
        await f.launch(); await f.call('inspect', {}, { user: 'a' });
        assert.equal((await f.call('approve', {}, { user: 'a' })).status, 200);
        const current = await (await f.call('status')).json();
        await f.launch();
        assert.equal((await f.call('deny')).status, 200);
        assert.equal((await f.call('resume', { resumeProof: current.resumeProof })).status, 401);
    });
});
