-- Run explicitly against the intended environment after a backup.
-- Apply before deploying the phase 2 management queries to avoid increased read costs.
-- These expressions retain query coverage for legacy rows whose indexed fields
-- were not populated when they were written.
CREATE INDEX IF NOT EXISTS idx_files_management_order
    ON files(
        COALESCE(timestamp, CAST(json_extract(metadata, '$.TimeStamp') AS INTEGER), 0) DESC,
        id DESC,
        NULLIF(COALESCE(NULLIF(directory, ''), json_extract(metadata, '$.Directory')), '')
    );
