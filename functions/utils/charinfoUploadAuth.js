import { getDiscordIdentity } from './auth/discordIdentity.js';
import { rejectCrossSiteMutation } from './auth/mutationSecurity.js';

const CONNECTION = /^[a-f0-9]{48}$/;
const PROOF = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_MS = 12 * 60 * 1000;
const GRANT_MS = 24 * 60 * 60 * 1000;
const LAUNCH_MS = 10 * 60 * 1000;
const pairKey = id => `charinfo-upload:pair:${id}`;
const grantKey = hash => `charinfo-upload:grant:${hash}`;
const launchCookieName = id => `__Host-charinfo-upload-${id}`;

export function uploadError(code, status = 400) {
    return Object.assign(new Error(code), { code, status });
}

export function uploadJson(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    } });
}

export function uploadFailure(error) {
    const known = typeof error?.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code);
    return uploadJson({ code: known ? error.code : 'SERVICE_UNAVAILABLE', error: '请求未完成，请保留草稿后重试。' }, known ? error.status || 400 : 503);
}

export async function uploadBody(request) {
    if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) throw uploadError('BAD_REQUEST');
    const reader = request.body?.getReader();
    if (!reader) throw uploadError('BAD_REQUEST');
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512 * 1024) { await reader.cancel(); throw uploadError('BAD_REQUEST', 413); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try {
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        return body;
    } catch { throw uploadError('BAD_REQUEST'); }
}

export function checkUploadOrigin(request) {
    const error = rejectCrossSiteMutation(request);
    if (error || request.headers.get('Origin') !== new URL(request.url).origin) throw uploadError('CROSS_SITE_REJECTED', 403);
}

export function validParentOrigin(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value && value.length <= 300; }
    catch { return false; }
}

