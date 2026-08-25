import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, 'wrangler.staging.toml');
const env = process.env;

const databaseId = env.STAGING_D1_DATABASE_ID?.trim();
if (!databaseId) {
    console.error('Missing STAGING_D1_DATABASE_ID. Refusing to start staging with an implicit/fallback database.');
    process.exit(1);
}

const workerName = env.STAGING_WORKER_NAME?.trim() || 'cloudflare-imgbed-staging';
const databaseName = env.STAGING_D1_DATABASE_NAME?.trim() || 'imgbed_staging_d1';
const customDomain = normalizeCustomDomain(env.STAGING_WORKER_CUSTOM_DOMAIN);

let toml = `name = "${workerName}"
main = "index.js"
compatibility_date = "2026-08-25"
compatibility_flags = ["global_fetch_strictly_public"]
workers_dev = true

[assets]
directory = "../../frontend-dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api", "/api/*", "/dav", "/dav/*", "/file", "/file/*", "/gallery", "/gallery/*", "/my-albums", "/my-files", "/random", "/random/*", "/thumb", "/thumb/*", "/upload", "/upload/*"]

[images]
binding = "IMAGES"

[[d1_databases]]
binding = "img_d1"
database_name = "${databaseName}"
database_id = "${databaseId}"
remote = true
`;

if (env.STAGING_KV_NAMESPACE_ID?.trim()) {
    toml += `
[[kv_namespaces]]
binding = "img_url"
id = "${env.STAGING_KV_NAMESPACE_ID.trim()}"
remote = true
`;
}

if (env.STAGING_R2_BUCKET_NAME?.trim()) {
    toml += `
[[r2_buckets]]
binding = "img_r2"
bucket_name = "${env.STAGING_R2_BUCKET_NAME.trim()}"
remote = true
`;
}

const workerVars = {};
if (env.STAGING_WORKER_VARS) {
    try {
        Object.assign(workerVars, JSON.parse(env.STAGING_WORKER_VARS));
    } catch (error) {
        console.error('STAGING_WORKER_VARS must be valid JSON:', error.message);
        process.exit(1);
    }
}

if (env.STAGING_DISCORD_CLIENT_ID?.trim()) {
    workerVars.DISCORD_CLIENT_ID = env.STAGING_DISCORD_CLIENT_ID.trim();
}
if (env.STAGING_DISCORD_CALLBACK_URL?.trim()) {
    workerVars.DISCORD_CALLBACK_URL = env.STAGING_DISCORD_CALLBACK_URL.trim();
}

const workerVarEntries = Object.entries(workerVars);
if (workerVarEntries.length > 0) {
    toml += '\n[vars]\n';
    for (const [key, value] of workerVarEntries) {
        toml += `${key} = "${escapeTomlString(value)}"\n`;
    }
}

if (customDomain) {
    toml += `
[[routes]]
pattern = "${customDomain}"
custom_domain = true
`;
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, toml, 'utf8');

console.log(`Generated ${outputPath}`);
console.log(`Staging D1: ${databaseName} (${databaseId.slice(0, 8)}...)`);
console.log('D1 remote binding is enabled; production D1 variables are never read by this script.');
console.log(`Staging URL target: ${customDomain ? `https://${customDomain}` : `${workerName}.<account-subdomain>.workers.dev`}`);

function normalizeCustomDomain(value) {
    const hostname = String(value || '').trim().toLowerCase();
    if (!hostname) return '';
    if (!/^(?=.{1,253}$)(?![.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
        console.error('STAGING_WORKER_CUSTOM_DOMAIN must be a bare DNS hostname.');
        process.exit(1);
    }
    return hostname;
}

function escapeTomlString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
