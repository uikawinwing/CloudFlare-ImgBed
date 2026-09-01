import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('independent repository deployment configuration', () => {
    it('does not gate or synchronize workflows based on the former upstream fork', () => {
        const workflowDirectory = join(repositoryRoot, '.github', 'workflows');
        const workflows = readdirSync(workflowDirectory)
            .filter((name) => /\.ya?ml$/.test(name))
            .map((name) => readFileSync(join(workflowDirectory, name), 'utf8'))
            .join('\n');

        assert.doesNotMatch(workflows, /github\.event\.repository\.fork/);
        assert.doesNotMatch(workflows, /MarSeventh\/CloudFlare-ImgBed/i);
    });

    it('builds the repository Docker image locally', () => {
        const compose = readFileSync(join(repositoryRoot, 'docker-compose.yml'), 'utf8');
        assert.match(compose, /^\s+build: \.\s*$/m);
        assert.doesNotMatch(compose, /marseventh\/cloudflare-imgbed/i);
    });

    it('deploys production with its own domain and Discord OAuth secret', () => {
        const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'deploy-worker.yml'), 'utf8');
        assert.match(workflow, /WORKER_CUSTOM_DOMAIN: \$\{\{ vars\.WORKER_CUSTOM_DOMAIN/);
        assert.match(workflow, /name: Sync production Discord OAuth secret/);
        assert.match(workflow, /name: Smoke test production Worker/);
    });

    it('keeps user-facing repository links on the standalone repository', () => {
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

        assert.doesNotMatch(content, /github\.com\/MarSeventh\/CloudFlare-ImgBed/i);
        assert.doesNotMatch(content, /cfbed\.sanyue\.de/i);
        assert.match(content, /github\.com\/uikawinwing\/CloudFlare-ImgBed/);
    });
});

function collectFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? collectFiles(path) : [path];
    });
}