async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sameDigest(left, right) {
    if (typeof left !== 'string' || left.length !== 64 || typeof right !== 'string' || right.length !== 64) return false;
    let difference = 0;
    for (let index = 0; index < 64; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return difference === 0;
}

async function row(env, key) {
    if (!env.img_d1?.prepare) throw uploadError('STORAGE_UNAVAILABLE', 503);
    const result = await env.img_d1.prepare('SELECT value FROM other_data WHERE key = ?').bind(key).first();
    if (!result) return null;
    try { return { raw: result.value, value: JSON.parse(result.value) }; }
    catch { throw uploadError('STORAGE_UNAVAILABLE', 503); }
}

async function insert(env, key, value, type) {
    await env.img_d1.prepare('INSERT INTO other_data (key, value, type) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING')
        .bind(key, JSON.stringify(value), type).run();
}

async function replace(env, key, previous, next) {
    const result = await env.img_d1.prepare('UPDATE other_data SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND value = ?')
        .bind(JSON.stringify(next), key, previous).run();
    if (!result.meta?.changes) throw uploadError('AUTH_CONFLICT', 409);
}

function checkConnection(connectionId) {
    if (typeof connectionId !== 'string' || !CONNECTION.test(connectionId)) throw uploadError('BAD_REQUEST');
}

async function paired(context, connectionId) {
    checkConnection(connectionId);
    const proof = context.request.headers.get('X-CharInfo-Pair-Proof');
    if (!PROOF.test(proof || '')) throw uploadError('AUTH_REQUIRED', 401);
    const found = await row(context.env, pairKey(connectionId));
    if (!found || !sameDigest(found.value.proofHash, await digest(proof))) throw uploadError('AUTH_REQUIRED', 401);
    return { ...found, proof };
}

async function launched(context, connectionId) {
    checkConnection(connectionId);
    const name = launchCookieName(connectionId);
    const cookies = (context.request.headers.get('Cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
    if (cookies.length !== 1) throw uploadError('LAUNCH_REQUIRED', 403);
    const secret = cookies[0].slice(name.length + 1);
    const found = await row(context.env, pairKey(connectionId));
    if (!PROOF.test(secret) || !found || !sameDigest(found.value.launchHash, await digest(secret))) throw uploadError('LAUNCH_REQUIRED', 403);
    if (found.value.launchExpiresAt <= Date.now() || found.value.expiresAt <= Date.now()) throw uploadError('PAIR_EXPIRED', 410);
    return found;
}

export async function launchUploadAuthorization(context) {
    const { request, env } = context;
    checkUploadOrigin(request);
    if (request.method !== 'POST' || request.headers.get('Sec-Fetch-Site') !== 'same-origin'
        || request.headers.get('Sec-Fetch-Mode') !== 'navigate' || request.headers.get('Sec-Fetch-Dest') !== 'document'
        || new URL(request.url).search) throw uploadError('CROSS_SITE_REJECTED', 403);
    if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw uploadError('BAD_REQUEST');
    const reader = request.body?.getReader();
    if (!reader) throw uploadError('BAD_REQUEST');
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) { await reader.cancel(); throw uploadError('BAD_REQUEST', 413); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let form;
    try { form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw uploadError('BAD_REQUEST'); }
    if ([...form.keys()].sort().join(',') !== 'connectionId,proof') throw uploadError('INPUT_REJECTED');
    const connectionId = form.get('connectionId');
    const proof = form.get('proof');
    checkConnection(connectionId);
    if (!PROOF.test(proof || '')) throw uploadError('AUTH_REQUIRED', 401);
    const pair = await row(env, pairKey(connectionId));
    if (!pair || !sameDigest(pair.value.proofHash, await digest(proof))) throw uploadError('AUTH_REQUIRED', 401);
    const now = Date.now();
    if (pair.value.expiresAt <= now) throw uploadError('PAIR_EXPIRED', 410);
    const secret = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const next = { ...pair.value, status: 'pending', sessionId: null, sessionExpiresAt: 0,
        launchHash: await digest(secret), launchExpiresAt: Math.min(now + LAUNCH_MS, pair.value.expiresAt), launchInspectedUserId: null };
    await replace(env, pairKey(connectionId), pair.raw, next);
    const query = new URLSearchParams({ connection_id: connectionId, parent_origin: pair.value.parentOrigin });
    return new Response(null, { status: 303, headers: {
        Location: `/charinfo-upload/connect?${query}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Set-Cookie': `${launchCookieName(connectionId)}=${secret}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((next.launchExpiresAt - now) / 1000)}`,
    } });
}

async function activeUser(env, id) {
    const user = await env.img_d1.prepare('SELECT discord_id, username, role, status, public_handle FROM users WHERE discord_id = ?').bind(id).first();
    if (!user || user.status !== 'active') throw uploadError('AUTH_REQUIRED', 401);
    return { id: user.discord_id, username: user.username, role: user.role, publicHandle: user.public_handle };
}

async function publicAccountId(env, id) {
    const key = `charinfo-upload:account:${id}`;
    await insert(env, key, { id: crypto.randomUUID() }, 'charinfo_upload_account');
    return (await row(env, key)).value.id;
}

async function granted(env, pair) {
    const found = pair.grantHash ? await row(env, grantKey(pair.grantHash)) : null;
    if (!found || found.value.revoked || found.value.expiresAt <= Date.now()
        || found.value.parentOrigin !== pair.parentOrigin || found.value.userId !== pair.userId) throw uploadError('AUTH_REQUIRED', 401);
    const identity = await activeUser(env, found.value.userId);
    return { ...found, identity };
}

async function connected(env, pair, proof) {
    const grant = await granted(env, pair);
    if (!pair.sessionId || pair.sessionExpiresAt <= Date.now()) throw uploadError('AUTH_REQUIRED', 401);
    const result = { connected: true, sessionId: pair.sessionId, accountId: grant.value.accountId,
        accountName: String(grant.identity.username || '').slice(0, 100), expiresAt: pair.sessionExpiresAt, grantExpiresAt: grant.value.expiresAt };
    if (pair.resumeSalt) result.resumeProof = await digest(`charinfo-upload-resume-v1:${pair.resumeVersion === 2 ? pair.proofHash : proof}:${pair.userId}:${pair.resumeSalt}`);
    return result;
}

export async function registerUploadPair(context, body) {
    checkUploadOrigin(context.request);
    if (Object.keys(body).sort().join(',') !== 'connectionId,parentOrigin,proof') throw uploadError('INPUT_REJECTED');
    checkConnection(body.connectionId);
    if (!validParentOrigin(body.parentOrigin) || typeof body.proof !== 'string' || !PROOF.test(body.proof)) throw uploadError('BAD_REQUEST');
    const now = Date.now();
    const value = { connectionId: body.connectionId, parentOrigin: body.parentOrigin, proofHash: await digest(body.proof),
        createdAt: now, expiresAt: now + SESSION_MS, status: 'pending' };
    await insert(context.env, pairKey(body.connectionId), value, 'charinfo_upload_pair');
    let found = await row(context.env, pairKey(body.connectionId));
    if (!sameDigest(found.value.proofHash, value.proofHash) || found.value.parentOrigin !== body.parentOrigin) throw uploadError('PAIR_CONFLICT', 409);
    if (found.value.expiresAt <= now) {
        await replace(context.env, pairKey(body.connectionId), found.raw, value);
        found = { value };
    }
    return { expiresAt: found.value.expiresAt };
}

export async function authorizeUploadRequest(context, connectionId, sessionId) {
    checkUploadOrigin(context.request);
    if (!ID.test(sessionId || '')) throw uploadError('AUTH_REQUIRED', 401);
    const pair = await paired(context, connectionId);
    if (pair.value.status !== 'approved' || pair.value.sessionId !== sessionId || pair.value.sessionExpiresAt <= Date.now()) throw uploadError('AUTH_REQUIRED', 401);
    return { ...(await granted(context.env, pair.value)).identity,
        _uploadAuthorization: { connectionId, sessionId, grantHash: pair.value.grantHash } };
}

export function uploadAuthorizationGuard(identity) {
    const auth = identity?._uploadAuthorization;
    if (!auth || typeof auth.connectionId !== 'string' || !CONNECTION.test(auth.connectionId)
        || typeof auth.sessionId !== 'string' || !ID.test(auth.sessionId)
        || typeof auth.grantHash !== 'string' || !PROOF.test(auth.grantHash)) throw uploadError('AUTH_REQUIRED', 401);
    return {
        sql: `EXISTS (SELECT 1 FROM other_data upload_pair, other_data upload_grant
            WHERE upload_pair.key = ? AND json_extract(upload_pair.value, '$.sessionId') = ?
            AND json_extract(upload_pair.value, '$.sessionExpiresAt') > ?
            AND json_extract(upload_pair.value, '$.sessionExpiresAt') > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
            AND json_extract(upload_pair.value, '$.status') = 'approved'
            AND upload_grant.key = ? AND upload_grant.key = 'charinfo-upload:grant:' || json_extract(upload_pair.value, '$.grantHash')
            AND json_extract(upload_grant.value, '$.userId') = ?
            AND json_extract(upload_pair.value, '$.userId') = json_extract(upload_grant.value, '$.userId')
            AND json_extract(upload_pair.value, '$.parentOrigin') = json_extract(upload_grant.value, '$.parentOrigin')
            AND COALESCE(json_extract(upload_grant.value, '$.revoked'), 1) = 0
            AND json_extract(upload_grant.value, '$.expiresAt') > ?
            AND json_extract(upload_grant.value, '$.expiresAt') > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))`,
        bindings: [pairKey(auth.connectionId), auth.sessionId, Date.now(), grantKey(auth.grantHash), identity.id, Date.now()],
    };
}

export async function uploadAuthAction(context, body) {
    checkUploadOrigin(context.request);
    const fields = {
        inspect: ['action', 'connectionId'], approve: ['action', 'connectionId', 'accountId'], deny: ['action', 'connectionId'],
        status: ['action', 'connectionId', 'sessionId'], resume: ['action', 'connectionId', 'resumeProof'],
        renew: ['action', 'connectionId', 'sessionId'], disconnect: ['action', 'connectionId', 'sessionId'],
    }[body.action];
    if (!fields || Object.keys(body).some(key => !fields.includes(key))) throw uploadError('INPUT_REJECTED');
    const { env, request } = context;
    const consent = ['inspect', 'approve', 'deny'].includes(body.action);
    const pair = await (consent ? launched(context, body.connectionId) : paired(context, body.connectionId));
    const key = pairKey(body.connectionId);
    const now = Date.now();
    if (body.action === 'deny') {
        const next = { ...pair.value, status: 'denied', sessionId: null, sessionExpiresAt: 0,
            launchHash: null, launchExpiresAt: 0, launchInspectedUserId: null };
        const statements = [env.img_d1.prepare('UPDATE other_data SET value = CASE WHEN value = ? THEN ? ELSE NULL END WHERE key = ?')
            .bind(pair.raw, JSON.stringify(next), key)];
        if (pair.value.grantHash) statements.push(env.img_d1.prepare("UPDATE other_data SET value = json_set(value, '$.revoked', json('true')) WHERE key = ?").bind(grantKey(pair.value.grantHash)));
        try { await env.img_d1.batch(statements); } catch { throw uploadError('AUTH_CONFLICT', 409); }
        return { connected: false };
    }
    if (consent) {
        const identity = await getDiscordIdentity(env, request);
        if (!identity) throw uploadError('SIGN_IN_REQUIRED', 401);
        await activeUser(env, identity.id);
        if (pair.value.expiresAt <= now) throw uploadError('PAIR_EXPIRED', 410);
        const accountId = await publicAccountId(env, identity.id);
        if (body.action === 'inspect') {
            await replace(env, key, pair.raw, { ...pair.value, launchInspectedUserId: identity.id });
            return { parentOrigin: pair.value.parentOrigin, accountId,
                accountName: String(identity.username || '').slice(0, 100), approved: false };
        }
        if (!pair.value.launchInspectedUserId) throw uploadError('CONSENT_REQUIRED', 403);
        if (pair.value.launchInspectedUserId !== identity.id || body.accountId !== accountId) throw uploadError('ACCOUNT_CHANGED', 409);
        const resumeSalt = crypto.randomUUID();
        const resumeProof = await digest(`charinfo-upload-resume-v1:${pair.value.proofHash}:${identity.id}:${resumeSalt}`);
        const grantHash = await digest(resumeProof);
        const grant = { parentOrigin: pair.value.parentOrigin, userId: identity.id, accountId, approvedAt: now, expiresAt: now + GRANT_MS, revoked: false };
        const next = { ...pair.value, userId: identity.id, grantHash, resumeSalt, resumeVersion: 2, status: 'approved',
            launchHash: null, launchExpiresAt: 0, launchInspectedUserId: null,
            expiresAt: grant.expiresAt, sessionId: crypto.randomUUID(), sessionExpiresAt: now + SESSION_MS };
        const statements = [env.img_d1.prepare(`INSERT INTO other_data (key, value, type)
            VALUES (?, CASE WHEN EXISTS (SELECT 1 FROM other_data WHERE key = ? AND value = ?) THEN ? ELSE NULL END, 'charinfo_upload_grant')`)
            .bind(grantKey(grantHash), key, pair.raw, JSON.stringify(grant))];
        if (pair.value.grantHash) statements.push(env.img_d1.prepare("UPDATE other_data SET value = json_set(value, '$.revoked', json('true')) WHERE key = ?").bind(grantKey(pair.value.grantHash)));
        statements.push(env.img_d1.prepare('UPDATE other_data SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND value = ?')
            .bind(JSON.stringify(next), key, pair.raw));
        try { await env.img_d1.batch(statements); } catch { throw uploadError('AUTH_CONFLICT', 409); }
        return { approved: true, parentOrigin: next.parentOrigin, grantExpiresAt: grant.expiresAt };
    }
    if (body.action === 'resume') {
        if (typeof body.resumeProof !== 'string' || !PROOF.test(body.resumeProof)) throw uploadError('AUTH_REQUIRED', 401);
        const grantHash = await digest(body.resumeProof);
        const grantRow = await row(env, grantKey(grantHash));
        if (!grantRow || grantRow.value.revoked || grantRow.value.expiresAt <= now
            || grantRow.value.parentOrigin !== pair.value.parentOrigin) throw uploadError('AUTH_REQUIRED', 401);
        await activeUser(env, grantRow.value.userId);
        const next = { ...pair.value, status: 'approved', userId: grantRow.value.userId, grantHash, resumeSalt: null,
            expiresAt: grantRow.value.expiresAt, sessionId: crypto.randomUUID(), sessionExpiresAt: Math.min(now + SESSION_MS, grantRow.value.expiresAt) };
        await replace(env, key, pair.raw, next);
        return connected(env, next, pair.proof);
    }
    if (body.action === 'renew') {
        const grant = await granted(env, pair.value);
        if (pair.value.status !== 'approved' || !body.sessionId || body.sessionId !== pair.value.sessionId) throw uploadError('AUTH_REQUIRED', 401);
        const next = { ...pair.value, sessionId: crypto.randomUUID(), sessionExpiresAt: Math.min(now + SESSION_MS, grant.value.expiresAt) };
        await replace(env, key, pair.raw, next);
        return connected(env, next, pair.proof);
    }
    if (body.action === 'disconnect') {
        if (body.sessionId && body.sessionId !== pair.value.sessionId) throw uploadError('AUTH_REQUIRED', 401);
        const next = { ...pair.value, status: 'revoked', sessionId: null, sessionExpiresAt: 0,
            launchHash: null, launchExpiresAt: 0, launchInspectedUserId: null };
        const statements = [env.img_d1.prepare(`UPDATE other_data SET value = CASE WHEN value = ? THEN ? ELSE NULL END WHERE key = ?`)
            .bind(pair.raw, JSON.stringify(next), key)];
        if (pair.value.grantHash) statements.push(env.img_d1.prepare("UPDATE other_data SET value = json_set(value, '$.revoked', json('true')) WHERE key = ?").bind(grantKey(pair.value.grantHash)));
        try { await env.img_d1.batch(statements); } catch { throw uploadError('AUTH_CONFLICT', 409); }
        return { connected: false };
    }
    if (body.action === 'status') {
        if (pair.value.status === 'denied') throw uploadError('AUTH_DENIED', 403);
        try { return await connected(env, pair.value, pair.proof); }
        catch (error) { if (error.code === 'AUTH_REQUIRED') return { connected: false }; throw error; }
    }
    throw uploadError('INPUT_REJECTED');
}
