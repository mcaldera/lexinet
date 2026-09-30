import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { SqlJsDb } from './sqljs';

describe('SqlJsDb saving', () => {
  it('stores every write, sharing snapshots while one is being stored', async () => {
    const SQL = await initSqlJs();
    const stored: Uint8Array[] = [];
    const db = new SqlJsDb(new SQL.Database(), async (bytes) => {
      await new Promise((r) => setTimeout(r, 5));
      stored.push(bytes);
    });
    await db.execute('CREATE TABLE t (n INTEGER)');
    const writes = [1, 2, 3, 4, 5].map((n) => db.execute('INSERT INTO t VALUES (?)', [n]));
    await Promise.all(writes);
    await db.flush();
    // The first insert's snapshot, then one for the four made meanwhile.
    expect(stored.length).toBe(3);
    const last = new SQL.Database(stored.at(-1));
    expect(last.exec('SELECT COUNT(*) FROM t')[0].values[0][0]).toBe(5);
  });

  it('awaiting a write means it is stored', async () => {
    const SQL = await initSqlJs();
    let stored: Uint8Array | undefined;
    const db = new SqlJsDb(new SQL.Database(), async (bytes) => {
      await new Promise((r) => setTimeout(r, 5));
      stored = bytes;
    });
    await db.execute('CREATE TABLE t (n INTEGER)');
    void db.execute('INSERT INTO t VALUES (1)');
    await db.execute('INSERT INTO t VALUES (2)');
    const saved = new SQL.Database(stored);
    expect(saved.exec('SELECT COUNT(*) FROM t')[0].values[0][0]).toBe(2);
  });
});
