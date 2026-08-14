import { fetchOthersConfig } from "./sysConfig";

let othersConfig = {};
let cfZoneId = "";
let cfEmail = "";
let cfApiKey = "";

export async function purgeCFCache(env, cdnUrl) {
    if (typeof caches !== 'undefined' && caches.default) {
        await caches.default.delete(cdnUrl);
    }

    othersConfig = await fetchOthersConfig(env);
    cfZoneId = othersConfig.cloudflareApiToken.CF_ZONE_ID;
    cfEmail = othersConfig.cloudflareApiToken.CF_EMAIL;
    cfApiKey = othersConfig.cloudflareApiToken.CF_API_KEY;

    if (!cfZoneId || !cfEmail || !cfApiKey) return;

    const options = {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Auth-Email': `${cfEmail}`, 'X-Auth-Key': `${cfApiKey}`},
        body: JSON.stringify({ files: [cdnUrl] }),
    };
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfZoneId}/purge_cache`, options);
    if (!response.ok) throw new Error(`Cloudflare cache purge failed (${response.status})`);
}

export async function purgeRandomFileListCache(origin, ...dirs) {
    try {
        const cache = caches.default;
        // cache.delete有bug，通过写入一个max-age=0的response来清除缓存
        const nullResponse = new Response(null, {
            headers: { 'Cache-Control': 'max-age=0' },
        });

        for (const dir of dirs) {
            await cache.put(`${origin}/api/randomFileList?dir=${dir}`, nullResponse);
        }
    } catch (error) {
        console.error('Failed to clear randomFileList cache:', error);
    }
}

export async function purgePublicFileListCache(origin, ...dirs) {
    try {
        const cache = caches.default;
        // cache.delete有bug，通过写入一个max-age=0的response来清除缓存
        const nullResponse = new Response(null, {
            headers: { 'Cache-Control': 'max-age=0' },
        });

        for (const dir of dirs) {
            // 清除递归和非递归两种缓存
            await cache.put(`${origin}/api/publicFileList?dir=${dir}&recursive=false`, nullResponse);
            await cache.put(`${origin}/api/publicFileList?dir=${dir}&recursive=true`, nullResponse);
        }
    } catch (error) {
        console.error('Failed to clear publicFileList cache:', error);
    }
}
