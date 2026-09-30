import {
  CLAIM_KNOWN_GAP_MS,
  CLAIM_RECALL_GAP_MS,
  CLAIM_STEP_GAP_MS,
  COINS_PER_CONQUEST,
  EXPEDITION,
  FAST_FORWARD,
  HINT_COST,
  RAID,
  OVERALL_SHARE,
  TOPIC_SHARE,
  VERB_POINTS_PER_TIER,
  PLANT_COST,
  RECLAIM_MS,
  ROOTS,
  SUPPLY,
} from '../config';
import { BAND_COLOR, REASON_LABEL, REASON_RGB } from './visuals';
import Icon from './Icon';

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
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-base font-semibold text-slate-100">How Plexus works</h2>
          <button className="icon-btn -mr-1.5 -mt-1" onClick={onClose} title="Close">
            <Icon name="x" />
          </button>
        </div>

        <Section title="Learning words">
          <p>
            Your words form a mind map: each one is linked to the words it belongs with. Click a{' '}
            <b>?</b> (a new word) and say what it means. Then produce the Italian (
            {CLAIM_STEP_GAP_MS / 60_000} min later) and recall it once more (
            {CLAIM_RECALL_GAP_MS / 60_000} min after that): it is learned. Typed right at first
            sight, a word skips the long waits: produce it {CLAIM_KNOWN_GAP_MS / 1000} s later and
            it is yours. Not sure? <i>Choose instead</i> shows four meanings (no fast track, and no
            going back to typing).
          </p>
          <p>
            Reviews of your words sometimes fill the gap in a sentence. The speaker button says a
            word aloud (the menu switches automatic pronunciation off and picks the voice).
          </p>
          <p className="text-xs text-slate-400">
            Voices come from your system. No Italian voice in the menu? Windows: Settings → Time &
            language → Speech → Add voices → Italian. macOS: System Settings → Accessibility →
            Spoken Content → System voice → Manage Voices → Italian. Linux: install
            speech-dispatcher with espeak-ng. Chrome also offers an online “Google italiano” voice
            on Windows and macOS. Restart the browser afterwards.
          </p>
          <p>
            Every word next to one of yours is a <b>?</b> you can learn. Faint ones are out of reach
            until a word next to them is yours; a <b>?</b> with little signal starts disconnected
            (see Signal).
          </p>
          <p>
            A shared root (a pink hexagon) appears once you learn one of its words. It charges as
            more of its words get signal and <b>clicks</b> by itself at {ROOTS.open} (all of a
            smaller family): then every word of the family becomes a <b>?</b>, wherever it lies and
            at any level.
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
          <p>
            A word's card shows its memory as a bar: from its last review to when it is due (the
            tick) and when it slips (the end), with how far along you are now. Next to the dots: how
            many right answers, each given when due, take it to the next strength level.
          </p>
        </Section>

        <Section title="Signal">
          <p>
            Your words hold each other up. Every word you know sends out <b>signal</b> along its
            links, more the better you know it: {pct(SUPPLY.output[2])} when just learned,{' '}
            {pct(SUPPLY.output[3])} after its first review, {pct(SUPPLY.output[4])} after a couple
            of weeks and {pct(SUPPLY.output[5])} after about seven weeks of right answers (an{' '}
            <b>anchor</b>, with gold rays). Verbs send out {pct(SUPPLY.perTense)} more per tense.
            Your <b>core</b> word, the first one, always sends out 100%.
          </p>
          <p>
            Signal flows along links through your words, and each link passes on as much as it is
            strong (at most {pct(SUPPLY.maxLink)}). A word gets what reaches it from all your{' '}
            <i>other</i> words added up, so a word surrounded by words you know well is strongly
            held, while thin bridges between topics are costly. It needs {pct(SUPPLY.min)} to stay{' '}
            <b>connected</b>. So a new word needs well-known words near it, and a few linked words
            far from the rest hold each other once you know them well.
          </p>
          <p>
            A word <b>slips</b> when you miss it, or when you leave it due until its name has faded
            completely (recall {pct(SUPPLY.breakRecall)}). A word that slipped passes no signal on:
            whatever depends on it is <b>disconnected</b>. One right answer brings it back, and
            everything behind it lights up again.
          </p>
          <p>
            Disconnected, a word doesn't score and lasts as long as its memory does (at least a
            day), then <b>fades</b> back to <b>?</b>. Bring back the word that slipped, learn or
            strengthen the words around it, or connect a new word next to it. Anything faded can be{' '}
            <b>recovered</b> with one right answer for {RECLAIM_MS / 86_400_000} days.
          </p>
          <p>
            Some words carry many others: a word's card says how many words depend on it. Keep those
            strong, or give their words a second way (another link, more words around them).
          </p>
        </Section>

        <Section title="Events">
          <p>
            <b>Focus</b> (header): learn {EXPEDITION.goal} words of one topic (started ones count)
            within {EXPEDITION.minutes} min for {EXPEDITION.coins} sparks. Failing costs nothing.
          </p>
          <p>
            <b>Pop quiz</b>: now and then a few of your words are quizzed, the ones many words
            depend on more often than others. Answer each one into Italian within{' '}
            {RAID.durationMs / 60_000} min (click it in the quiz box), or it slips. Passing pays{' '}
            {RAID.coins} sparks.
          </p>
          <p>
            <b>Fast-forward</b>: when there is nothing to answer (new words aside) and a step, a
            locked word or a review opens within {FAST_FORWARD.horizonMs / 60_000} min, time runs up
            to {FAST_FORWARD.speed}× faster until it does, from a moment after your last answer (a
            word you answered comes back {FAST_FORWARD.sameWordMs / 1000} s later at the soonest).
            Reviews further off are never pulled forward: that would be cramming.
          </p>
          <p>Your streak counts the days you played; the calendar is in the score panel.</p>
        </Section>

        <Section title="Score and sparks">
          <p>
            Every connected word scores 10 points, plus 10 for each of its memory dots: the better
            you know your words, the higher your score. Words that slipped or are disconnected don't
            score until they are back. Two achievements count <b>cohesion</b>: the share of a
            topic's links that stay inside it.
          </p>
          <p>
            Sparks: {COINS_PER_CONQUEST} per word learned, more for achievements. Spend them on a
            word's English cousin ({HINT_COST}) or on connecting a hidden word to one of yours (from{' '}
            {PLANT_COST}): your link carries signal too.
          </p>
          <p>
            <b>Levels</b> (A1.1 … C1): every topic climbs its own. A topic's next level opens at{' '}
            {pct(TOPIC_SHARE)} of its words so far; only then do its harder words appear. Your{' '}
            <b>overall level</b> (the header) comes from the words you know across the whole network
            ({pct(OVERALL_SHARE)} of all words so far) plus {VERB_POINTS_PER_TIER} verb points per
            level: every tense you learn of a verb is a point (one new tense per day per verb), so
            one verb conjugated far counts as much as several conjugated a little. A topic may run
            at most one band (A1, A2, …) past your overall level: a lock in the level panel means it
            waits for you there. Several runs (Menu → Runs) keep separate games.
          </p>
        </Section>

        <Section title="Map">
          <div className="space-y-1.5 text-xs">
            <div className={row}>
              <span className={item}>{dot(BAND_COLOR.solid)} strong</span>
              <span className={item}>{dot(BAND_COLOR.faded)} due</span>
              <span className={item}>{dot(BAND_COLOR.dashed)} fading</span>
              <span className={item}>{dot(BAND_COLOR.cracked)} slipped</span>
              <span className={item}>{dot('rgba(100, 116, 139, 0.9)')} disconnected</span>
              <span className={item}>{dot('rgba(71, 85, 105, 0.9)')} ? new word</span>
            </div>
            <div className={row}>
              <span>● noun</span>
              <span>▲ verb</span>
              <span>◆ adjective</span>
              <span>■ adverb</span>
              <span className="text-pink-300">⬢ shared root</span>
            </div>
            <div className={row}>
              <span className="text-emerald-300">◌ learning (3 steps)</span>
              <span className="text-slate-300">◯ next step opening</span>
              <span className="text-amber-200">gold rays: core word, anchors</span>
              <span className="text-amber-200">gold pulses: signal paths</span>
              <span className="text-amber-100">light: signal (brighter = more)</span>
              <span className="text-amber-200">◔ ring around a word: its signal (full = 100%)</span>
              <span className="text-orange-300">orange ring: weak signal</span>
              <span className="text-slate-400">faint shapes: out of reach</span>
              <span className="text-slate-300">◔ disconnected: fades when it runs out</span>
              <span className="text-rose-300">rose: slipped</span>
              <span className="text-teal-300">↺ recover</span>
              <span className="text-sky-300">ripple: needs you</span>
              <span className="text-amber-200">≈ English cousin</span>
              <span className="text-emerald-300">-·- connected by you</span>
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
            <span>WASD pan · +/− zoom · F fit · R relax the layout</span>
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
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}
