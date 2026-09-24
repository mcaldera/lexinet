# Sprawl (repo: lexinet)

Graph-based spaced-repetition trainer for Italian vocabulary. Words are nodes; learning one reveals its neighbours; node health = FSRS retrievability. Full spec: `docs/PROPOSAL.md` (source of truth for scope).

## Stack

- Tauri 2 shell (minimal Rust, `src-tauri/`) + React 19 + TypeScript + Vite 5 + Tailwind 3
- Graph: `react-force-graph-2d` · Scheduling: `ts-fsrs` 4.x · Tests: Vitest
- Persistence: SQLite. In Tauri → `@tauri-apps/plugin-sql`; in a plain browser → `sql.js` persisted to localStorage (dev fallback, same schema/SQL)
- Offline pipeline: Python (`pipeline/`, own venv at `pipeline/.venv`), never bundled into the app. Meaning score from ConceptNet Numberbatch vectors of the English gloss (association, e.g. dog→bark; CC BY-SA 4.0, auto-downloaded to `~/.cache/sprawl/`). Sentence-embedding models (`--model BAAI/bge-m3`) only capture likeness and were worse in a labelled-pair benchmark

## Commands

- `npm run dev`: browser dev server (sql.js fallback)
- `npm test`: Vitest (src/core, src/db)
- `npm run lint` / `npm run format` / `npm run typecheck`
- `npm run tauri dev`: desktop app (needs Rust + webkit2gtk-4.1 system deps)
- `pipeline/.venv/bin/python pipeline/build_graph.py data/words.csv -o data/graph.json [--seed "il cane"]`
- `pipeline/.venv/bin/pytest pipeline/tests`

Node is 18 on the dev box: keep deps Node-18 compatible (Vite 5, Vitest 2, ts-fsrs 4).

## Layout

- `src/core/`: pure TS logic (scheduler, unlock, clock, health, queue, answer). No DB/React imports. Must have unit tests before use in UI.
- `src/db/`: `SqlDb` interface (execute/select), Tauri + sql.js adapters, schema, repository, seeding from `data/graph.json`
- `src/views/`: GraphView, ReviewView, DebugPanel
- `pipeline/`: `build_graph.py` + pytest tests
- `data/`: `words.csv` (input: italian, english, pos, theme, root, cognate; last four optional), `graph.json` (pipeline output, imported by the app)
- `docs/DOGFOOD_LOG.md`: daily usage notes

## Conventions

- All time goes through `clock.ts` (`real now + debug_day_offset`); never call `new Date()` directly in logic.
- Health is computed, never stored. So is the open tier (`core/tiers.ts`): tier k+1 opens when `TIER_UNLOCK_FRACTION` of tiers 1..k are conquered; closed-tier nodes stay locked and invisible. Tiers come from word frequency (pipeline) or a `tier` CSV column.
- Keyboard: WASD/arrows pan, +/- zoom, F fit (`views/useKeyboardCamera.ts`); ignored while typing.
- `graph.json` owns words and edges; SQLite owns progress only. On startup `syncGraph` adds new words/cards and repairs frontier states, so regenerating the graph keeps progress. Node ids are slugs of the Italian word: renaming a word loses its progress.
- Review flow (changed from PROPOSAL §3 at the author's request): the user clicks a frontier node to conquer it (or a conquered one to practise); the automatic queue only holds due/learning cards. Answers are typed and checked by `core/answer.ts` (article/accent/small typo → Hard, exact → Good, else Again); the 4 FSRS buttons remain as an override. The 10 new-words/day limit is a soft counter only.
- Rust stays a thin shell; logic lives in TS.
- Commit after each milestone (M0–M6). Git remote: the author's **personal** GitHub, never the ProxygenTx org.

## Out of scope for v0.1 (answer: "later")

Mobile, accounts/sync/backend, adding words in-app, user-created edges, attack events/scores/achievements/sounds/polish, audio/images/example sentences, other languages, porting logic to Rust.
