import assert from 'node:assert/strict';
import { onRequest as securitySettings } from '../functions/api/manage/sysConfig/security.js';
import { onRequestPost as adminLogin } from '../functions/api/auth/adminLogin.js';
import { onRequestPost as userLogin } from '../functions/api/auth/login.js';
import { onRequestGet as sessionCheck } from '../functions/api/auth/sessionCheck.js';
import { authenticate, AUTH_SCOPE } from '../functions/utils/auth/authCore.js';
import { createSession } from '../functions/utils/auth/sessionManager.js';
import { createDiscordSession } from '../functions/utils/auth/discordIdentity.js';

const securityKey = 'manage@sysConfig@security';

function environment(settings = {}, discord = true) {
    const values = new Map([[securityKey, JSON.stringify(settings)]]);
    let writes = 0;
    const img_url = {
        get: async key => values.get(key) ?? null,
        put: async (key, value) => { writes += 1; values.set(key, value); },
    };
    return { values, get writes() { return writes; }, env: { img_url, ...(discord ? { DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-secret' } : {}) } };
}

function request(body, method = 'PATCH', headers = {}) {
    return new Request('https://example.test/api/manage/sysConfig/security', {
        method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
}

function authenticateRequest(env, cookie, authScope, headers = {}) {
    const request = new Request('https://example.test/api/manage/list', { headers: { ...(cookie ? { Cookie: cookie.split(';')[0] } : {}), ...headers } });
    return authenticate({ env, request, url: new URL(request.url), authScope, requiredPermission: 'list' });
}

describe('Discord-only login boundary', () => {
    it('refuses both legacy login endpoints before they can create sessions', async () => {
        for (const login of [adminLogin, userLogin]) {
            for (const settings of [{}, { auth: { user: { authCode: 'old-password' }, admin: { adminUsername: 'admin', adminPassword: 'old-password' } } }]) {
                const fixture = environment(settings);
                const response = await login({ env: fixture.env, request: request({ username: 'admin', password: 'old-password', authCode: 'old-password' }, 'POST') });
                assert.equal(response.status, 403);
                assert.equal(response.headers.get('Set-Cookie'), null);
                assert.equal(fixture.writes, 0);
            }
        }
    });

    it('refuses pre-existing legacy sessions and anonymous fallthrough in every scope', async () => {
        const { env } = environment();
        const admin = await createSession(env, 'admin');
        const user = await createSession(env, 'user');
        for (const cookie of [admin.cookie, user.cookie, null]) {
            for (const scope of Object.values(AUTH_SCOPE)) {
                assert.equal((await authenticateRequest(env, cookie, scope)).authorized, false, `${scope}: ${cookie ? 'legacy session' : 'anonymous'}`);
            }
        }
    });

    it('keeps the browser session guard consistent with Discord-only authentication', async () => {
        const { env } = environment();
        const admin = await createSession(env, 'admin');
        const user = await createSession(env, 'user');
        for (const cookie of [admin.cookie, user.cookie, null]) {
            const request = new Request('https://example.test/api/auth/sessionCheck', { headers: cookie ? { Cookie: cookie.split(';')[0] } : {} });
            const response = await sessionCheck({ env, request });
            assert.deepEqual(await response.json(), { valid: false, adminRequired: true, userRequired: true });
        }
        for (const role of ['admin', 'member']) {
            const { cookie } = await createDiscordSession(env, { id: 'test-user', role });
            const request = new Request('https://example.test/api/auth/sessionCheck', { headers: { Cookie: cookie.split(';')[0] } });
            const response = await sessionCheck({ env, request });
            assert.deepEqual(await response.json(), { valid: true, authType: role === 'admin' ? 'admin' : 'user', adminRequired: true, userRequired: true });
        }
    });

    it('preserves Discord role checks and normal member access', async () => {
        const { env } = environment();
        for (const role of ['owner', 'admin', 'member']) {
            const { cookie } = await createDiscordSession(env, { id: 'test-user', role });
            const admin = await authenticateRequest(env, cookie, AUTH_SCOPE.ADMIN);
            assert.equal(admin.authorized, role !== 'member');
            assert.equal((await authenticateRequest(env, cookie, AUTH_SCOPE.USER)).authorized, true);
            assert.equal((await authenticateRequest(env, cookie, AUTH_SCOPE.EITHER)).authorized, true);
        }
    });

    it('preserves explicit API Token permissions in Discord mode', async () => {
        const { env } = environment({ apiTokens: { tokens: { script: { token: 'test-token', permissions: ['list'] } } } });
        assert.equal((await authenticateRequest(env, null, AUTH_SCOPE.ADMIN, { Authorization: 'Bearer test-token' })).authorized, true);
        const request = new Request('https://example.test/api/manage/delete', { headers: { Authorization: 'Bearer test-token' } });
        assert.equal((await authenticate({ env, request, authScope: AUTH_SCOPE.ADMIN, requiredPermission: 'delete' })).authorized, false);
    });

    it('retains legacy login and session behavior when Discord is not configured', async () => {
        const { env } = environment({}, false);
        for (const [login, scope] of [[adminLogin, AUTH_SCOPE.ADMIN], [userLogin, AUTH_SCOPE.USER]]) {
            const response = await login({ env, request: request({}, 'POST') });
            assert.equal(response.status, 200);
            assert.ok(response.headers.get('Set-Cookie'));
            assert.equal((await authenticateRequest(env, response.headers.get('Set-Cookie'), scope)).authorized, true);
            const check = await sessionCheck({ env, request: new Request('https://example.test/api/auth/sessionCheck', { headers: { Cookie: response.headers.get('Set-Cookie').split(';')[0] } }) });
            assert.equal((await check.json()).valid, true);
        }
    });

    it('continues to check configured legacy passwords outside Discord mode', async () => {
        const { env } = environment({ auth: { user: { authCode: 'user-password' }, admin: { adminUsername: 'administrator', adminPassword: 'admin-password' } } }, false);
        for (const [login, good, bad] of [
            [adminLogin, { username: 'administrator', password: 'admin-password' }, { username: 'administrator', password: 'wrong' }],
            [userLogin, { authCode: 'user-password' }, { authCode: 'wrong' }],
        ]) {
            assert.equal((await login({ env, request: request(bad, 'POST') })).status, 401);
            const response = await login({ env, request: request(good, 'POST') });
            assert.equal(response.status, 200);
            assert.ok(response.headers.get('Set-Cookie'));
        }
    });
});

describe('native security settings contract', () => {
    function initialSettings() {
        return {
            auth: { user: { authCode: 'old-user-secret' }, admin: { adminUsername: 'old-admin', adminPassword: 'old-admin-secret' } },
            apiTokens: { tokens: { automation: { token: 'retained-token', permissions: ['manage'] } } },
            upload: {
                moderate: { enabled: false, channel: 'nsfwjs', nsfwApiPath: 'https://moderation.example/api', extra: 'retain' },
                ipQuery: { enabled: true, channel: 'customApi', customApi: { url: 'https://geo.example/api', params: [{ key: 'ip', value: '{ip}' }], responseFields: ['country'], extra: 'retain' } },
                extra: 'retain',
            },
            access: { sessionSecure: true, userSessionMaxAge: 7, adminSessionMaxAge: 3, allowedDomains: 'example.test', extra: 'retain' },
            extra: { retained: true },
        };
    }

    it('projects only modern settings and excludes old credentials, tokens and old session policy', async () => {
        const { env } = environment(initialSettings());
        const response = await securitySettings({ env, request: new Request('https://example.test/api/manage/sysConfig/security?view=modern') });
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ['access', 'upload']);
        assert.deepEqual(Object.keys(body.access).sort(), ['allowedDomains', 'imageTransformAllowedSizes', 'imageTransformEnabled', 'whiteListMode']);
        const text = JSON.stringify(body);
        for (const secret of ['old-user-secret', 'old-admin-secret', 'retained-token']) assert.ok(!text.includes(secret));
        assert.equal(body.upload.moderate.nsfwApiPath, 'https://moderation.example/api');
        assert.match(response.headers.get('Cache-Control'), /no-store/);
    });

    it('only changes submitted fields, preserves raw configuration and does not revoke Discord sessions', async () => {
        const original = initialSettings();
        const fixture = environment(original);
        const { cookie } = await createDiscordSession(fixture.env, { id: 'test-admin', role: 'admin' });
        const response = await securitySettings({ env: fixture.env, request: request({ securityValues: { 'upload.moderate.enabled': true, 'access.imageTransformAllowedSizes': '100X200, autoX400,100x200' } }) });
        assert.equal(response.status, 200);
        const saved = JSON.parse(fixture.values.get(securityKey));
        const expected = structuredClone(original);
        expected.upload.moderate.enabled = true;
        expected.access.imageTransformAllowedSizes = '100x200,autox400';
        assert.deepEqual(saved, expected);
        assert.equal((await authenticateRequest(fixture.env, cookie, AUTH_SCOPE.ADMIN)).authorized, true);
        const body = await response.json();
        assert.equal(body.auth, undefined);
        assert.equal(body.apiTokens, undefined);
        assert.equal(body.upload.ipQuery.customApi.url, original.upload.ipQuery.customApi.url);
    });

    it('accepts valid provider and IP mapping changes without overwriting unrelated IP fields', async () => {
        const fixture = environment(initialSettings());
        const changes = {
            'upload.moderate.channel': 'moderatecontent.com', 'upload.moderate.moderateContentApiKey': 'new-key',
            'upload.ipQuery.customApi.params': [{ key: 'address', value: '{ip}' }],
            'upload.ipQuery.customApi.responseFields': ['location.country', 'location.city'],
            'upload.ipQuery.customApi.url': 'https://geo.example/query',
        };
        const response = await securitySettings({ env: fixture.env, request: request({ securityValues: changes }) });
        assert.equal(response.status, 200);
        const saved = JSON.parse(fixture.values.get(securityKey));
        assert.equal(saved.upload.ipQuery.enabled, true);
        assert.deepEqual(saved.upload.ipQuery.customApi.params, changes['upload.ipQuery.customApi.params']);
        assert.equal(saved.upload.ipQuery.customApi.extra, 'retain');
    });

    it('preserves explicitly empty IP parameters while retaining the default for missing parameters', async () => {
        const fixture = environment(initialSettings());
        const response = await securitySettings({ env: fixture.env, request: request({ securityValues: { 'upload.ipQuery.customApi.params': [] } }) });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).upload.ipQuery.customApi.params, []);
        const reloaded = await securitySettings({ env: fixture.env, request: new Request('https://example.test/api/manage/sysConfig/security?view=modern') });
        assert.deepEqual((await reloaded.json()).upload.ipQuery.customApi.params, []);
        const missing = environment({});
        const defaults = await securitySettings({ env: missing.env, request: new Request('https://example.test/api/manage/sysConfig/security?view=modern') });
        assert.deepEqual((await defaults.json()).upload.ipQuery.customApi.params, [{ key: 'ip', value: '{ip}' }]);
    });

    it('rejects unknown, auth, token, prototype, malformed and invalid values without persisting', async () => {
        const fixture = environment(initialSettings());
        const invalidBodies = [null, [], {}, { securityValues: [] }, { securityValues: {} }, { securityValues: { 'access.sessionSecure': false } },
            { securityValues: { 'auth.admin.adminPassword': '' } }, { securityValues: { 'apiTokens.tokens': {} } },
            JSON.parse('{"securityValues":{"__proto__":{}}}'),
            { securityValues: { 'upload.moderate.enabled': 'true' } }, { securityValues: { 'upload.moderate.channel': 'unknown' } },
            { securityValues: { 'upload.ipQuery.channel': 'unknown' } },
            { securityValues: { 'upload.moderate.nsfwApiPath': 'javascript:alert(1)' } },
            { securityValues: { 'upload.ipQuery.customApi.url': 'https://user:pass@geo.example/api' } },
            { securityValues: { 'upload.ipQuery.customApi.params': [{ key: 'ip', value: 1 }] } },
            { securityValues: { 'upload.ipQuery.customApi.responseFields': [''] } },
            { securityValues: { 'access.imageTransformAllowedSizes': '5000x200' } },
            { securityValues: { 'access.allowedDomains': ['example.test'] } },
            { securityValues: { 'access.whiteListMode': true, 'auth.user.authCode': '' } },
            { securityValues: { 'access.whiteListMode': true }, auth: {} },
        ];
        for (const body of invalidBodies) {
            const response = await securitySettings({ env: fixture.env, request: request(body) });
            assert.equal(response.status, 400, JSON.stringify(body));
        }
        assert.equal(fixture.writes, 0);
        assert.deepEqual(JSON.parse(fixture.values.get(securityKey)), initialSettings());
    });

    it('rejects cross-site PATCH writes before persisting', async () => {
        const fixture = environment(initialSettings());
        const response = await securitySettings({ env: fixture.env, request: request({ securityValues: { 'access.whiteListMode': true } }, 'PATCH', { Origin: 'https://unrelated.example' }) });
        assert.equal(response.status, 403);
        assert.equal(fixture.writes, 0);
    });
});
