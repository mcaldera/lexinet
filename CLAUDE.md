# Sprawl (repo: lexinet)

Italian vocabulary trainer as a territory game. Words are nodes in a graph; answering a word correctly claims it and reveals its neighbours; memory (FSRS) plus a live influence game decide whether your territory holds. The author (Michael) is user #1 and iterates fast with feature requests.

`docs/PROPOSAL.md` is the original v0.1 plan. The project has since gone well beyond it at the author's request (tiers, verbs, influence game, claims, etymology, multiple word lists). Treat this file as the current source of truth; the proposal's "out of scope" list no longer binds.

## Stack

- React 19 + TypeScript + Vite 5 + Tailwind 3; graph: `react-force-graph-2d` (canvas); scheduling: `ts-fsrs` 4.x; tests: Vitest 2
- Tauri 2 shell in `src-tauri/` (thin, untested: this dev box has no Rust toolchain or webkit2gtk). Day-to-day the app runs in the browser.
- Persistence: SQLite. Tauri → `@tauri-apps/plugin-sql`; browser → `sql.js`, snapshotted to localStorage (key `sprawl.db`, or `sprawl-<graph>.db`)
- Offline pipeline: Python 3.13 in `pipeline/.venv` (sentence-transformers, networkx, pandas); never bundled

## Commands

- `npm run dev` (port 1420, forwarded by VS Code) · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
- `pipeline/.venv/bin/pytest -q pipeline/tests`
- Build a graph: `pipeline/.venv/bin/python pipeline/build_graph.py data/words.csv -o data/graph.json` (also `words_1000.csv → graph_1000.json`, `words_oic.csv → graph_oic.json`). Flags: `--seed`, `--model` (default `numberbatch`), `-k`, `-t`, `--no-english`, `--no-conjugations`. Takes ~10–50 s.
- Word lists: `make_wordlist.py data/words.csv -n 1000 -o data/words_1000.csv`; `scrape_oic.py -o data/words_oic.csv`, then `cd pipeline && ../pipeline/.venv/bin/python enrich_etymology.py ../data/words_oic.csv`
- Node is 18 on the dev box: keep deps Node-18 compatible (Vite 5, Vitest 2, ts-fsrs 4; ts-fsrs 5 needs Node 20).

## Verifying changes (how past sessions did it)

Typecheck + lint + tests, then a real browser run: `npm run build`, `npx vite preview --port 4173 --strictPort` (in the background), and a Playwright script in the session scratchpad using the cached Chromium at `~/.cache/ms-playwright/chromium_headless_shell-*/…/chrome-headless-shell` (scratch venv with `pip install playwright pillow numpy scipy`). Read answers from `data/graph.json` to play. Pitfalls:

- Click `header h1` before keyboard input, not `header` (it contains buttons that swallow Enter).
- The view auto-fits only once; press `f` to refit.
- Locate nodes by their colour in screenshots.
- Stop the server with `fuser -k 4173/tcp`. `pkill -f` can kill your own shell.

## Architecture

```
data/words*.csv ─ pipeline/build_graph.py ─► data/graph*.json ─► app (import.meta.glob in src/graphs.ts)
                                                                  ├─ ?graph=<name> picks a graph; each has its own DB
                                                                  └─ SQLite holds progress only
```

- `graph.json` owns words, edges, regions, roots and conjugations; SQLite owns progress. `syncGraph` (repo.ts) runs on start: it adds new words and cards and repairs frontier states. Node ids are slugs of the Italian word, so regenerating a graph keeps progress (renaming a word loses it).
- `src/useSprawl.ts`: the state hook. Opens the DB, loads `AppData`, performs all mutations (`review`, `reviewTense`, `unlockRoot`, time travel, reset), and runs the influence simulation when app time moves.
- `src/App.tsx`: UI orchestration (sessions, cooldowns, notices, selection, which side card shows). Big file; read it before changing flows.
- `src/progress.ts`: `computeProgress`, the single source of truth for the open tier (words + verb requirement).
- `src/config.ts`: all tunables (tier fraction, cooldown, verbs per tier, `INFLUENCE` rates, claim gap/expiry).

### src/core (pure and unit-tested; no React/DB imports; add tests before using in UI)

| module | what |
|---|---|
| `clock` | app time = real time + debug day offset. Never `new Date()` in logic. |
| `scheduler` | ts-fsrs wrapper, card (de)serialisation, `cardId(node, dir)` = `node:it-en` / `node:en-it` |
| `answer` | typed-answer checking: exact → Good; article/accent/small typo → Hard ("almost", still counts); else Again. `checkMeaning` is the lenient version for roots. |
| `unlock` | node states `locked \| frontier \| claimed \| conquered`; `unlockChanges` (frontier → claimed, reveals neighbours), `repairStates`, `slipChanges` |
| `claim` | claimed → conquered needs it→en ✓, en→it ✓, and a recall ≥ `CLAIM_RECALL_GAP_MS` later |
| `queue` | automatic queue: due reviews (weakest first), then the unreviewed 2nd direction, then learning cards. Untouched frontier words never appear automatically. |
| `health`, `fade` | health = mean retrievability; names erode letter by letter from 90% to 50%, then show "?" |
| `strength` | FSRS stability → level 0–5; `nextPractice` (no cramming: practice only when due) |
| `tiers` | tier k+1 opens at `TIER_UNLOCK_FRACTION` of tiers 1..k conquered plus `VERBS_PER_TIER` verbs at level k |
| `verbs` | tense levels (presente → passato prossimo → imperfetto → futuro → condizionale → congiuntivo), one new tense per 20 h, `nextDrill`, `checkConjugation` |
| `influence` | game layer: `control` per conquered word, hostile frontier (after 24 h grace or a wrong answer), rebels, lost words; `simulate` (1 h steps), `afterAnswer`, `pressureBreakdown`, `cohesion` |

