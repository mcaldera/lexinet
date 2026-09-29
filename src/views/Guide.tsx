import {
  CLAIM_KNOWN_GAP_MS,
  CLAIM_RECALL_GAP_MS,
  CLAIM_STEP_GAP_MS,
  COINS_PER_CONQUEST,
  EXPEDITION,
  HINT_COST,
  RAID,
  TIER_MIN_WORDS,
  VERB_POINTS_PER_TIER,
  TIER_UNLOCK_FRACTION,
  PLANT_COST,
  RECLAIM_MS,
  ROOTS,
  SUPPLY,
} from '../config';
import { BAND_COLOR, REASON_LABEL, REASON_RGB } from './visuals';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Everything the main screen leaves out: how the game works, what the map's
 * marks mean, and the keys. Opened from the menu or with "?".
 */
export default function Guide({ onClose }: { onClose: () => void }) {
  const dot = (color: string) => (
    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
  );
  const line = (rgb: string, dashed = false) => (
    <span
      className="inline-block w-4"
      style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} rgb(${rgb})` }}
    />
  );
  const row = 'flex flex-wrap gap-x-4 gap-y-1';
  const item = 'flex items-center gap-1.5';
  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel max-h-full w-full max-w-2xl overflow-y-auto bg-slate-900/90 p-5 text-sm text-slate-300 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-slate-100">How Sprawl works</h2>
          <button className="text-slate-500 hover:text-slate-200" onClick={onClose}>
            ✕
          </button>
        </div>

        <Section title="Conquering">
          <p>
            Click a <b>?</b> to claim it: say what it means. Then produce the Italian (
            {CLAIM_STEP_GAP_MS / 60_000} min later) and recall it once more (
            {CLAIM_RECALL_GAP_MS / 60_000} min after that) to conquer it. A new word asks you to
            type its meaning; typed right at first sight, it skips the long waits: produce it{' '}
            {CLAIM_KNOWN_GAP_MS / 1000} s later and it is yours. Not sure? ☰ Choose instead shows
            four meanings (no fast track, and no going back to typing).
          </p>
          <p>
            Reviews of your words sometimes fill the gap in a sentence. 🔊 says a word aloud (the
            menu switches automatic pronunciation off and picks the voice).
          </p>
          <p className="text-xs text-slate-400">
            Voices come from your system. No Italian voice in the menu? Windows: Settings → Time &
            language → Speech → Add voices → Italian. macOS: System Settings → Accessibility →
            Spoken Content → System voice → Manage Voices → Italian. Linux: install
            speech-dispatcher with espeak-ng. Chrome also offers an online “Google italiano” voice
            on Windows and macOS. Restart the browser afterwards.
          </p>
          <p>
            Every word next to one of yours is a <b>?</b> you can conquer. Faint ones lie outside
            your supply: won there, they are cut off from the start (see Supply).
          </p>
          <p>
            ⬢ A shared root appears once you conquer one of its words. It charges as more of its
            words come inside your supply and opens by itself at {ROOTS.open} (all of a smaller
            family): then every word of the family becomes a <b>?</b>, wherever it lies and at any
            level.
          </p>
        </Section>

        <Section title="Memory">
          <p>
            <b>Memory strength</b> (the dots, and the word's size on the map) is how long you'll
            remember a word. It grows only with spaced reviews, never by cramming. A word is{' '}
            <b>due</b> when your recall of it (its weaker direction) is down to 90%: its name starts
            to fade letter by letter. Each right answer makes the next gap longer (days, weeks,
            months); a miss makes it short again. Gold ★ are a verb's tenses.
          </p>
        </Section>

        <Section title="Supply">
          <p>
            Your words hold each other up. Every word you hold sends out <b>supply</b>, more the
            better you know it: {pct(SUPPLY.output[2])} when just conquered, {pct(SUPPLY.output[3])}{' '}
            after its first review, {pct(SUPPLY.output[4])} after a couple of weeks and{' '}
            {pct(SUPPLY.output[5])} after about seven weeks of right answers (a <b>stronghold</b>,
            with a tower). Verbs send out {pct(SUPPLY.perTense)} more per tense. Your capital, the
            first word, always sends out 100%.
          </p>
          <p>
            Each word's supply flows along links through your words, and each link passes on as much
            as it is strong (at most {pct(SUPPLY.maxLink)}). A word gets what reaches it from all
            your <i>other</i> words added up, so a word surrounded by words you know well is
            strongly held, while thin bridges between categories are costly. It needs{' '}
            {pct(SUPPLY.min)} to count. So a new word needs well-known words near it, and a few
            linked words far from home hold each other once you know them well.
          </p>
          <p>
            A word <b>breaks</b> when you miss it, or when you leave it due until its name has faded
            completely (recall {pct(SUPPLY.breakRecall)}). A broken word sends out and passes on no
            supply: whatever hangs on it is <b>cut off</b>. One right answer mends it, and
            everything behind it lights up again.
          </p>
          <p>
            Cut off, a word doesn't score and holds out as long as its memory lasts (at least a
            day), then falls back to <b>?</b>. Mend the gap, win or strengthen the words around it,
            or plant a link around it. Anything lost can be won back with one right answer for{' '}
            {RECLAIM_MS / 86_400_000} days.
          </p>
          <p>
            Chokepoints matter: a word's details say how many words hang on it. Keep those strong,
            or give their words a second way (another link, more words around them).
          </p>
        </Section>

        <Section title="Events">
          <p>
            ⚑ Expedition (header): take {EXPEDITION.goal} words of one category (claimed counts)
            within {EXPEDITION.minutes} min for {EXPEDITION.coins} 🪙. Failing costs nothing.
          </p>
          <p>
            ⚔ Raids: now and then a raid strikes a few of your words, chokepoints (the words the
            most hangs on) more often than others. Answer each one into Italian within{' '}
            {RAID.durationMs / 60_000} min (click it in the raid box), or it breaks. Repelling a
            raid pays {RAID.coins} 🪙.
          </p>
          <p>🔥 Your streak counts the days you played; the calendar is in the 🏆 panel.</p>
        </Section>

        <Section title="Score and coins">
          <p>
            Each category scores 10 × supplied words × (1 + 2 × cohesion), where cohesion is the
            share of their links that stay inside the category. Cut-off words don't score.
          </p>
          <p>
            Coins: {COINS_PER_CONQUEST} per conquest, more for achievements. Spend them on a hint (
            {HINT_COST}: the English cousin) or on planting a hidden word next to one of yours (from{' '}
            {PLANT_COST}): your link carries supply too.
          </p>
          <p>
            Levels follow your run: the next opens at {Math.round(TIER_UNLOCK_FRACTION * 100)}% of
            your home category's words so far (at least {TIER_MIN_WORDS} per level), counting words
            of that level from anywhere, plus {VERB_POINTS_PER_TIER} verb points per level: every
            tense you learn of a verb is a point (one new tense per day per verb), so one verb
            conjugated far counts as much as several conjugated a little. Your home category is open
            at every level. Several runs (☰ → Runs) let you keep separate campaigns.
          </p>
        </Section>

        <Section title="Map">
          <div className="space-y-1.5 text-xs">
            <div className={row}>
              <span className={item}>{dot(BAND_COLOR.solid)} strong</span>
              <span className={item}>{dot(BAND_COLOR.faded)} due</span>
              <span className={item}>{dot(BAND_COLOR.dashed)} fading</span>
              <span className={item}>{dot(BAND_COLOR.cracked)} broken</span>
              <span className={item}>{dot('rgba(100, 116, 139, 0.9)')} cut off</span>
              <span className={item}>{dot('rgba(71, 85, 105, 0.9)')} ? to conquer</span>
            </div>
            <div className={row}>
              <span>● noun</span>
              <span>▲ verb</span>
              <span>◆ adjective</span>
              <span>■ adverb</span>
              <span className="text-pink-300">⬢ shared root</span>
            </div>
            <div className={row}>
              <span className="text-emerald-300">◌ claimed (3 steps)</span>
              <span className="text-slate-300">◯ next step opening</span>
              <span className="text-amber-300">🏰 capital, stronghold</span>
              <span className="text-amber-200">gold pulses: supply lines</span>
              <span className="text-amber-100">glow: supply (brighter = more)</span>
              <span className="text-amber-200">◔ ring around a word: its supply (full = 100%)</span>
              <span className="text-orange-300">orange ring: thin supply</span>
              <span className="text-slate-400">faint ?: outside your supply</span>
              <span className="text-slate-300">◔ cut off: falls when it runs out</span>
              <span className="text-rose-300">rose: broken</span>
              <span className="text-teal-300">↺ win back</span>
              <span className="text-sky-300">ripple: needs you</span>
              <span className="text-amber-200">≈ hint</span>
              <span className="text-emerald-300">-·- planted</span>
            </div>
            <div className={row}>
              {(['semantic', 'thematic', 'morphological', 'etymological'] as const).map((r) => (
                <span key={r} className={item}>
                  {line(REASON_RGB[r])}
                  {REASON_LABEL[r]}
                </span>
              ))}
              <span className={item}>
                {line('148, 163, 184', true)}
                weak bridge
              </span>
            </div>
          </div>
        </Section>

        <Section title="Keys">
          <div className="grid grid-cols-2 gap-x-4 text-xs">
            <span>↑↓←→ move between words</span>
            <span>Enter open · next word</span>
            <span>N next word that needs you</span>
            <span>WASD pan · +/− zoom · F fit</span>
            <span>Esc leave the answer box</span>
            <span>? this guide</span>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 space-y-1.5 first-of-type:mt-0">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  );
}
