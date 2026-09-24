import type { Database, SqlJsStatic } from 'sql.js';
import type { SqlDb, SqlValue } from './types';

/** sql.js adapter; `persist` is called with the DB bytes after every write. */
export class SqlJsDb implements SqlDb {
  constructor(
    private db: Database,
    private persist?: (bytes: Uint8Array) => void,
  ) {}

  async execute(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
    this.persist?.(this.db.export());
  }

  async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql, params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Browser fallback: SQLite in memory, snapshotted to localStorage. */
export async function openBrowserDb(storageKey: string): Promise<SqlDb> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ]);
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmUrl });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {
    // storage unavailable: run in memory only
  }
  const db = new SQL.Database(saved ? fromBase64(saved) : undefined);
  return new SqlJsDb(db, (bytes) => {
    try {
      localStorage.setItem(storageKey, toBase64(bytes));
    } catch {
      // ignore quota / privacy-mode errors
    }
  });
}
