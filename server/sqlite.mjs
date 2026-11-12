import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function openDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_remove_attendees.sql', import.meta.url), 'utf8'));
  const prepare = (sql, args = []) => ({
    bind(...bindings) { return prepare(sql, bindings); },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
    execute() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { prepare,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
}
