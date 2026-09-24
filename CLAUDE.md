# Sprawl (repo: lexinet)

Graph-based spaced-repetition trainer for Italian vocabulary. Words are nodes; learning one reveals its neighbours; node health = FSRS retrievability. Full spec: `docs/PROPOSAL.md` (source of truth for scope).

## Stack

- Tauri 2 shell (minimal Rust, `src-tauri/`) + React 19 + TypeScript + Vite 5 + Tailwind 3
- Graph: `react-force-graph-2d` · Scheduling: `ts-fsrs` 4.x · Tests: Vitest
- Persistence: SQLite. In Tauri → `@tauri-apps/plugin-sql`; in a plain browser → `sql.js` persisted to localStorage (dev fallback, same schema/SQL)
- Offline pipeline: Python (`pipeline/`, own venv at `pipeline/.venv`), never bundled into the app

## Commands

- `npm run dev`: browser dev server (sql.js fallback)
- `npm test`: Vitest (src/core, src/db)
- `npm run lint` / `npm run format` / `npm run typecheck`
- `npm run tauri dev`: desktop app (needs Rust + webkit2gtk-4.1 system deps)
- `pipeline/.venv/bin/python pipeline/build_graph.py data/words.csv -o data/graph.json [--seed "il cane"]`
- `pipeline/.venv/bin/pytest pipeline/tests`

Node is 18 on the dev box: keep deps Node-18 compatible (Vite 5, Vitest 2, ts-fsrs 4).

## Layout

- `src/core/`: pure TS logic (scheduler, unlock, clock, health, queue). No DB/React imports. Must have unit tests before use in UI.
- `src/db/`: `SqlDb` interface (execute/select), Tauri + sql.js adapters, schema, repository, seeding from `data/graph.json`
- `src/views/`: GraphView, ReviewView, DebugPanel
- `pipeline/`: `build_graph.py` + pytest tests
- `data/`: `words.csv` (input), `graph.json` (pipeline output, imported by the app)
- `docs/DOGFOOD_LOG.md`: daily usage notes

## Conventions

- All time goes through `clock.ts` (`real now + debug_day_offset`); never call `new Date()` directly in logic.
- Health is computed, never stored.
- Rust stays a thin shell; logic lives in TS.
- Commit after each milestone (M0–M6). Git remote: the author's **personal** GitHub, never the ProxygenTx org.

## Out of scope for v0.1 (answer: "later")

Mobile, accounts/sync/backend, adding words in-app, user-created edges, attack events/scores/achievements/sounds/polish, audio/images/example sentences, other languages, porting logic to Rust.
