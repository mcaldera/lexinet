import Database from '@tauri-apps/plugin-sql';
import type { SqlDb, SqlValue } from './types';

export async function openTauriDb(file: string): Promise<SqlDb> {
  const db = await Database.load(`sqlite:${file}`);
  return {
    execute: async (sql: string, params: SqlValue[] = []) => {
      await db.execute(sql, params);
    },
    select: <T>(sql: string, params: SqlValue[] = []) => db.select<T[]>(sql, params),
  };
}
