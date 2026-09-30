/**
 * Where the browser keeps its databases: IndexedDB, as bytes, one entry per
 * graph and run. They used to be base64 in localStorage, which holds about 5 M
 * characters per site: one run of the vocabulary takes 2.2 M, so a third
 * database (another run, or an old word list's) could not be saved, the error
 * was swallowed and the run reopened empty, at the start picker (Sep 2026).
 * Snapshots still in localStorage move over on first use, which frees it.
 * Without IndexedDB (some private modes) localStorage is still the fallback.
 */
const STORE = 'databases';
const LEGACY = /^sprawl.*\.db$/;

const problems = new Set<(message: string) => void>();
/** Hear about saves that failed (the app shows them: a silent failure lost whole runs). */
export function onStorageProblem(f: (message: string) => void) {
  problems.add(f);
  return () => void problems.delete(f);
}
const problem = (message: string) => problems.forEach((f) => f(message));

let opened: Promise<IDBDatabase | null> | null = null;
/** The IndexedDB database, with localStorage's old snapshots moved in; null if unavailable. */
function idb(): Promise<IDBDatabase | null> {
  opened ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open('sprawl', 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then(async (db) => {
    if (db) await moveLegacy(db);
    return db;
  });
  return opened;
}

function run<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
  });
}

function legacyKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => LEGACY.test(k));
  } catch {
    return [];
  }
}

/** Every snapshot left in localStorage goes to IndexedDB (unless it has one) and out of localStorage. */
async function moveLegacy(db: IDBDatabase) {
  for (const key of legacyKeys()) {
    try {
      const have = await run(db, 'readonly', (s) => s.count(key));
      if (!have)
        await run(db, 'readwrite', (s) => s.put(fromBase64(localStorage.getItem(key)!), key));
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`Could not move ${key} to IndexedDB`, e);
    }
  }
}

/** The stored bytes of a database, if any. */
export async function loadSnapshot(key: string): Promise<Uint8Array | undefined> {
  const db = await idb();
  if (!db) {
    try {
      const saved = localStorage.getItem(key);
      return saved ? fromBase64(saved) : undefined;
    } catch {
      return undefined; // storage unavailable: run in memory only
    }
  }
  const bytes = await run<unknown>(db, 'readonly', (s) => s.get(key));
  return bytes instanceof Uint8Array ? bytes : undefined;
}

/** Store a database's bytes; a failure is reported (onStorageProblem), not thrown. */
export async function saveSnapshot(key: string, bytes: Uint8Array): Promise<void> {
  try {
    const db = await idb();
    if (db) await run(db, 'readwrite', (s) => s.put(bytes, key));
    else localStorage.setItem(key, toBase64(bytes));
  } catch (e) {
    console.error(`Could not save ${key}`, e);
    problem(`Progress not saved: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Forget a database (a deleted run). */
export async function deleteSnapshot(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
    const db = await idb();
    if (db) await run(db, 'readwrite', (s) => s.delete(key));
  } catch (e) {
    console.error(`Could not delete ${key}`, e);
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
