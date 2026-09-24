# Sprawl — Project Proposal (Prototype v0.1)

**Repo:** `lexinet` · **Working app name:** Sprawl · **Status:** pre-prototype
**First domain:** Italian vocabulary (the author's own, ~100–150 words he is currently learning)

---

## 1. Idea in one paragraph

Sprawl is a spaced-repetition vocabulary trainer where words are **nodes in a graph** instead of cards in a flat deck. You start from a single word; learning it reveals its neighbours ("fog of war"), so your knowledge visibly _sprawls_ outward. Every node has a **health** value equal to its FSRS retrievability — neglected words fade and crack, reviewed words heal. The growing, living network is the motivation: you're not keeping a streak, you're defending territory you built.

## 2. Why this project (personal goals)

1. **Agentic coding skills** — built end-to-end with Claude Code, milestone by milestone, with a real multi-part architecture (offline data pipeline + desktop app + local DB).
2. **Software development** — a real app with persistence, scheduling logic, a non-trivial UI, and a path to mobile.
3. **Actually learn Italian** — the author is user #1; the prototype must be good enough to use daily.
4. _(Optional)_ **Monetisation later** — only if the core loop proves itself.

## 3. Prototype goal & scope

**Goal:** a working desktop prototype, buildable in **2–3 focused days**, that the author uses daily for ~2 weeks to answer one question:

> _Does learning words inside a visible, decaying graph feel better and stick better than a flat Anki deck?_

### In scope (v0.1)

- Offline script turns a word list (CSV) into a graph (JSON) using embeddings + max spanning tree + bonus edges.
- Desktop app loads that graph into a local SQLite database on first run.
- **Graph view:** force-directed network; node colour/opacity = health; locked nodes hidden, frontier nodes shown as "?".
- **Review session:** due words shown one at a time, self-graded with the 4 FSRS buttons (Again / Hard / Good / Easy), both directions (IT→EN, EN→IT).
- **Unlocking:** a node is "conquered" after its first successful review; its neighbours become frontier.
- **Decay:** health computed live from FSRS; a debug "⏩ +1 day / +7 days" button simulates time passing.
- **Edge explanation:** hovering an edge shows _why_ two words are linked (semantic / shared root / theme).

### Explicitly out of scope (v0.1)

- Mobile build, accounts, sync, cloud backend
- Adding words inside the app (words come only from the CSV + pipeline)
- User-created edges ("freeform builder" mode)
- "Attack" events, scores, achievements, sounds, polish
- Audio / images / example sentences
- Any language other than Italian

## 4. Tech stack

| Layer           | Choice                                                            | Reason                                                                       |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| App shell       | **Tauri 2**                                                       | Small, fast desktop app; same codebase can later target iOS/Android          |
| Frontend        | **React + TypeScript + Vite**                                     | Known stack, fast iteration                                                  |
| Graph rendering | **react-force-graph-2d** (fallback: Cytoscape.js)                 | Easy force layout, good for ≤ 200 nodes                                      |
| Scheduling      | **ts-fsrs**                                                       | Official open-source FSRS implementation in TS; retrievability = node health |
| Persistence     | **SQLite via `tauri-plugin-sql`**                                 | Local, zero-server, trivial to inspect                                       |
| Styling         | Tailwind CSS                                                      | Fast, no design system needed yet                                            |
| Data pipeline   | **Python** script (`sentence-transformers`, `networkx`, `pandas`) | Run offline on the author's GPU machine; output shipped as static JSON       |
| Tests           | Vitest (TS), pytest (pipeline)                                    | Keep logic testable, especially scheduling and unlocking                     |

**Design principle for the prototype:** keep nearly all logic in TypeScript. Rust is used only as the Tauri shell and plugin host. Moving FSRS / graph logic into Rust is a later, optional refactor (and a good learning exercise), not a prototype requirement.

## 5. Architecture

```
words.csv ──► pipeline/build_graph.py ──► data/graph.json
                  (offline, Python, GPU)          │
                                                  ▼
                          ┌─────────────── Tauri desktop app ───────────────┐
                          │  first run: seed SQLite from graph.json         │
                          │                                                  │
                          │  React UI                                        │
                          │   ├─ GraphView    (health, fog of war)           │
                          │   ├─ ReviewView   (FSRS session)                 │
                          │   └─ DebugPanel   (time travel, reset)           │
                          │                                                  │
                          │  src/core  (pure TS, unit-tested)                │
                          │   ├─ scheduler.ts  (ts-fsrs wrapper)             │
                          │   ├─ unlock.ts     (frontier / conquest rules)   │
                          │   └─ clock.ts      (real time + debug offset)    │
                          │                                                  │
                          │  src/db  (tauri-plugin-sql, SQLite)              │
                          └──────────────────────────────────────────────────┘
```

### 5.1 Input format — `words.csv`

```
italian,english,pos,theme
il cane,dog,noun,animals
abbaiare,to bark,verb,animals
parlare,to speak,verb,communication
...
```

`pos` and `theme` are optional but improve edges.

### 5.2 Graph pipeline — `pipeline/build_graph.py`

1. Load CSV.
2. Compute pairwise edge score as a weighted sum of:
   - **semantic** — cosine similarity of multilingual embeddings (e.g. `paraphrase-multilingual-MiniLM-L12-v2`) of the Italian word + English gloss
   - **morphological** — shared stem / normalised string similarity of the Italian lemmas (catches `parlare → parlato → parlata`)
   - **thematic** — bonus if `theme` matches
3. Build the **maximum spanning tree** (`networkx.maximum_spanning_tree`) so the graph is fully connected.
4. Add **bonus edges**: top-k (k≈2) per node above a similarity threshold, to create loops and clusters.
5. Label every edge with its dominant reason (`semantic` | `morphological` | `thematic`) and score.
6. Choose the **seed node** (highest degree by default; overridable via CLI flag).
7. Write `data/graph.json`:

```json
{
  "seed": "il cane",
  "nodes": [{ "id": "n1", "it": "il cane", "en": "dog", "pos": "noun", "theme": "animals" }],
  "edges": [{ "source": "n1", "target": "n2", "weight": 0.82, "reason": "thematic" }]
}
```

The pipeline has its own `requirements.txt` and is **never** bundled into the app.

### 5.3 Database schema (SQLite)

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  it TEXT NOT NULL, en TEXT NOT NULL, pos TEXT, theme TEXT,
  state TEXT NOT NULL DEFAULT 'locked'   -- locked | frontier | conquered
);
CREATE TABLE edges (
  source TEXT, target TEXT, weight REAL, reason TEXT,
  PRIMARY KEY (source, target)
);
CREATE TABLE cards (          -- one per node per direction
  id TEXT PRIMARY KEY,        -- e.g. n1:it-en
  node_id TEXT NOT NULL,
  direction TEXT NOT NULL,    -- it-en | en-it
  fsrs_json TEXT NOT NULL     -- serialised ts-fsrs Card
);
CREATE TABLE review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT, rating INTEGER, reviewed_at TEXT
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- e.g. debug_day_offset
```

### 5.4 Core rules

- **Node health** = mean retrievability of its two cards (0–1), computed on the fly with the app clock. Never stored.
- **Visuals:** health > 0.9 solid · 0.7–0.9 slightly faded · 0.5–0.7 faded + dashed outline · < 0.5 "cracked" (red tint). Edge opacity = min(health of both ends).
- **Unlocking:** at start only the seed is `frontier`. A frontier node becomes `conquered` after its first review rated ≥ Good; all its locked neighbours become `frontier`.
- **Review queue:** due cards of conquered nodes first (lowest retrievability first), then new cards of frontier nodes, capped at a configurable number of new nodes per day (default 10).
- **Clock:** `now() = real time + debug_day_offset`. All FSRS calls go through it, so time travel is trivial and testable.

## 6. Milestones (target: 2–3 days)

| #   | Milestone             | Done when                                                                                                                                     |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Repo + scaffolding    | Tauri 2 + React + TS app opens a window; lint, format, Vitest run in CI-less local scripts                                                    |
| M1  | Data pipeline         | `python pipeline/build_graph.py words.csv` produces a valid `graph.json` for the author's real list; edges look sensible on manual inspection |
| M2  | DB + seeding          | App seeds SQLite from `graph.json` on first run; data survives restart                                                                        |
| M3  | Core logic            | `scheduler.ts`, `unlock.ts`, `clock.ts` implemented with unit tests (FSRS rating flow, unlocking, time offset)                                |
| M4  | Graph view            | Graph renders with states, health colours, frontier "?" nodes, edge-reason tooltips                                                           |
| M5  | Review view           | Full session works in both directions; ratings update FSRS and unlock neighbours; graph reflects changes immediately                          |
| M6  | Debug panel + dogfood | Time-travel and reset buttons work; author completes one real session end to end                                                              |

After M6: **use it daily for two weeks** before adding features. Keep a short `docs/DOGFOOD_LOG.md` noting what felt good, boring or broken.

## 7. Success criteria (after 2 weeks of use)

- The author opens it on most days without forcing himself to.
- Recall of the prototype's words feels at least as good as the equivalent Anki deck.
- Seeing the graph decay actually changes behaviour (e.g. reviewing to "save" a cluster).
- A clear list of the top 3 things to build next exists.

## 8. Roadmap after the prototype (not now)

1. Add words inside the app (pipeline runs as a sidecar, or embeddings precomputed for a large frequency list).
2. "Attack" events: timed defence sessions targeting the weakest cluster.
3. Example sentences (Tatoeba), etymology notes (Wiktionary), audio.
4. Mobile build via Tauri 2 (iOS/Android).
5. Move FSRS/graph logic into Rust (learning exercise + mobile performance).
6. Freeform edge builder (user-proposed connections, scored by the pipeline).
7. More languages / domains; then think about monetisation.

## 9. Risks & mitigations

| Risk                                        | Mitigation                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Auto-generated edges feel arbitrary         | Show the edge reason; hand-edit `graph.json` if needed; tune weights in the pipeline |
| Graph becomes unreadable                    | Only conquered + frontier nodes are drawn; ≤ 150 words in v0.1                       |
| Scope creep (it's fun to add game features) | Section 3 "out of scope" is binding until the 2-week dogfood is done                 |
| Tauri / SQLite plugin friction              | Fallback: run the same React app in the browser with an in-memory store for UI work  |

## 10. Working with Claude Code

- Put this file at `docs/PROPOSAL.md`. First task for Claude Code: generate a concise `CLAUDE.md` (stack, commands, folder layout, conventions, "out of scope" list) from it.
- Work **one milestone per session**: start in plan mode, review the plan, then implement.
- Require tests for everything in `src/core` before wiring it into UI.
- Commit after each milestone with a short summary; keep `docs/DOGFOOD_LOG.md` for learnings.
- When Claude Code proposes something from Section 8, the answer is "later."

## 11. Suggested repo layout

```
lexinet/
├─ CLAUDE.md
├─ docs/
│  ├─ PROPOSAL.md
│  └─ DOGFOOD_LOG.md
├─ pipeline/
│  ├─ build_graph.py
│  ├─ requirements.txt
│  └─ tests/
├─ data/
│  ├─ words.csv
│  └─ graph.json
├─ src/                 # React + TS
│  ├─ core/             # scheduler, unlock, clock (pure, tested)
│  ├─ db/
│  ├─ views/            # GraphView, ReviewView, DebugPanel
│  └─ App.tsx
└─ src-tauri/           # Tauri 2 shell (minimal Rust)
```
