import { getDatabase } from '../../../utils/databaseAdapter.js';
import { rejectCrossSiteMutation } from '../../../utils/auth/mutationSecurity.js';
import { getUploadSettings, saveUploadSettings } from '../../../utils/storage/uploadSettings.js';

export async function onRequest(context) {
    const { request, env } = context;
    const db = getDatabase(env);

    if (request.method === 'GET') {
        const settings = await getUploadConfig(db, env, { exposeSecrets: false });
        return new Response(JSON.stringify(settings), { headers: { 'content-type': 'application/json' } });
    }

    if (request.method === 'POST') {
        const rejected = rejectCrossSiteMutation(request);
        if (rejected) return rejected;
        const body = await request.json();
        try {
            const settings = await saveUploadSettings(body, await readUploadConfig(db), env);
            await db.put('manage@sysConfig@upload', JSON.stringify(settings));
            return new Response(JSON.stringify(getUploadSettings(settings, env, { exposeSecrets: false })), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message, hint: error.hint }), {
                status: error.status || 400,
                headers: { 'content-type': 'application/json' },
            });
        }
    }

    return new Response('Method not allowed', { status: 405 });
}

export async function getUploadConfig(db, env, options = {}) {
    return getUploadSettings(await readUploadConfig(db), env, options);
}

async function readUploadConfig(db) {
    const settingsStr = await db.get('manage@sysConfig@upload');
    return settingsStr ? JSON.parse(settingsStr) : {};
}
