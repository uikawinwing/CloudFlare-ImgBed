function asArray(value) {
    return Array.isArray(value) ? value : (value ? [value] : []);
}

function valueExpression(column, metadataField) {
    const expression = `COALESCE(NULLIF(${column}, ''), json_extract(metadata, '$.${metadataField}'))`;
    return column === 'directory' ? `NULLIF(${expression}, '')` : expression;
}

function directoryPredicate(directory, dirPrefix, params) {
    if (!directory) return '';
    const end = `${dirPrefix.slice(0, -1)}0`;
    params.push(dirPrefix, end, directory, dirPrefix, end);
    return `((directory_value >= ? AND directory_value < ?) OR directory_value = ? OR (directory_value IS NULL AND id >= ? AND id < ?))`;
}

function directFilePredicate(dirPrefix, params) {
    if (!dirPrefix) return `(directory_value = '' OR (directory_value IS NULL AND instr(id, '/') = 0))`;
    params.push(dirPrefix, dirPrefix, `${dirPrefix.slice(0, -1)}0`, [...dirPrefix].length + 1);
    return `(directory_value = ? OR (directory_value IS NULL AND id >= ? AND id < ? AND instr(substr(id, ?), '/') = 0))`;
}

function buildFilteredQuery(options) {
    const params = [];
    const where = [];
    const directory = options.directory || '';
    const dirPrefix = directory === '' || directory.endsWith('/') ? directory : `${directory}/`;
    const channels = asArray(options.channel);
    const listTypes = asArray(options.listType);
    const accessStatuses = asArray(options.accessStatus);
    const labels = asArray(options.label);
    const fileTypes = asArray(options.fileType);
    const channelNames = asArray(options.channelName);

    const directorySql = directoryPredicate(directory, dirPrefix, params);
    if (directorySql) where.push(directorySql);
    if (channels.length) {
        where.push(`LOWER(channel_value) IN (${channels.map(() => 'LOWER(?)').join(', ')})`);
        params.push(...channels);
    }
    if (listTypes.length) {
        const checks = [];
        if (listTypes.includes('None')) checks.push(`(list_type_value IS NULL OR list_type_value = '' OR list_type_value = 'None')`);
        const defined = listTypes.filter(value => value !== 'None');
        if (defined.length) {
            checks.push(`list_type_value IN (${defined.map(() => '?').join(', ')})`);
            params.push(...defined);
        }
        where.push(`(${checks.join(' OR ')})`);
    }
    if (accessStatuses.length) {
        const checks = [];
        if (accessStatuses.includes('normal')) {
            // JavaScript treats a missing ListType as normal unless Label is adult.
            checks.push(`((list_type_value IS NULL OR list_type_value <> 'Block') AND (label_value IS NULL OR label_value <> 'adult' OR list_type_value = 'White'))`);
        }
        if (accessStatuses.includes('blocked')) checks.push(`(list_type_value = 'Block' OR (label_value = 'adult' AND list_type_value IS NOT 'White'))`);
        where.push(`(${checks.join(' OR ') || '0'})`);
    }
    if (labels.length) {
        const checks = [];
        if (labels.includes('normal')) checks.push(`(label_value IS NULL OR label_value = '' OR label_value = 'None' OR label_value = 'everyone')`);
        if (labels.includes('teen')) checks.push(`label_value = 'teen'`);
        if (labels.includes('adult')) checks.push(`label_value = 'adult'`);
        where.push(`(${checks.join(' OR ') || '0'})`);
    }
    if (fileTypes.length) {
        const checks = [];
        if (fileTypes.includes('image')) checks.push(`file_type_value GLOB 'image/*'`);
        if (fileTypes.includes('video')) checks.push(`file_type_value GLOB 'video/*'`);
        if (fileTypes.includes('audio')) checks.push(`file_type_value GLOB 'audio/*'`);
        if (fileTypes.includes('other')) checks.push(`(file_type_value IS NULL OR (file_type_value NOT GLOB 'image/*' AND file_type_value NOT GLOB 'video/*' AND file_type_value NOT GLOB 'audio/*'))`);
        where.push(`(${checks.join(' OR ') || '0'})`);
    }
    if (channelNames.length) {
        const checks = [];
        for (const filterValue of channelNames) {
            if (filterValue.includes(':')) {
                const [channel, name] = filterValue.split(':', 2);
                checks.push(`(channel_value = ? AND channel_name_value = ?)`);
                params.push(channel, name);
            } else {
                checks.push(`channel_name_value = ?`);
                params.push(filterValue);
            }
        }
        where.push(`(${checks.join(' OR ')})`);
    }
    const fields = ['id', `${valueExpression('directory', 'Directory')} AS directory_value`,
        `COALESCE(timestamp, CAST(json_extract(metadata, '$.TimeStamp') AS INTEGER), 0) AS timestamp_value`];
    if (fileTypes.length) fields.push(`${valueExpression('file_type', 'FileType')} AS file_type_value`);
    if (listTypes.length || accessStatuses.length) fields.push(`${valueExpression('list_type', 'ListType')} AS list_type_value`);
    if (labels.length || accessStatuses.length) fields.push(`${valueExpression('label', 'Label')} AS label_value`);
    if (channels.length || channelNames.some(name => name.includes(':'))) fields.push(`${valueExpression('channel', 'Channel')} AS channel_value`);
    if (channelNames.length) fields.push(`${valueExpression('channel_name', 'ChannelName')} AS channel_name_value`);
    // LIMIT -1 prevents the directory OR predicates from being pushed into a
    // multi-index lookup that revisits the source table for counts and folders.
    const sql = `WITH candidates AS NOT MATERIALIZED (
        SELECT ${fields.join(', ')} FROM files ORDER BY timestamp_value DESC, id DESC LIMIT -1
    ), filtered AS NOT MATERIALIZED (
        SELECT id, directory_value, timestamp_value FROM candidates${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    )`;
    return { sql, params, dirPrefix };
}

