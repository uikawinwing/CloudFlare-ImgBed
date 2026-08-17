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

let toml = `name = "${workerName}"
main = "index.js"
compatibility_date = "2024-08-21"
compatibility_flags = ["global_fetch_strictly_public"]

[assets]
directory = "../../frontend-dist"
binding = "ASSETS"
not_found_handling = "single-page-application"

[images]
binding = "IMAGES"

[[d1_databases]]
binding = "img_d1"
database_name = "${databaseName}"
database_id = "${databaseId}"
remote = true
`;

// Keep non-D1 state local by default so staging development can never
// accidentally mutate production KV or R2. Set explicit STAGING_* values
// only when a separate remote staging resource is intentionally available.
if (env.STAGING_KV_NAMESPACE_ID?.trim()) {
    toml += `
[[kv_namespaces]]
binding = "img_url"
id = "${env.STAGING_KV_NAMESPACE_ID.trim()}"
remote = true
`;
} else {
    toml += `
[[kv_namespaces]]
binding = "img_url"
id = "staging-local-kv"
`;
}

if (env.STAGING_R2_BUCKET_NAME?.trim()) {
    toml += `
[[r2_buckets]]
binding = "img_r2"
bucket_name = "${env.STAGING_R2_BUCKET_NAME.trim()}"
remote = true
`;
} else {
    toml += `
[[r2_buckets]]
binding = "img_r2"
bucket_name = "cloudflare-imgbed-staging-local"
`;
}

if (env.STAGING_WORKER_VARS) {
    try {
        const vars = JSON.parse(env.STAGING_WORKER_VARS);
        const entries = Object.entries(vars);
        if (entries.length > 0) {
            toml += '\n[vars]\n';
            for (const [key, value] of entries) {
                toml += `${key} = "${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;
            }
        }
    } catch (error) {
        console.error('STAGING_WORKER_VARS must be valid JSON:', error.message);
        process.exit(1);
    }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, toml, 'utf8');

console.log(`Generated ${outputPath}`);
console.log(`Staging D1: ${databaseName} (${databaseId.slice(0, 8)}...)`);
console.log('D1 remote binding is enabled; production D1 variables are never read by this script.');
