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
});
