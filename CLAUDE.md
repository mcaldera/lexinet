# Sprawl (repo: lexinet)

Italian vocabulary trainer as a territory game. Words are nodes in a graph; answering a word correctly claims it and reveals its neighbours; memory (FSRS) plus a live influence game decide whether your territory holds. The author (Michael) is user #1 and iterates fast with feature requests.

`docs/PROPOSAL.md` is the original v0.1 plan. The project has since gone well beyond it at the author's request (tiers, verbs, influence game, claims, etymology, multiple word lists). Treat this file as the current source of truth; the proposal's "out of scope" list no longer binds.

## Stack

- React 19 + TypeScript + Vite 5 + Tailwind 3; graph: `react-force-graph-2d` (canvas); scheduling: `ts-fsrs` 4.x; tests: Vitest 2
- Tauri 2 shell in `src-tauri/` (thin, untested: this dev box has no Rust toolchain or webkit2gtk). Day-to-day the app runs in the browser.
- Persistence: SQLite. Tauri → `@tauri-apps/plugin-sql`; browser → `sql.js`, snapshotted to localStorage (key `sprawl.db`, or `sprawl-<graph>.db`; further runs `sprawl-<graph>~<run>.db`, see `src/runs.ts`)
- Offline pipeline: Python 3.13 in `pipeline/.venv` (sentence-transformers, networkx, pandas); never bundled

## Commands

