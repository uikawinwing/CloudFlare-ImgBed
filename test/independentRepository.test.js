import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('repository deployment configuration', () => {
    it('builds the repository Docker image locally', () => {
        const compose = readFileSync(join(repositoryRoot, 'docker-compose.yml'), 'utf8');
        assert.match(compose, /^\s+build: \.\s*$/m);
    });

    it('deploys production with its own domain and Discord OAuth secret', () => {
        const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'deploy-worker.yml'), 'utf8');
        assert.match(workflow, /WORKER_CUSTOM_DOMAIN: \$\{\{ vars\.WORKER_CUSTOM_DOMAIN/);
        assert.match(workflow, /name: Sync production Discord OAuth secret/);
        assert.match(workflow, /name: Smoke test production Worker/);
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
