export type SqlValue = string | number | null;

/** Minimal async SQL interface, shaped like tauri-plugin-sql's Database. */
export interface SqlDb {
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  select<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Resolves once every write so far is stored, awaited or not (before a reload). */
  flush?(): Promise<void>;
}
