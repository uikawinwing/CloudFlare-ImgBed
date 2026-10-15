import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const packageRoot = join(root, 'node_modules/mediabunny');
const destination = join(root, 'frontend-dist/account/vendor/mediabunny.mjs');

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(join(packageRoot, 'dist/bundles/mediabunny.min.mjs'), destination);
copyFileSync(join(packageRoot, 'LICENSE'), join(dirname(destination), 'mediabunny.LICENSE'));
