import type { Database, SqlJsStatic } from 'sql.js';
import { loadSnapshot, saveSnapshot } from './store';
import type { SqlDb, SqlValue } from './types';

/** sql.js adapter; `persist` stores the DB bytes after writes. */
export class SqlJsDb implements SqlDb {
  /** The save under way, and the one queued behind it (it takes every write made meanwhile). */
  private saving: Promise<void> | null = null;
  private queued: Promise<void> | null = null;

  constructor(
    private db: Database,
    private persist?: (bytes: Uint8Array) => Promise<void>,
  ) {}

  /** Resolves once the change is stored. */
  async execute(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
    await this.save();
  }

  async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql, params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  }

  /** Resolves once everything written so far is stored (before a reload). */
  flush(): Promise<void> {
    return this.queued ?? this.saving ?? Promise.resolve();
  }

  /**
   * Store a snapshot taken after this call. Writes made while one is being stored
   * share the next snapshot: a whole-DB export per statement was the cost of
   * every write (see "batch writes" in CLAUDE.md).
   */
  private save(): Promise<void> {
    if (!this.persist) return Promise.resolve();
    if (this.queued) return this.queued;
    if (this.saving) {
      const next = () => {
        this.queued = null;
        return this.save();
      };
      this.queued = this.saving.then(next, next);
      return this.queued;
    }
    this.saving = this.persist(this.db.export()).finally(() => {
      this.saving = null;
    });
    return this.saving;
  }
}

/** Browser fallback: SQLite in memory, snapshotted to IndexedDB (store.ts). */
export async function openBrowserDb(storageKey: string): Promise<SqlDb> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ]);
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(await loadSnapshot(storageKey));
  return new SqlJsDb(db, (bytes) => saveSnapshot(storageKey, bytes));
}
