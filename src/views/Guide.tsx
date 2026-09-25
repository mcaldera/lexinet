import {
  CLAIM_RECALL_GAP_MS,
  CLAIM_STEP_GAP_MS,
  COINS_PER_CONQUEST,
  DANGER_MS,
  EXPEDITION,
  HINT_COST,
  LANDMARK,
  RAID,
  TIER_MIN_WORDS,
  TIER_UNLOCK_FRACTION,
  INFLUENCE,
  PLANT_COST,
  RECLAIM_MS,
} from '../config';
import { BAND_COLOR, REASON_LABEL, REASON_RGB } from './visuals';

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
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 text-sm text-slate-300 shadow-2xl"
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
            {CLAIM_RECALL_GAP_MS / 60_000} min after that) to conquer it. A new word first comes as
            multiple choice; ⚡ type it instead and, if you knew it, it skips the waits: produce it
            straight away and it is yours.
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
            Won words push the horizon: words close enough appear as ghosts, then as <b>?</b>. Verbs
            push further, adjectives less; a familiar category carries further.
          </p>
        </Section>

        <Section title="Holding">
          <p>
            An unclaimed <b>?</b> turns hostile after {INFLUENCE.hostileAfterHours} h and wears down
            its conquered neighbours; conquered neighbours hold each other up. Below{' '}
            {Math.round(INFLUENCE.rebelBelow * 100)}% a word rebels, at 0 it is lost.
          </p>
          <p>
            A miss locks the word for a minute and puts fragile claims next to it in danger for{' '}
            {DANGER_MS / 60_000} min: win it back in time or they fall. Anything lost can be won
            back with one right answer for {RECLAIM_MS / 86_400_000} days.
          </p>
          <p>Names fade letter by letter as memory weakens: practise when a word is due.</p>
          <p>
            🏰 Hold {Math.round(LANDMARK.share * 100)}% of a category (at most {LANDMARK.max} words)
            and it builds a landmark: its words take less hostile pressure while it stands (+
            {LANDMARK.coins} 🪙 the first time).
          </p>
        </Section>

        <Section title="Events">
          <p>
            ⚑ Expedition (header): take {EXPEDITION.goal} words of one category (claimed counts)
            within {EXPEDITION.minutes} min for {EXPEDITION.coins} 🪙. Failing costs nothing.
          </p>
          <p>
            ⚔ Raids: now and then hostile words strike your weakest border words. Answer each one
            right within {RAID.durationMs / 60_000} min (click it in the raid box), or it loses{' '}
            {Math.round(RAID.hit * 100)}% control. Repelling a raid pays {RAID.coins} 🪙.
          </p>
          <p>🔥 Your streak counts the days you played; the calendar is in the 🏆 panel.</p>
        </Section>

        <Section title="Score and coins">
          <p>
            Each category scores 10 × conquered words × (1 + 2 × cohesion), where cohesion is the
            share of their links that stay inside the category.
          </p>
          <p>
            Coins: {COINS_PER_CONQUEST} per conquest, more for achievements. Spend them on a hint (
            {HINT_COST}: the English cousin, and half the hostile pressure) or on planting a hidden
            word next to one of yours (from {PLANT_COST}).
          </p>
          <p>
            Levels follow your run: the next opens at {Math.round(TIER_UNLOCK_FRACTION * 100)}% of
            your home category's words so far (at least {TIER_MIN_WORDS} per level), counting words
            of that level from anywhere, plus a few verbs conjugated (one new tense per day per
            verb). Your home category is open at every level. Several runs (☰ → Runs) let you keep
            separate campaigns.
          </p>
        </Section>

        <Section title="Map">
          <div className="space-y-1.5 text-xs">
            <div className={row}>
              <span className={item}>{dot(BAND_COLOR.solid)} strong</span>
              <span className={item}>{dot(BAND_COLOR.faded)} fading</span>
              <span className={item}>{dot(BAND_COLOR.dashed)} weak</span>
              <span className={item}>{dot(BAND_COLOR.cracked)} about to go</span>
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
              <span className="text-slate-400">◌ ghost: not in reach yet</span>
              <span className="text-slate-300">◯ next step opening</span>
              <span className="text-amber-300">◔ turns hostile</span>
              <span className="text-red-300">red: hostile, attacking</span>
              <span className="text-emerald-300">green: support</span>
              <span className="text-rose-300">rose: in danger</span>
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
