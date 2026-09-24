export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    it TEXT NOT NULL, en TEXT NOT NULL, pos TEXT, theme TEXT,
    state TEXT NOT NULL DEFAULT 'locked'
  )`,
  `CREATE TABLE IF NOT EXISTS edges (
    source TEXT, target TEXT, weight REAL, reason TEXT,
    PRIMARY KEY (source, target)
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    fsrs_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS review_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT, rating INTEGER, reviewed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
];