async function all(d1, sql, params) {
    return d1.prepare(sql).bind(...params).all();
}

/**
 * Aggregates counts and folders in one ordered pass. Only the requested page
 * joins back to files for metadata; compact intermediate rows are not materialized.
 */
export async function readD1FileIndex(d1, options = {}) {
    const { sql, params, dirPrefix } = buildFilteredQuery(options);
    const indexLastUpdated = Date.now();
    if (options.countOnly) {
        const result = await all(d1, `${sql} SELECT COUNT(*) AS total_count FROM filtered`, params);
        return { totalCount: Number(result.results[0]?.total_count || 0), indexLastUpdated };
    }

    const statsParams = [];
    const directStatsPredicate = directFilePredicate(dirPrefix, statsParams);
    const count = Math.max(1, Number(options.count ?? 50));
    const start = Math.max(0, Number(options.start) || 0);
    const pageParams = [];
    const pagePredicate = options.includeSubdirFiles ? '' : ` WHERE ${directFilePredicate(dirPrefix, pageParams)}`;
    pageParams.push(count, start);

    const statsSql = `${sql}, ordered AS (
        SELECT id, directory_value, timestamp_value FROM filtered ORDER BY timestamp_value DESC, id DESC
    ), tails AS (
        SELECT id, directory_value, substr(COALESCE(directory_value, id), ?) AS tail FROM ordered
    ), folder_rows AS (
        SELECT CASE WHEN instr(tail, '/') > 0 THEN ? || substr(tail, 1, instr(tail, '/') - 1) END AS folder,
            (${directStatsPredicate}) AS is_direct FROM tails
    ) SELECT COUNT(*) AS total_count, COALESCE(SUM(is_direct), 0) AS direct_count,
        json_group_array(DISTINCT folder) FILTER (WHERE folder IS NOT NULL) AS directories_json FROM folder_rows`;
    const statsResult = await all(d1, statsSql, [...params, [...dirPrefix].length + 1, dirPrefix, ...statsParams]);
    const stats = statsResult.results[0];
    const eligibleCount = Number(options.includeSubdirFiles ? stats.total_count : stats.direct_count);
    const pageSql = `${sql} SELECT page.id, files.metadata, page.timestamp_value
    FROM (SELECT id, timestamp_value FROM filtered${pagePredicate} ORDER BY timestamp_value DESC, id DESC LIMIT ? OFFSET ?) AS page
    JOIN files ON files.id = page.id
    ORDER BY page.timestamp_value DESC, page.id DESC`;
    const result = eligibleCount > start ? await all(d1, pageSql, [...params, ...pageParams]) : { results: [] };
    const files = result.results.map(row => ({ id: row.id, metadata: JSON.parse(row.metadata || '{}') }));
    const directories = JSON.parse(stats.directories_json || '[]');
    return {
        files,
        directories,
        totalCount: Number(stats.total_count || 0),
        directFileCount: Number(stats.direct_count || 0),
        directFolderCount: directories.length,
        indexLastUpdated,
        returnedCount: files.length,
        success: true,
    };
}
