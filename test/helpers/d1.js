import { DatabaseSync } from 'node:sqlite';

export class TestD1 {
    constructor() {
        this.db = new DatabaseSync(':memory:');
        this.db.exec('PRAGMA foreign_keys = ON');
        this.failOnStatement = null;
    }

    exec(sql) { this.db.exec(sql); }
    prepare(sql) { return new TestD1Statement(this, sql); }

    async batch(statements) {
        this.db.exec('BEGIN');
        try {
            const results = statements.map((statement, index) => {
                if (this.failOnStatement === index) throw new Error('forced batch failure');
                return statement.executeSync();
            });
            this.db.exec('COMMIT');
            return results;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}

class TestD1Statement {
    constructor(d1, sql) {
        this.d1 = d1;
        this.sql = sql;
        this.params = [];
    }

    bind(...params) { this.params = params; return this; }
    async first(column) {
        const row = this.d1.db.prepare(this.sql).get(...this.params) || null;
        return column && row ? row[column] : row;
    }
    async all() { return { results: this.d1.db.prepare(this.sql).all(...this.params) }; }
    async run() { return this.runSync(); }
    runSync() {
        const result = this.d1.db.prepare(this.sql).run(...this.params);
        return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: result.lastInsertRowid } };
    }
    executeSync() {
        if (/^\s*(?:SELECT|PRAGMA|EXPLAIN)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
            return { success: true, results: this.d1.db.prepare(this.sql).all(...this.params) };
        }
        return this.runSync();
    }
}