### src/views

- `GraphView`: the canvas. Nodes, links, chevron particles, energy bands, cohesion glow, metaball territories (`drawRegions`), keyboard cursor.
- `ReviewView`: the typed card.
- `VerbDrill`, `RootQuiz`: conjugation drill and root unlock quiz.
- `WordInfo`: card for a solid conquered word.
- `NodeDetails`: status panel under the main card (health, control, trend, per-neighbour breakdown, claim steps, verb, etymology).
- `VerbGoals`: which verbs count for the next tier.
- `InspectPanel`: spoiler view of the whole network.
- `DebugPanel`: +15 min / +1 day / +7 days, reset.
- Helpers: `Etymology`, `visuals.ts` (shapes, link colours), `useKeyboardCamera.ts`.

### Persistence

- Tables: `nodes(id, it, en, pos, theme, state)`, `edges`, `cards(id, node_id, direction, fsrs_json)`, `review_log`, `meta`.
- `cards.direction` is `it-en`/`en-it`, or `tense:<tense>` for verb tense cards (created on the first successful drill).
- Meta keys: `debug_day_offset`, `unlocked_roots` (JSON array), `game` (JSON: `simAt` plus per-node `{control, since, hostileUntil, claim}`).
- In memory only (lost on reload): cooldown locks, notices, open sessions.
- sql.js exports the whole DB on every `execute`, so batch writes (multi-row INSERT, or one JSON value) instead of many small statements.

## Game rules (current)

- **Claiming:** click a "?" (or move to it with the arrow keys) to get a typed card. A correct answer makes it **claimed**: fragile, and it reveals its neighbours. It becomes conquered after both directions plus a recall 10+ min later. A never-seen word offers "Show me", which is not penalised.
- **Misses:** a real miss locks the word for 60 s, makes it hostile, and makes claimed neighbours slip back to "?". Unfinished claims expire after 24 h.
- **Conquered words:** health = min(FSRS memory, control). They can be practised only when due or threatened (below 90%). Clicking a solid one opens `WordInfo`.
- **Influence:** frontier words turn hostile after 24 h and drain neighbours along links (scaled by link weight). Conquered neighbours and levelled verbs give support. Below 30% control a word rebels; at 0 it's lost (back to hostile frontier). Flows are drawn as red/green chevrons.
- **Tiers** come from word frequency or a `tier`/`level` column (CEFR names in `graph.params.tier_names`). Verbs also gate tiers; the header tier badge opens the verb list.
- **Roots** shared by 2+ words are hexagon hubs, sealed until you name the meaning. Unlocking one shows its English cousins and opens all its words.
- **Map:** the layout is organic (force simulation). Invisible same-category springs gather discovered words, and territories are fused metaballs whose size grows with word strength.

## Pipeline notes

- **Meaning score:** ConceptNet Numberbatch on the English gloss, which captures association (dog→bark). Sentence-embedding models only capture likeness and did worse in a labelled benchmark; `--model BAAI/bge-m3` still works.
- **Links:** score = 0.6 semantic + 0.25 same stem + 0.25 shared root + 0.15 same theme. Edges are a tier-respecting maximum spanning tree plus top-3 bonus links scoring ≥ 0.25. Lists with themes use them as regions, else Louvain communities (`layout.py`).
- **Etymology:** hand-curated columns in `words.csv` (root, root_lang, root_meaning, cognate, cognate_note). Generated lists use Wiktionary (kaikki.org) with deliberately conservative root-family rules: homographs produced wrong families, and a wrong etymology is worse than none.
- **Conjugations:** `conjugate.py` reads Wiktionary forms. Stress accents are normalised, passato prossimo is built from auxiliary + participle, reflexives are handled, and `-sene` verbs are skipped.
- **Caches** (~1.3 GB, auto-downloaded) live in `~/.cache/sprawl/`: Numberbatch, kaikki Italian/Latin/English, frequency lists, pickled indexes. Delete an `*.pkl` to rebuild its index.
- `data/words_oic.csv` / `graph_oic.json` are scraped from onlineitalianclub.com: git-ignored, personal study only.

## Conventions

- Rust stays a thin shell; logic lives in TS.
- Commit after each feature with a descriptive message (co-author trailer). The remote `origin` is the author's **personal** GitHub (`mcaldera/lexinet`), never the ProxygenTx org. Ask before pushing.
- Match the surrounding style; comments explain why, not what. Prettier (single quotes, width 100): run `npx prettier --write src` after edits. It reflows lines, so re-read before making exact-string edits.
- Keep CLAUDE.md current when rules or architecture change.

## Known issues / ideas not done

- The Tauri desktop build has never been compiled here; the web build is what's tested.
- Inspect mode with 1500+ words is dense (organic layout); the category pull could be stronger.
- Arrow keys do nothing when no word lies in that direction (no feedback).
- Cooldown locks reset on reload; notices are ephemeral.
- Generated word lists have no per-word English cousins (only root-level examples), and some of their region names and glosses are clumsy.
- `docs/DOGFOOD_LOG.md` is still empty.