- `npm run dev` (port 1420, forwarded by VS Code) · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
- `pipeline/.venv/bin/pytest -q pipeline/tests`
- **Main word list = the vocabulary folder** `data/vocab/<category>.yaml` (44 categories, ~2660 words; format in the `pipeline/vocab.py` docstring: one flow mapping per word, `it`/`en`/`pos` plus optional `pl`, `level`, `id`, `root`/`root_lang`/`root_meaning`, `cousin`, `links`/`unlink`, `note`). Build it with `pipeline/.venv/bin/python pipeline/build_vocab.py data/vocab -o data/graph_oic.json` (~1.5 min; `--check` only validates, `--enrich` first writes missing Wiktionary etymology into the files, review it there). The output keeps the name `graph_oic.json` so existing runs keep their progress (ids = slug of `it`, or the explicit `id` of a renamed word). Edit the YAML, never the JSON. Linking rules: see Pipeline notes.
- The vocabulary is the only word list (the old CSV lists "My words" and "1000 frequent words" and their scripts were removed, Sep 2026). `build_graph.py`, `make_wordlist.py`, `split_levels.py`, `examples.py`, `conjugate.py`, `english_roots.py` and `layout.py` remain as libraries of `build_vocab.py`. The app picks `graph_oic.json` by default (`GRAPH_NAMES[0]`); `src/db/test-graph.json` is only the repo tests' fixture.
- Example sentences (`example {it, en, blank}` per node): source Tatoeba pairs from manythings.org (`~/.cache/sprawl/ita-eng.zip`, CC-BY 2.0 FR). A sentence qualifies only if it contains the word's base form and its English contains the gloss (rules out homographs like "la porta" = brings); simplest (rarest word most common), then shortest, wins. `build_vocab.py` does this itself (2257 of 2663 words).
- Sources behind the vocabulary (`data/sources/`): `common_2000.tsv` (the author's "2000 most used words" table, raw, with its machine-translation errors), `oic_scraped.csv` (the old onlineitalianclub.com scrape) and `oic_fixes.csv` (the first round of corrections). The vocabulary was built from both lists by a word-by-word review (Sep 2026): junk, phrases, ambiguous words (very different meanings), long glosses, rare derivatives and plural duplicates were dropped or merged; 673 left out, 33 merged. They are history now; the YAML is the truth.
- Node is 18 on the dev box: keep deps Node-18 compatible (Vite 5, Vitest 2, ts-fsrs 4; ts-fsrs 5 needs Node 20).

## Verifying changes (how past sessions did it)

Typecheck + lint + tests, then a real browser run: `npm run build`, `npx vite preview --port 4173 --strictPort` (in the background), and a Playwright script in the session scratchpad using the cached Chromium at `~/.cache/ms-playwright/chromium_headless_shell-*/…/chrome-headless-shell` (scratch venv with `pip install playwright pillow numpy scipy`). Read answers from `data/graph_oic.json` to play. Pitfalls:

- A fresh DB shows the start picker: click a category button (or "Anywhere") first.
- The main graph is `?graph=oic` (the vocabulary). A never-seen word's step 1 starts typed (fast track); the button "☰ Choose instead" switches to multiple choice (buttons `1 <meaning>`) for good. Reviews into Italian of words with an example are fill-the-gap (`.border-b-2` gap; the gloss is in the small line).
- Time travel lives in the ☰ menu (`getByTitle('Menu')`, then `+15 min`). An idle card offers "Next word" (Enter), which walks the game without map clicks.
- Click `header h1` before keyboard input, not `header` (it contains buttons that swallow Enter).
- The view refits as the map grows until you pan or zoom; press `f` to refit.
- Locate nodes by their colour in screenshots.
- Stop the server with `fuser -k 4173/tcp`. `pkill -f` can kill your own shell.

## Architecture

```
data/vocab/*.yaml ─ pipeline/build_vocab.py ─► data/graph_oic.json ─┐
data/words*.csv ── pipeline/build_graph.py ─► data/graph*.json ─────┴► app (import.meta.glob in src/graphs.ts)
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
| `scheduler` | ts-fsrs wrapper (`enable_short_term: false`: no 1/10-minute learning re-asks, a right answer schedules days ahead; claims space their own steps), card (de)serialisation, `cardId(node, dir)` = `node:it-en` / `node:en-it` |
| `answer` | typed-answer checking: exact → Good; article/accent/small typo → Hard ("almost", still counts); else Again. `checkMeaning` is a lenient version (unused since roots open by reach). |
| `unlock` | node states `locked \| frontier \| claimed \| conquered`; `unlockChanges` (frontier → claimed) |
| `score` | per category: 10 × conquered words × (1 + 2 × cohesion), cohesion = links among its conquered words ÷ (those + links from them out of the category); `wordLinks` (a word's inside/outside links) |
| `achievements` | `ACHIEVEMENTS` (words, discovered, categories, verbs, cohesion, score, planting milestones, each paying coins); `newlyEarned(stats, earned)`. Earned ones are stored (meta `achievements`) and never taken back |
| `plant` | `plantOptions`: hidden words to plant next to a conquered word, from `graph.candidates` (strongest partners, linked or not) plus hidden same-category words, any tier, priced `PLANT_COST` + `PLANT_COST_PER_TIER` per tier beyond the open one (a paid way ahead), cheapest first |
| `fallen` | `recordFalls`, `reclaimable`, `reclaim` (see Game rules) |
| `danger` | a real miss: `missed` (a claimed word falls to hostile "?", its claimed neighbours get `danger {until, from}` for `DANGER_MS`), `rescue` (a correct answer on the missed word lifts its dangers), `dangerFalls` (deadline passed → they fall, one level, no chain) |
| `reach` | the horizon: conquered words push 1, claimed 0.45 per step (tuned by a time simulation so the start never stalls), the seed always 1, times a part-of-speech factor (verb 1.25, noun 1, adj/adv 0.8) plus 0.15 per verb level. Push fades over links (`REACH.decay` 1 / 0.5 / 0.1) and pushes add up. Inside a familiar region (≥ `familiarAt` conquered) each link carries up to 1.5×; a link into another region carries 0.7× (more once that region is familiar). Reach ≥ `sight` → ghost (`sightedWords`), ≥ `open` → "?" (`revealChanges`, which also opens the best ghost if nothing is left to do). `recedeChanges`: an untried "?" whose reach dropped below `open` goes back to a ghost (kept: seed, started, hostile, root-unlocked). Computed, never stored. `reachSources` explains a word's reach (details panel, rings on the map). |
| `claim` | conquest in 3 fixed steps: 1 Recognise (it→en, right away), 2 Produce (en→it, ≥ `CLAIM_STEP_GAP_MS` later), 3 Lock in (either way, ≥ `CLAIM_RECALL_GAP_MS` later). **Fast track** (`known`): step 1 right at first sight (never shown) means you knew it, so step 2 opens at once and conquers it. `claimNext` says which card is open when; answers out of turn add nothing. `unseen` = no card ever answered (first sight). |
| `choices` | `meaningChoices`: the answer plus decoys of the same part of speech (same category first), never overlapping the answer ("dog"/"small dog") or each other |
| `cloze` | `cloze(example)`: the sentence before/after the gap (whole-word match) |
| `landmark` | a category with `landmarkNeed` conquered words (50%, at most 12) has a standing landmark (`landmarks`, derived); `landmarkWords` are shielded like hints (`useSprawl.shielded` = hints ∪ landmark words, passed to `simulate`/`pressureBreakdown`). First build pays `LANDMARK.coins` once (meta `landmarks`). |
| `streak` | `dayKey` (local day), `streak` (current, alive through yesterday; best), `calendar` (weeks × Mon..Sun) |
| `expedition` | `planExpedition` (one of the 3 categories with the most "?"; goal ≤ words left; `EXPEDITION.minutes` app time), `expeditionStatus` (claimed/conquered since start count) |
| `raid` | `raidTargets` (conquered words next to hostile ones, weakest first), `raidStarts` (none active, `gapMs` since last, `chance`), `defend`, `raidStatus` (won / lost with undefended `hit`) |
| `start` | `startCandidates`/`pickStart`: a first word from a category's easiest tier, linked to ≥ 2 words of its category (or anywhere). `homeWords`: the start word's category, open at every level (`tierAllows(…, home)`). |
| `attention` | words that need the player, most urgent first: `danger`, `raid` (raided, undefended), `ready` (claim step open), `reclaim`, `due`, `threat` (hostile, rebelling, fading), `new` (revealed this visit, not opened yet) |
| `queue` | automatic queue: due reviews (weakest first), then the unreviewed 2nd direction, then learning cards; `productionFirst`: when both directions of a word wait, en→it comes first (the it→en prompt shows the answer). `openOrder`: a clicked word's cards in a fixed order, the card whose prompt is already on show first (App's `shown` ref), so reclicking can't switch direction to peek. Untouched frontier words never appear automatically. `closest` picks what "Next word" opens: an open claim step (or danger/win-back), else the nearest "?" (link distance + penalty 2). `nearby` keeps it local: App only serves cards of the selected word (`selectedId`, also set by answering) and words linked to it; otherwise it stays put and says how many are due elsewhere (attention kind `due`, N / jump bar). |
| `roots` | root hubs as hyperdrives: `rootCharge` (each family word counts its reach up to 1), `rootOpenings` (charge ≥ `rootNeed` = `ROOTS.open` 3, or the whole family if smaller). `useSprawl.horizon` opens them (only hubs with a conquered word, i.e. visible) and turns all their hidden words into "?" at any level; meta `unlocked_roots`. No quiz. |
| `health`, `fade` | health = mean retrievability; names erode letter by letter from 90% to 50%, then show "?" |
| `strength` | FSRS stability → level 0–5 ("memory strength", shown as blue dots with "lasts ~N", `MemoryDots` in NodeDetails; ★ are only for verb tenses); `nextPractice` (no cramming: practice only when due). Strength is armour: each level takes `INFLUENCE.strengthArmour` (10%) off hostile/rebel pressure (`simulate`/`pressureBreakdown` take a strength map). |
| `tiers` | campaign levels (`Campaign`): tier k+1 opens at `TIER_UNLOCK_FRACTION` (0.6) of the **home category's** words of tiers 1..k (at least `TIER_MIN_WORDS` × k), counting conquered words of tiers 1..k from anywhere plus all home words; plus `VERBS_PER_TIER` (2) verbs at `verbLevelFor(k)`. The home is fixed, so exploring never lowers a level. Without a campaign: the old share of all words. |
| `verbs` | tense levels (presente → passato prossimo → imperfetto → futuro → condizionale → congiuntivo), one new tense per 20 h, `nextDrill`, `checkConjugation` |
| `influence` | game layer: `control` per conquered word, hostile frontier (after 24 h grace or a wrong answer), rebels, lost words; `simulate` (1 h steps), `afterAnswer`, `pressureBreakdown`, `cohesion` |

### src/views

- `GraphView`: the canvas. Link tooltips say the two words, why they're linked and the link strength (%). Forces: charge −150, a collision force (`forceCollide` from `d3-force-3d`, radius 20 so names fit) and a gentle category pull (0.05), so a category spreads out instead of piling up. Layout is dynamic (the author preferred it to pinning everything): a dragged word stays where dropped. The whole network cools slowly (`d3AlphaDecay` 0.006, up to 2500 ticks) and then gets up to 3 `shake` rounds: words more than twice their region's spread from its centre jump back to it, everything gets a nudge, and the simulation reheats (escapes bad local optima). Switching to/from the whole network unpins and lays out afresh. Remounted per seed (`key`). Standing landmarks draw a gold tower over the region name (`drawTower`). The white ring (`activeId`) is always the word the side panel is about (`panelId` in App: wait card > verb drill > word card > review card); the dashed yellow ring is the keyboard cursor when it differs. Nodes, links, chevron particles, energy bands, cohesion glow, metaball territories (`drawRegions`), keyboard cursor, attention ripples, edge arrows to off-screen attention words (`drawPointers`, clickable) and the jump bar.
- `ReviewView`: the typed card, with the claim step indicator while conquering.
- `VerbDrill`: conjugation drill.
- `WordInfo`: card for a solid conquered word.
- `WaitCard`: the selected word can't be worked on right now (out of reach, locked after a miss, next claim step not open), or a root hub (charge, or meaning and cousins once open). The panel stays on it with a live countdown and offers a button once it's possible. A miss lands here too instead of jumping to the next card.
- `NodeDetails`: status panel under the main card (health, control, trend, per-neighbour breakdown, claim steps, verb, etymology).
- `VerbGoals`: "To reach <next level>: n/2 verbs conjugated in the <tense>" (conquering a verb isn't enough, it needs the tense drill). Lists found verbs of the open levels and of the home category (they count at any level, as home words do); undiscovered ones only as "+N not found yet".
- `InspectPanel`: spoiler view of the whole network. The map then switches to a galaxy style (`drawStar`, `drawStarfield`, softer nebula territories, thin hyperlanes lit for the selected word, compact root markers, no legend). Region names are drawn after everything (`drawRegionNames`, outlined, biggest first, nudged to avoid overlapping) in both views. Region colours come from `regionColors` (visuals.ts: 16-colour palette, strongly linked regions differ, palette spread evenly), not the pipeline's `color`. A `cluster` force pulls words to their region centre and pushes overlapping regions apart.
- `Menu` (☰ in the header): word list, music/sounds/say-words-aloud/roots/whole-network toggles, "How it works", time travel (+15 min / +1 day / +7 days / now), **Runs** (list with conquered counts, switch = reload, delete, + New run, Restart this run).
- `src/runs.ts`: run registry in localStorage `sprawl.runs` ({graph: {current, runs[{id, name, created, conquered, played}]}}). Run `main` keeps the pre-runs DB name. A run is named after its start category when picked. `useSprawl` reads the current run once at module load; switching reloads the page.
- `src/speech.ts`: pronunciation via `speechSynthesis` (it-IT voice, local preferred). `speakAuto` obeys the "Say words aloud" setting (`sprawl.audio.speech`). Italian on screen is spoken (it→en prompts, revealed answers), never an answer before it's revealed. `SpeakButton`/`ExampleLine` live in ReviewView.tsx.
- In App.tsx: `Missions` (top-left: expedition ⚑ progress/clock, raid ⚔ clock with clickable raided words) and `EventBanner` (raid, raid won/lost, expedition won/lost, landmark). Header: ⚑ starts an expedition, 🔥 streak (opens the 🏆 panel, which has the calendar).
- `Guide`: rules, scoring formula, map legend and keys (menu or `?`). The main screen carries no explanations; they live here.
- `StartPicker`: over the map while `data.started` is false (fresh DB or after New game): 🎲 Anywhere or a category.
- UI style: slim. Header = name · level chip (tooltip has the details) · 🏆/🪙 · ☰. Notices are short toasts at the bottom of the map. `NodeDetails` shows a line or two and folds numbers (influences, cohesion, push, reach) under "more". No `(enter)` hints except on Next word; no explanatory paragraphs in cards.
- Helpers: `Etymology`, `visuals.ts` (shapes, link colours), `useKeyboardCamera.ts`.
- `src/audio.ts`: music and sound effects synthesised with Web Audio (no files). Music is a slow D-major ambient loop (pads, sparse pentatonic plucks, reverb), off by default; effects (`sfx('select' | 'correct' | 'conquer' | 'miss' | …)`) are on by default. Header toggles; settings in localStorage `sprawl.audio`. The context starts on the first gesture and suspends in background tabs.

### Persistence

- Tables: `nodes(id, it, en, pos, theme, state)`, `edges`, `cards(id, node_id, direction, fsrs_json)`, `review_log`, `meta`.
- `cards.direction` is `it-en`/`en-it`, or `tense:<tense>` for verb tense cards (created on the first successful drill).
- Meta keys: `expedition` (current or null), `raid` ({active?, last}), `landmarks` ({regionId: first built at}), `seed` (chosen first word; absent = picker shows unless reviews exist), `debug_day_offset`, `unlocked_roots` (JSON array), `game` (JSON: `simAt` plus per-node `{control, since, hostileUntil, claim, danger, fallen}`), `achievements` ({id: at}), `coins` (number; read from `seeds` for older saves), `user_edges` (planted links), `hints` (word ids).
- In memory only (lost on reload): cooldown locks (app time, so time travel lifts them), notices, open sessions. Danger deadlines live in `game` (persisted).
- sql.js exports the whole DB on every `execute`, so batch writes (multi-row INSERT, or one JSON value) instead of many small statements.

## Game rules (current)

- **Start:** a new game asks where to begin (a category, or anywhere); `pickStart` chooses the first word. The start word's category is open at every level, so any category gives a full start (reach still decides what appears).
- **Campaigns and runs:** levels follow the home category (see `tiers`), so a run can stay in one topic. Several runs per word list (menu → Runs).
- **Flow:** an idle card (nothing due here, or a word waiting/locked) offers "Next word" (Enter): an open claim step first, else the nearest "?".

- **Claiming:** click a "?" (or move to it with the arrow keys) to get step 1, Italian → English. A correct answer makes it **claimed** (fragile). Step 2 (English → Italian) opens 1 min later and step 3 (either way) 5 min after that. A never-seen word's step 1 always starts typed; typed right at first sight = you knew it: step 2 opens right away and conquers it (fast track). "☰ Choose instead" shows four meanings (keys 1–4) one way: no fast track and no going back to typing.
- **Examples:** reviews of conquered words into Italian are fill-the-gap when the word has an example (the gap's form or the full word both count); every revealed answer shows the example with 🔊.
- **Answers:** English alternatives separated by " / " are all accepted, and a note in brackets need not be typed ("clubs (card suit)" → "clubs"). A noun's plural (`pl`, one node for both forms) typed for the English prompt counts as almost ("Singular: …"); reveals and word cards show "pl. …".
- **Landmarks, expeditions, raids, streak:** see `landmark`, `expedition`, `raid`, `streak` above. Raids strike after a right answer (15%, ≥ 20 min apart) when conquered words border hostile ones: up to 3 targets, 3 min to answer each right (raided words can always be practised, always en→it: the raid bar names them in English and the queue holds back their it→en card); undefended ones lose 40% control; repelled = +3 coins. Expedition: 5 words of one category in 10 min, +10 coins. Clicks and the automatic queue only offer the open step. A never-seen word offers "Show me", which is not penalised.
- **Visual feedback:** territory grows with every claim step (and more on conquest and with verb levels). Claim steps, conquests and verb levels flash a burst on the map. A verb level also shows a gold banner, and the verb gets bigger with a gold outline and "★ tense" under its name. Link width follows the weight's rank in the graph (raw weights bunch up in 0.25–0.6). Blue flows run from won words into ghosts, and selecting a word rings the words that push it. Conquered words show their root (pink) when zoomed in; etymology is in the status panel except while the word is being asked. The legend is in the guide.
- **Reach and ghosts:** words are revealed by reach (see `core/reach.ts`), not by simply being next to a claimed word. Hidden words with a little reach show as ghosts with a ring filling towards conquerable. Clicking one says how far it is. A claimed word waiting for its next step has a white countdown ring.
- **Names are earned:** a word's Italian name appears on the map only once it is conquered. It is also hidden (map, tooltip, status panel) while it is the answer being asked. While an en→it card of it is due (or it is raided) the name shows only about a third of its letters (`hintedName`, `RECALL_NAME` in `core/fade`), so the map doesn't give the answer away before the card opens. Claimed words show "?" with a 3-segment ring.
- **Attention:** ready claim steps (green), threats (red) and newly revealed words (light blue) ripple. Off-screen ones get arrows at the view edge, and the top-right jump bar or `N` cycles through them. A due card for an off-screen word pans the camera to it.
- **Score, achievements, coins:** header 🏆 score · 🌱 coins opens the progress panel (score per category, achievements). Coins: +`COINS_PER_CONQUEST` per real conquest (not a win-back) plus achievement rewards. **Planting** (from `PLANT_COST` coins, more for later levels): on a conquered word's details, "🌱 Plant a word" opens `PlantPicker` (options by English meaning). The chosen hidden word becomes "?" next to it, joined by a player link (`via: 'user'`, meta `user_edges`, merged into `data.edges`, so it counts for reach, influence and score). Drawn as a green dash-dot link.
- **Hints:** for `HINT_COST` coins a visible word shows its English cousin (`cognate`) as a small amber node tied to it (meta `hints`, not an edge: no score, no reach). The word is shielded: hostile/rebel pressure on it × `INFLUENCE.hintShield` (0.5), so hints defend border words. Words without a curated `cousin` get one from the pipeline (`pick_cognate`: the root's English descendant that looks like the word and relates to its meaning; precision over coverage).
- **Lost is not forgotten (`core/fallen.ts`):** a conquered or claimed word that falls back to "?" (influence loss, expired claim, danger, miss) keeps `fallen {was, steps, at}` on its game node. For `RECLAIM_MS` (3 days app time) one right answer restores it as it was (conquered, or the claim with its steps done as of now); teal ↺ ring on the map, attention kind `reclaim`, "Winning back" banner. After that it's fully lost.
- **Misses:** a real miss locks the word for 60 s (app time) and makes it hostile; a claimed word falls back to "?". Its claimed neighbours are **in danger** for 3 min (rose ring with countdown, rose link, top of the attention list): winning the missed word back (or answering the endangered word) saves them, otherwise they fall. The horizon then recedes where reach dropped. Unfinished claims expire after 24 h.
- **Conquered words:** clicking or jumping to one practises only its due cards (or its weakest card when it's fading but not due), never the not-due other direction. Conquest graduates both FSRS cards (the unanswered direction gets a Good too, unlogged via `saveCard`), so a new conquest isn't asked again at once. Health ("Hold" bar in the status panel) = min(FSRS recall now, control); its tooltip splits the two. They can be practised only when due or threatened (below 90%). Clicking a solid one opens `WordInfo`.
- **Influence:** frontier words turn hostile after 24 h and drain neighbours along links (scaled by link weight). Conquered neighbours and levelled verbs give support. Below 30% control a word rebels; at 0 it's lost (back to hostile frontier). Flows are drawn as red/green chevrons.
- **Tiers** come from word frequency or a `tier`/`level` column (CEFR names in `graph.params.tier_names`). Verbs also gate tiers; the header tier badge opens the verb list.
- **Roots** shared by 2+ words are hexagon hubs, shown once one of their words is conquered. A sealed hub charges (pink ring) as its words come into reach and opens by itself at 3 (see `roots`): its English cousins show and all its words become "?" anywhere on the map (a hyperdrive). Clicking a hub shows a wait card with its charge or meaning.
- **Map:** the layout is organic (force simulation). Invisible same-category springs gather discovered words, and territories are fused metaballs whose size grows with word strength.

## Pipeline notes

- **Meaning score:** ConceptNet Numberbatch on the English gloss (hyphens become underscores: `mother_in_law`, `great_grandmother` are phrase vectors), which captures association (dog→bark). Sentence-embedding models only capture likeness and did worse in a labelled benchmark; `--model BAAI/bge-m3` still works.
- **Categories:** the vocabulary's 44 files (`vocab.CATEGORIES`, map order = related categories adjacent), every word in exactly one. CSV lists: their themes; untagged words join a theme only if they clearly fit (`THEME_FIT` 0.45, `THEME_MARGIN` 0.1), else stay **independent** (`region: null`).
- **Vocabulary links (`build_vocab.py`):** (1) per category a tier-respecting spanning tree plus each word's top 2 partners there from 0.35 (score 0.7 meaning + 0.5 family + 0.15 same category); (2) families: a shared root always, a shared stem only when the meanings relate (≥ 0.25: la cucina/cucinare yes, la casa/il caso no), each member linked to its closest more common relative; (3) at most one direct bridge per word to another category, same part of speech, meaning ≥ `BRIDGE_MIN` 0.55, never when the two English glosses share a word (English homographs: il diritto "right"/la destra "right", il disegno "drawing"/trarre "to draw") or rest on an ambiguous English word (`AMBIGUOUS`: will, can, show, close…); (4) categories joined into one map by their best low-tier bridges; (5) **male/female pairs** (`counterparts`: any meaning of the gloss swaps into one of the other's, mother↔father, "child / little boy"↔"little girl" via `GENDER_PAIRS`, or Italian -o/-a, -e/-a, -tore/-trice, -e/-essa with the same main meaning, il cugino/la cugina "cousin"; both kinds of evidence together win) are linked and share their links: a link to another pair member is mirrored onto its counterpart; a link to an unpaired word is copied unless it is a family (root/stem) link (la sorella – la suora stays hers) or that word's English is gendered (la figlia – la signorina "young lady"); (6) YAML `links`/`unlink` win. `via`: tree/theme/family/bridge/manual. Tiers: each word's CEFR `level` (or its frequency: `vocab.word_rank` = most common inflected form in subtitles, `LEVEL_BY_RANK`) split into 10 even sub-levels A1.1…
- **CSV-graph links (`build_graph.py`):** score = 0.6 semantic + 0.25 same stem + 0.25 shared root + 0.15 same theme. Edges are a tier-respecting maximum spanning tree plus top-3 bonus links scoring ≥ 0.25. Lists with themes first assign untagged words to a theme, then add in-category links (`via: 'theme'`): a tier-respecting spanning tree per category plus each word's top 2 partners there from 0.3, so no category falls apart (OIC went from 266 pieces in 31 categories to 31). In the app, links between categories are twice as long and 0.3× as strong in the force layout. Lists with themes use them as regions, else Louvain communities (`layout.py`).
- **English cousins (hints):** a generated cousin must look like the word *and* evoke its meaning (Numberbatch similarity to the gloss ≥ `COGNATE_MIN_RELATED` 0.18, and not be the gloss itself): pancia → panzer, testa → test, letto → lecture are out. Root hubs keep only English words related to the root's meaning or one of its words (`HUB_MIN_RELATED`).
- **Etymology:** hand-curated columns in `words.csv` (root, root_lang, root_meaning, cognate, cognate_note). Generated lists use Wiktionary (kaikki.org) with deliberately conservative root-family rules: homographs produced wrong families, and a wrong etymology is worse than none.
- **Conjugations:** `conjugate.py` reads Wiktionary forms. Stress accents are normalised, passato prossimo is built from auxiliary + participle, reflexives are handled, and `-sene` verbs are skipped.
- **Caches** (~1.3 GB, auto-downloaded) live in `~/.cache/sprawl/`: Numberbatch, kaikki Italian/Latin/English, frequency lists, pickled indexes. Delete an `*.pkl` to rebuild its index.
- `data/vocab/`, `data/sources/` and `graph_oic.json` are git-ignored (partly derived from the onlineitalianclub.com scrape and a third-party frequency table: personal study only). Whether to track the vocabulary in git is the author's call.

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
