export async function writeAuditLog(env, { actorId, action, targetType, targetId, reason = null, details = null }) {
    if (!env.img_d1?.prepare) throw new Error('Audit log requires D1');
    await prepareAuditLog(env, { actorId, action, targetType, targetId, reason, details }).run();
}

export function prepareAuditLog(env, { actorId, action, targetType, targetId, reason = null, details = null, onlyIfFileAvailable = false }) {
    if (!env.img_d1?.prepare) throw new Error('Audit log requires D1');
    const suffix = onlyIfFileAvailable
        ? "SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM files WHERE id = ? AND moderation_status <> 'deleting')"
        : 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    return env.img_d1.prepare(`INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, reason, details, created_at) ${suffix}`)
        .bind(crypto.randomUUID(), actorId, action, targetType, targetId, reason, details ? JSON.stringify(details) : null, Date.now(), ...(onlyIfFileAvailable ? [targetId] : []))
        ;
}

export function readReason(payload) {
    const reason = String(payload?.reason || '').trim();
    return reason.length >= 3 && reason.length <= 500 ? reason : null;
}
