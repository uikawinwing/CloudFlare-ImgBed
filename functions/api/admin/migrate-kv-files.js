import { D1Database } from '../../utils/d1Database.js';
import { DISCORD_OWNER_ID, getDiscordIdentity } from '../../utils/auth/discordIdentity.js';
import { writeAuditLog } from '../../utils/auditLog.js';

export async function onRequestPost({ request, env }) {
    const identity = await getDiscordIdentity(env, request);
    if (!identity || identity.id !== DISCORD_OWNER_ID) return json({ error: 'Owner access is required' }, 403);
    if (!env.img_url?.list || !env.img_d1?.prepare) return json({ error: 'Both KV and D1 are required' }, 503);
    const payload = await request.json().catch(() => ({}));
    const limit = Math.min(100, Math.max(1, Number(payload.limit) || 50));
    const options = { limit };
    if (payload.cursor) options.cursor = String(payload.cursor);
    const page = await env.img_url.list(options);
    const d1 = new D1Database(env.img_d1);
    let migrated = 0;
    let skipped = 0;
    for (const key of page.keys || []) {
        if (key.name.startsWith('manage@')) {
            skipped += 1;
            continue;
        }
        const exists = await env.img_d1.prepare('SELECT id FROM files WHERE id = ?').bind(key.name).first();
        if (exists) {
            skipped += 1;
            continue;
        }
        const record = await env.img_url.getWithMetadata(key.name);
        if (!record) {
            skipped += 1;
            continue;
        }
        await d1.put(key.name, record.value || '', { metadata: record.metadata || key.metadata || {} });
        migrated += 1;
    }
    await writeAuditLog(env, { actorId: identity.id, action: 'migration.kv-files', targetType: 'system', targetId: page.cursor || 'complete', reason: 'Import legacy file records into D1', details: { migrated, skipped } });
    return json({ migrated, skipped, cursor: page.list_complete ? null : page.cursor, complete: Boolean(page.list_complete) });
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
