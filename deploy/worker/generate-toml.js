/**
 * 根据环境变量生成 deploy/worker/wrangler.toml
 * 用于 GitHub Actions 部署，从 Secrets/Variables 读取配置
 * 
 * 环境变量：
 *   WORKER_NAME      - Worker 名称（默认 cloudflare-imgbed）
 *   D1_DATABASE_ID   - D1 数据库 ID
 *   D1_DATABASE_NAME - D1 数据库名称（默认 img_d1）
 *   KV_NAMESPACE_ID  - KV 命名空间 ID
 *   R2_BUCKET_NAME   - R2 存储桶名称
 *   WORKER_VARS      - JSON 格式的业务环境变量
 *   WORKER_CUSTOM_DOMAIN - Worker 自定义域名
 *   DISCORD_CLIENT_ID    - Discord OAuth Client ID
 *   DISCORD_CALLBACK_URL - Discord OAuth 回调 URL
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, 'wrangler.toml');

const env = process.env;
const name = env.WORKER_NAME?.trim() || 'cloudflare-imgbed';
const databaseId = requiredEnv('D1_DATABASE_ID');
const databaseName = env.D1_DATABASE_NAME?.trim() || 'img_d1';
const kvNamespaceId = requiredEnv('KV_NAMESPACE_ID');
const r2BucketName = requiredEnv('R2_BUCKET_NAME');
const customDomain = normalizeCustomDomain(requiredEnv('WORKER_CUSTOM_DOMAIN'));

let toml = `name = "${name}"
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
`;

toml += `
[[d1_databases]]
binding = "img_d1"
database_name = "${databaseName}"
database_id = "${databaseId}"
remote = true
`;

toml += `
[[kv_namespaces]]
binding = "img_url"
id = "${kvNamespaceId}"
remote = true
`;

toml += `
[[r2_buckets]]
binding = "img_r2"
bucket_name = "${r2BucketName}"
remote = true
`;

const workerVars = {};
if (env.WORKER_VARS) {
    try {
        Object.assign(workerVars, JSON.parse(env.WORKER_VARS));
    } catch (e) {
        console.error('WORKER_VARS must be valid JSON:', e.message);
        process.exit(1);
    }
}

if (env.DISCORD_CLIENT_ID?.trim()) workerVars.DISCORD_CLIENT_ID = env.DISCORD_CLIENT_ID.trim();
if (env.DISCORD_CALLBACK_URL?.trim()) workerVars.DISCORD_CALLBACK_URL = env.DISCORD_CALLBACK_URL.trim();

const workerVarEntries = Object.entries(workerVars);
if (workerVarEntries.length > 0) {
    toml += '\n[vars]\n';
    for (const [key, value] of workerVarEntries) {
        toml += `${key} = "${escapeTomlString(value)}"\n`;
    }
}

toml += `
[[routes]]
pattern = "${customDomain}"
custom_domain = true
`;

writeFileSync(outputPath, toml, 'utf8');

// 打印配置（隐藏敏感值）
const safeToml = toml
    .replace(/database_id = ".*"/g, 'database_id = "***"')
    .replace(/(id = )".*"/g, '$1"***"')
    .replace(/(TOKEN.*= )".*"/gi, '$1"***"')
    .replace(/(KEY.*= )".*"/gi, '$1"***"')
    .replace(/(SECRET.*= )".*"/gi, '$1"***"');

console.log('Generated deploy/worker/wrangler.toml:');
console.log(safeToml);

function requiredEnv(name) {
    const value = env[name]?.trim();
    if (!value) {
        console.error(`Missing ${name}. Refusing to generate an incomplete production Worker configuration.`);
        process.exit(1);
    }
    return value;
}

function normalizeCustomDomain(value) {
    const hostname = value.toLowerCase();
    if (!/^(?=.{1,253}$)(?![.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
        console.error('WORKER_CUSTOM_DOMAIN must be a bare DNS hostname.');
        process.exit(1);
    }
    return hostname;
}

function escapeTomlString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
