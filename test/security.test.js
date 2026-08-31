import assert from 'assert';
import { getOthersConfig } from '../functions/api/manage/sysConfig/others.js';
import { onRequest as manageMiddlewares } from '../functions/api/manage/_middleware.js';
import { telemetryData } from '../functions/utils/middleware.js';
import { isUnsafeIpAddress } from '../functions/utils/ssrf.js';
import { createPinnedLookup, resolvePublicAddresses } from '../deploy/server/safeOutboundFetch.js';

function createKv(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        async get(key) { return values.get(key) ?? null; },
        async put(key, value) { values.set(key, value); },
        async delete(key) { values.delete(key); },
        async getWithMetadata(key) { return { value: values.get(key) ?? null, metadata: null }; },
        async list() { return { keys: [], list_complete: true }; },
    };
}

function securityConfig(overrides = {}) {
    return JSON.stringify({
        auth: {
            user: { authCode: '' },
            admin: { adminUsername: '', adminPassword: '' },
        },
        apiTokens: { tokens: {} },
        ...overrides,
    });
}

async function runManageAuthentication(env, headers = {}) {
    const authentication = manageMiddlewares[1];
    return authentication({
        env,
        request: new Request('https://example.test/api/manage/sysConfig/others', { headers }),
        next: async () => new Response(null, { status: 204 }),
    });
}

describe('Security hardening', () => {
    describe('telemetry privacy', () => {
        it('keeps telemetry disabled until explicitly enabled', async () => {
            const defaults = await getOthersConfig(createKv(), {});
            assert.strictEqual(defaults.telemetry.enabled, false);

            const enabled = await getOthersConfig(createKv({
                'manage@sysConfig@others': JSON.stringify({ telemetry: { enabled: true } }),
            }), {});
            assert.strictEqual(enabled.telemetry.enabled, true);
        });

        it('records only allowlisted request metadata', async () => {
            const tags = {};
            let requestContext;
            let transactionFinished = false;
            const request = new Request('https://example.test/upload?authCode=query-secret', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer header-secret',
                    Cookie: 'session=cookie-secret',
                    authCode: 'header-auth-code',
                    'X-Custom': 'custom-secret',
                },
            });
            Object.defineProperty(request, 'cf', {
                value: { colo: 'HKG', country: 'HK', city: 'sensitive-location' },
            });

            const response = await telemetryData({
                request,
                data: {
                    telemetry: true,
                    sentry: {
                        setTag(key, value) { tags[key] = value; },
                        setContext(_name, value) { requestContext = value; },
                        startTransaction() { return { finish() { transactionFinished = true; } }; },
                    },
                },
                next: async () => new Response('ok'),
            });

            assert.strictEqual(await response.text(), 'ok');
            assert.deepStrictEqual(tags, { path: '/upload', method: 'POST', colo: 'HKG', country: 'HK' });
            assert.deepStrictEqual(requestContext, {
                method: 'POST',
                pathname: '/upload',
                cf: { colo: 'HKG', country: 'HK' },
            });
            assert.strictEqual(transactionFinished, true);
            assert.ok(!JSON.stringify({ tags, requestContext }).includes('secret'));
        });
    });

    describe('administrator authentication', () => {
        it('returns 503 when no administrator authentication method is configured', async () => {
            const response = await runManageAuthentication({ img_url: createKv() });
            assert.strictEqual(response.status, 503);
            assert.match(await response.text(), /not configured/i);
        });

        it('allows a valid administrator session', async () => {
            const kv = createKv({
                'manage@session@admin-token': JSON.stringify({
                    authType: 'admin',
                    expiresAt: Date.now() + 60_000,
                }),
            });
            const response = await runManageAuthentication(
                { img_url: kv },
                { Cookie: 'admin_session=admin-token' },
            );
            assert.strictEqual(response.status, 204);
        });

        it('allows a valid Discord administrator or owner identity', async () => {
            for (const role of ['admin', 'owner']) {
                const kv = createKv({
                    'manage@session@discord-token': JSON.stringify({
                        authType: 'user',
                        identity: { id: `discord-${role}`, role },
                        expiresAt: Date.now() + 60_000,
                    }),
                });
                const response = await runManageAuthentication(
                    {
                        img_url: kv,
                        DISCORD_CLIENT_ID: 'configured',
                        DISCORD_CLIENT_SECRET: 'configured',
                    },
                    { Cookie: 'user_session=discord-token' },
                );
                assert.strictEqual(response.status, 204);
            }
        });

        it('allows a valid API token and keeps invalid credentials unauthorized', async () => {
            const kv = createKv({
                'manage@sysConfig@security': securityConfig({
                    apiTokens: {
                        tokens: {
                            tokenId: {
                                id: 'tokenId',
                                token: 'valid-token',
                                permissions: ['manage'],
                                expiresAt: null,
                            },
                        },
                    },
                }),
            });

            const allowed = await runManageAuthentication(
                { img_url: kv },
                { Authorization: 'Bearer valid-token' },
            );
            assert.strictEqual(allowed.status, 204);

            const denied = await runManageAuthentication(
                { img_url: kv },
                { Authorization: 'Bearer invalid-token' },
            );
            assert.strictEqual(denied.status, 401);
        });
    });

    describe('Node outbound request validation', () => {
        it('rejects private, loopback, link-local, unspecified, and multicast addresses', () => {
            const unsafe = [
                '0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254',
                '172.17.0.1', '192.168.1.1', '224.0.0.1', '::', '::1',
                'fe90::1', 'fc00::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1',
            ];
            for (const address of unsafe) {
                assert.strictEqual(isUnsafeIpAddress(address), true, address);
            }
            assert.strictEqual(isUnsafeIpAddress('8.8.8.8'), false);
            assert.strictEqual(isUnsafeIpAddress('2606:4700:4700::1111'), false);
        });

        it('rejects a hostname if any DNS answer is unsafe', async () => {
            const resolver = async () => [
                { address: '93.184.216.34', family: 4 },
                { address: '127.0.0.1', family: 4 },
                { address: 'fd00::1', family: 6 },
            ];
            await assert.rejects(
                resolvePublicAddresses('attacker.example', resolver),
                error => error.code === 'ERR_UNSAFE_DESTINATION',
            );
        });

        it('pins both Node lookup callback forms to the validated address', () => {
            const selected = { address: '93.184.216.34', family: 4 };
            const lookup = createPinnedLookup(selected);

            lookup('attacker.example', {}, (error, address, family) => {
                assert.ifError(error);
                assert.strictEqual(address, selected.address);
                assert.strictEqual(family, selected.family);
            });
            lookup('attacker.example', { all: true }, (error, addresses) => {
                assert.ifError(error);
                assert.deepStrictEqual(addresses, [selected]);
            });
        });
    });
});
