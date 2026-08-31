/**
 * 远程资源代理读取 API
 * 负责在鉴权后拉取请求体中指定 URL 的资源并透传响应内容
 */
import { dualAuthCheck } from '../utils/auth/dualAuth.js';
import { getIpVersion, isUnsafeIpAddress } from '../utils/ssrf.js';

const IS_NODE_RUNTIME = typeof process !== 'undefined' && Boolean(process.versions?.node);
const HOP_BY_HOP_HEADERS = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
];

/**
 * Build response headers that are safe to send on a new proxy response.
 * @param {Headers} responseHeaders - headers returned by the upstream server
 * @returns {Headers}
 */
function createProxyHeaders(responseHeaders) {
    const headers = new Headers(responseHeaders);

    for (const name of HOP_BY_HOP_HEADERS) {
        headers.delete(name);
    }

    return headers;
}

function fetchTarget(url, env) {
    if (IS_NODE_RUNTIME) {
        if (typeof env.NODE_SAFE_OUTBOUND_FETCH !== 'function') {
            throw new Error('Node safe outbound fetch is not configured');
        }
        return env.NODE_SAFE_OUTBOUND_FETCH(url);
    }
    return fetch(url.toString(), { redirect: 'manual' });
}

/**
 * Determine whether a hostname refers to a private, loopback, link-local,
 * cloud-metadata, or otherwise internal network address. Used to prevent
 * SSRF against internal services from the proxy endpoint.
 *
 * @param {string} hostname - hostname or IP literal from a parsed URL
 * @returns {boolean}
 */
function isPrivateHostname(hostname) {
    if (!hostname) return true;
    let h = hostname.toLowerCase();
    // Strip IPv6 brackets
    if (h.startsWith('[') && h.endsWith(']')) {
        h = h.slice(1, -1);
    }

    // Obvious local names
    if (h === 'localhost' || h === 'ip6-localhost' || h === 'ip6-loopback') return true;
    if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

    // Cloud metadata service hostnames
    if (h === 'metadata.google.internal' || h === 'metadata.goog') return true;

    if (getIpVersion(h)) return isUnsafeIpAddress(h);
    if (h.includes(':') || /^[\d.]+$/.test(h)) return true;

    return false;
}

export async function onRequest(context) {
    // 获取请求体中URL的内容
    const {
        request,
        env,
        params,
        waitUntil,
        next,
        data
    } = context;

    // 双重鉴权检查
    const url = new URL(request.url);
    const { authorized } = await dualAuthCheck(env, url, request);
    if (!authorized) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const jsonRequest = await request.json();
    const targetUrl = jsonRequest.url;
    if (targetUrl === undefined) {
        return new Response('URL is required', { status: 400 })
    }

    // Validate the target URL to mitigate SSRF (CWE-918).
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Only allow http(s); block file:, gopher:, data:, ftp:, blob:, etc.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return new Response(JSON.stringify({ error: 'Only http(s) URLs are allowed' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Refuse embedded credentials (used to smuggle auth into internal targets).
    if (parsed.username || parsed.password) {
        return new Response(JSON.stringify({ error: 'Credentials in URL are not allowed' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Block private / loopback / link-local / metadata targets.
    if (isPrivateHostname(parsed.hostname)) {
        return new Response(JSON.stringify({ error: 'Access to internal addresses is not allowed' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Follow redirects manually so a permitted host cannot redirect us onto
    // an internal address without re-validation.
    let currentUrl = parsed;
    let response;
    try {
        response = await fetchTarget(currentUrl, env);
    } catch (error) {
        if (error?.code === 'ERR_UNSAFE_DESTINATION') {
            return new Response(JSON.stringify({ error: 'Access to internal addresses is not allowed' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        throw error;
    }
    let hops = 0;
    while (response.status >= 300 && response.status < 400 && response.headers.get('location') && hops < 5) {
        const next = new URL(response.headers.get('location'), currentUrl);
        if ((next.protocol !== 'http:' && next.protocol !== 'https:') ||
            next.username || next.password ||
            isPrivateHostname(next.hostname)) {
            return new Response(JSON.stringify({ error: 'Redirect to disallowed target' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        currentUrl = next;
        try {
            response = await fetchTarget(currentUrl, env);
        } catch (error) {
            if (error?.code === 'ERR_UNSAFE_DESTINATION') {
                return new Response(JSON.stringify({ error: 'Redirect to disallowed target' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            throw error;
        }
        hops++;
    }

    const headers = createProxyHeaders(response.headers);
    return new Response(response.body, {
        headers: headers,
        status: response.status
    })
}
