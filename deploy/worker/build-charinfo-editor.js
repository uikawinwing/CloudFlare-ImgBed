import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const destination = join(root, 'frontend-dist/charinfo/profile-core.js');

mkdirSync(dirname(destination), { recursive: true });
buildSync({
    entryPoints: [join(root, 'frontend-src/charinfo/profile-core.js')],
    outfile: destination,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'eof',
    banner: { js: '/* CharInfo-Manager v0.3.4 core. See CharInfo-Manager.LICENSE and json5.LICENSE. */' },
});
copyFileSync(join(root, 'frontend-src/charinfo/upstream/LICENSE'), join(dirname(destination), 'CharInfo-Manager.LICENSE'));
copyFileSync(join(root, 'node_modules/json5/LICENSE.md'), join(dirname(destination), 'json5.LICENSE'));
