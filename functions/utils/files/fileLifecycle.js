// Settle quota from the row being deleted, so repeated requests cannot release it twice.
export async function settleFileDeletion(d1, fileId) {
    await d1.batch([
        d1.prepare(`UPDATE users SET used_bytes = MAX(0, used_bytes - (
            SELECT MAX(0, CAST(COALESCE(file_size_bytes, json_extract(metadata, '$.FileSizeBytes'), 0) AS INTEGER))
            FROM files WHERE id = ?
        )), updated_at = ?
        WHERE discord_id = (
            SELECT COALESCE(owner_id, json_extract(metadata, '$.OwnerId')) FROM files WHERE id = ?
        )`).bind(fileId, Date.now(), fileId),
        d1.prepare('DELETE FROM album_covers WHERE file_id = ?').bind(fileId),
        d1.prepare('DELETE FROM album_items WHERE file_id = ?').bind(fileId),
        d1.prepare('DELETE FROM files WHERE id = ?').bind(fileId),
    ]);
}
