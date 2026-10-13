import assert from 'assert';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('repository deployment configuration', () => {
    it('uses the Worker adapter for local development without Docker workspaces', () => {
        const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));

        assert.match(packageJson.scripts.start, /wrangler dev --config deploy\/worker\/wrangler\.local\.toml/);
        assert.ok(!packageJson.scripts['start:docker']);
        assert.ok(!packageJson.workspaces);
        assert.ok(!packageJson.dependencies['@aws-sdk/client-s3']);
        for (const path of ['Dockerfile', 'docker-compose.yml', '.dockerignore', 'deploy/server']) {
            assert.ok(!existsSync(join(repositoryRoot, path)), `${path} must not remain in the Workers-only repository`);
        }
    });

    it('deploys production with its own domain and Discord OAuth secret', () => {
        const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'deploy-worker.yml'), 'utf8');
        assert.match(workflow, /WORKER_CUSTOM_DOMAIN: \$\{\{ vars\.WORKER_CUSTOM_DOMAIN/);
        assert.match(workflow, /name: Sync production Discord OAuth secret/);
        assert.match(workflow, /name: Smoke test production Worker/);
        assert.match(workflow, /name: Run automated tests\s+run: npm test/);
        assert.ok(workflow.indexOf('name: Run automated tests') < workflow.indexOf('name: Generate worker routes'));
    });

    it('keeps user-facing repository links on this repository', () => {
        const frontendFiles = collectFiles(join(repositoryRoot, 'frontend-dist'))
            .filter((path) => /\.(?:html|js|map)$/.test(path));
        const files = [
            join(repositoryRoot, 'README.md'),
            join(repositoryRoot, 'README_zh.md'),
            join(repositoryRoot, '.github', 'ISSUE_TEMPLATE', 'config.yml'),
            join(repositoryRoot, 'functions', 'api', 'manage', 'sysConfig', 'page.js'),
            ...frontendFiles,
        ];
        const content = files.map((path) => readFileSync(path, 'utf8')).join('\n');

        assert.match(content, /github\.com\/uikawinwing\/CloudFlare-ImgBed/);
    });
});

function collectFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? collectFiles(path) : [path];
    });
}
