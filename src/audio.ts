/**
 * Music and sound effects, synthesised with the Web Audio API (no files).
 * Music: a slow, quiet ambient loop (soft pads, sparse plucked notes, reverb),
 * off by default. Effects: short "mobile game" blips and chimes, on by default.
 * Settings persist in localStorage. The audio context starts on the first
 * user gesture (browsers block audio before that).
 */
import { isTouch } from './platform';

export type Sfx =
  | 'select'
  | 'blocked'
  | 'correct'
  | 'learn'
  | 'miss'
  | 'conquer'
  | 'reveal'
  | 'ready'
  | 'lost'
  | 'verbUp'
  | 'levelUp'
  | 'achievement'
  | 'plant'
  | 'alarm'
  | 'fanfare';

/** `speech`: say Italian words aloud automatically (see speech.ts). */
type Settings = { music: boolean; sfx: boolean; speech: boolean };
const KEY = 'sprawl.audio';

function load(): Settings {
  try {
    return {
      music: false,
      sfx: true,
      speech: true,
      ...JSON.parse(localStorage.getItem(KEY) ?? '{}'),
    };
  } catch {
    return { music: false, sfx: true, speech: true };
  }
}

let settings = load();
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private mode: settings just aren't remembered
  }
  listeners.forEach((f) => f());
}

export const audioSettings = () => settings;
export function onAudioSettings(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

// ---------------------------------------------------------------- the graph

type Graph = {
  ctx: AudioContext;
  sfx: GainNode;
  music: GainNode;
  /** The reverb's input (a convolver behind it, or feedback delays on a phone). */
  reverb: GainNode;
  analyser: AnalyserNode;
};
let graph: Graph | null = null;

/** Equal-tempered frequency of a MIDI note (69 = A4 = 440 Hz). */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function ensure(): Graph | null {
  if (graph) {
    if (graph.ctx.state === 'suspended') void graph.ctx.resume();
    return graph;
  }
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  // A phone's audio thread misses its deadlines while the map redraws (the music
  // dropped out): bigger buffers there, half the sample rate (ambient pads and
  // plucks need no more) and a cheap reverb instead of the convolver.
  const touch = isTouch();
  const ctx = new AC(touch ? { latencyHint: 'playback', sampleRate: 24000 } : undefined);
  const master = ctx.createDynamicsCompressor();
  const analyser = ctx.createAnalyser();
  master.connect(analyser).connect(ctx.destination);
  const sfx = ctx.createGain();
  sfx.gain.value = 0.5;
  sfx.connect(master);
  const music = ctx.createGain();
  music.gain.value = 0;
  music.connect(master);
  const reverb = ctx.createGain();
  const wet = ctx.createGain();
  wet.connect(master);
  if (touch) {
    // Four damped feedback delays (a Schroeder reverb), ~2 s of tail: a few
    // multiplications per sample, where convolving with an impulse is thousands.
    wet.gain.value = 0.12;
    for (const d of [0.05, 0.063, 0.07, 0.074]) {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = d;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2500;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.82;
      reverb.connect(delay).connect(damp).connect(feedback).connect(delay);
      damp.connect(wet);
    }
  } else {
    // A few seconds of decaying noise as the impulse response.
    const conv = ctx.createConvolver();
    const len = ctx.sampleRate * 3.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    conv.buffer = ir;
    wet.gain.value = 0.35;
    reverb.connect(conv).connect(wet);
  }
  graph = { ctx, sfx, music, reverb, analyser };
  // No music in a background tab.
  document.addEventListener('visibilitychange', () => {
    if (!graph) return;
    if (document.hidden) void graph.ctx.suspend();
    else void graph.ctx.resume();
  });
  return graph;
}

/** Loudness of everything playing right now (RMS 0..1), e.g. for checks. */
export function outputLevel(): number {
  if (!graph) return 0;
  const buf = new Float32Array(graph.analyser.fftSize);
  graph.analyser.getFloatTimeDomainData(buf);
  return Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
}

type ToneOpts = {
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  /** Frequency to glide to over the note. */
  slideTo?: number;
  out?: AudioNode;
  reverb?: number;
};

/** One enveloped note. `at` is in seconds from now. */
function tone(g: Graph, freq: number, at: number, dur: number, o: ToneOpts = {}) {
  const t = g.ctx.currentTime + at;
  const osc = g.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + dur);
  const env = g.ctx.createGain();
  const vol = o.vol ?? 0.2;
  const attack = o.attack ?? 0.005;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(o.out ?? g.sfx);
  if (o.reverb) {
    const send = g.ctx.createGain();
    send.gain.value = o.reverb;
    env.connect(send).connect(g.reverb);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// D major, to sit with the music.
const D5 = 74;
const SFX: Record<Sfx, (g: Graph) => void> = {
  select: (g) => tone(g, 1320, 0, 0.04, { vol: 0.06 }),
  blocked: (g) => tone(g, 260, 0, 0.09, { type: 'triangle', vol: 0.12 }),
  correct: (g) => {
    tone(g, hz(D5 + 7), 0, 0.12, { vol: 0.14, reverb: 0.2 });
    tone(g, hz(D5 + 12), 0.08, 0.22, { vol: 0.14, reverb: 0.3 });
  },
  learn: (g) => {
    tone(g, hz(D5 + 7), 0, 0.12, { vol: 0.08, reverb: 0.3 });
    tone(g, hz(D5 + 4), 0.1, 0.25, { vol: 0.08, reverb: 0.3 });
  },
  miss: (g) => {
    tone(g, 220, 0, 0.28, { type: 'triangle', vol: 0.16, slideTo: 130 });
    tone(g, 110, 0, 0.3, { vol: 0.1, slideTo: 80 });
  },
  conquer: (g) => {
    [0, 4, 7, 12].forEach((s, i) =>
      tone(g, hz(D5 + s), i * 0.07, 0.25, { type: 'triangle', vol: 0.12, reverb: 0.3 }),
    );
    [12, 16, 19].forEach((s) => tone(g, hz(D5 + s), 0.3, 0.9, { vol: 0.07, reverb: 0.5 }));
  },
  reveal: (g) => {
    tone(g, 600, 0, 0.07, { vol: 0.1, slideTo: 1000 });
    tone(g, 750, 0.09, 0.07, { vol: 0.1, slideTo: 1250 });
  },
  ready: (g) => {
    tone(g, hz(D5 + 19), 0, 0.8, { vol: 0.07, reverb: 0.5 });
    tone(g, hz(D5 + 31), 0, 0.5, { vol: 0.03, reverb: 0.5 });
  },
  lost: (g) =>
    [7, 3, 0, -5].forEach((s, i) =>
      tone(g, hz(D5 - 12 + s), i * 0.14, 0.35, { type: 'triangle', vol: 0.12, reverb: 0.3 }),
    ),
  verbUp: (g) => {
    [0, 4, 7, 12, 16].forEach((s, i) =>
      tone(g, hz(D5 + s), i * 0.09, 0.3, { type: 'square', vol: 0.05, reverb: 0.3 }),
    );
    [12, 16, 19, 24].forEach((s) => tone(g, hz(D5 + s), 0.5, 1.4, { vol: 0.06, reverb: 0.6 }));
    for (let i = 0; i < 8; i++)
      tone(g, hz(D5 + 24 + i * 2), 0.5 + i * 0.05, 0.2, { vol: 0.03, reverb: 0.6 });
  },
  achievement: (g) => {
    // A bright "ta-daa": two quick notes, then a sparkling chord.
    tone(g, hz(D5 + 7), 0, 0.12, { type: 'triangle', vol: 0.1, reverb: 0.3 });
    tone(g, hz(D5 + 12), 0.1, 0.12, { type: 'triangle', vol: 0.1, reverb: 0.3 });
    [12, 16, 19, 24].forEach((s) => tone(g, hz(D5 + s), 0.22, 1.1, { vol: 0.06, reverb: 0.6 }));
    for (let i = 0; i < 6; i++) tone(g, hz(D5 + 24 + i * 3), 0.25 + i * 0.04, 0.15, { vol: 0.025 });
  },
  plant: (g) => {
    // A soft rising "bloop" with a leafy shimmer.
    tone(g, 300, 0, 0.18, { vol: 0.12, slideTo: 700 });
    tone(g, hz(D5 + 16), 0.15, 0.6, { vol: 0.05, reverb: 0.5 });
  },
  alarm: (g) => {
    // A pop quiz strikes: three quick two-tone calls over a low hit.
    tone(g, 90, 0, 0.5, { type: 'triangle', vol: 0.2, slideTo: 45 });
    for (let i = 0; i < 3; i++) {
      tone(g, hz(D5 + 12), i * 0.24, 0.11, { type: 'square', vol: 0.05, reverb: 0.25 });
      tone(g, hz(D5 + 7), i * 0.24 + 0.12, 0.11, { type: 'square', vol: 0.05, reverb: 0.25 });
    }
  },
  fanfare: (g) => {
    // A passed quiz: a bright brass run up to a held major chord, then sparkle.
    [0, 4, 7, 12].forEach((s, i) =>
      tone(g, hz(D5 + s), i * 0.09, 0.2, { type: 'sawtooth', vol: 0.035, reverb: 0.3 }),
    );
    [0, 7, 12, 16, 19].forEach((s) =>
      tone(g, hz(D5 + s), 0.4, 1.6, { type: 'triangle', vol: 0.06, reverb: 0.6 }),
    );
    for (let i = 0; i < 8; i++)
      tone(g, hz(D5 + 24 + ((i * 5) % 12)), 0.5 + i * 0.07, 0.18, { vol: 0.03, reverb: 0.6 });
  },
  levelUp: (g) => {
    const phrase = [0, 4, 7, 4, 7, 12];
    phrase.forEach((s, i) =>
      tone(g, hz(D5 + s), i * 0.12, 0.28, { type: 'square', vol: 0.05, reverb: 0.3 }),
    );
    [0, 4, 7, 12, 16].forEach((s) => tone(g, hz(D5 + s), 0.75, 1.8, { vol: 0.06, reverb: 0.6 }));
  },
};

export function sfx(name: Sfx) {
  if (!settings.sfx) return;
  const g = ensure();
  if (g) SFX[name](g);
}

// ---------------------------------------------------------------- music

/** Dmaj7 · Bm7 · Gmaj7 · A6sus: calm, a little Mediterranean-summer. */
const CHORDS = [
  [50, 57, 61, 66],
  [47, 54, 57, 62],
  [43, 50, 54, 59],
  [45, 52, 54, 62],
];
/** D major pentatonic for the melody. */
const MELODY = [74, 76, 78, 81, 83, 86, 88];
const BAR = 8; // seconds per chord

let timer: number | undefined;
let bar = 0;

function playBar(g: Graph) {
  const chord = CHORDS[bar % CHORDS.length];
  bar++;
  for (const n of chord) {
    // Two slightly detuned voices per note make a soft pad.
    for (const detune of [-4, 4]) {
      const t = g.ctx.currentTime;
      const osc = g.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(n);
      osc.detune.value = detune;
      const lp = g.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const env = g.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.035, t + 2.5);
      env.gain.setValueAtTime(0.035, t + BAR - 1.5);
      env.gain.exponentialRampToValueAtTime(0.0001, t + BAR + 2);
      osc.connect(lp).connect(env);
      env.connect(g.music);
      env.connect(g.reverb);
      osc.start(t);
      osc.stop(t + BAR + 2.2);
    }
  }
  // Soft bass on the root.
  tone(g, hz(chord[0] - 12), 0, BAR, { vol: 0.05, attack: 1.5, out: g.music });
  // A few plucked notes at random places in the bar.
  for (let beat = 0; beat < 8; beat++) {
    if (Math.random() > 0.3) continue;
    const n = MELODY[Math.floor(Math.random() * MELODY.length)];
    tone(g, hz(n), beat + Math.random() * 0.2, 1.8, { vol: 0.025, out: g.music, reverb: 0.8 });
  }
}

function startMusic() {
  const g = ensure();
  if (!g || timer !== undefined) return;
  g.music.gain.cancelScheduledValues(g.ctx.currentTime);
  g.music.gain.setTargetAtTime(0.5, g.ctx.currentTime, 1.5); // well under the effects
  playBar(g);
  timer = window.setInterval(() => playBar(g), BAR * 1000);
}

function stopMusic() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  if (graph) graph.music.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.8);
}

export function setMusic(on: boolean) {
  settings = { ...settings, music: on };
  save();
  if (on) startMusic();
  else stopMusic();
}

export function setSfx(on: boolean) {
  settings = { ...settings, sfx: on };
  save();
  if (on) sfx('select');
}

export function setSpeech(on: boolean) {
  settings = { ...settings, speech: on };
  save();
}

/** Music that was on last time resumes at the first click (autoplay rules). */
export function resumeOnGesture() {
  if (!settings.music) return;
  const go = () => {
    window.removeEventListener('pointerdown', go);
    window.removeEventListener('keydown', go);
    if (settings.music) startMusic();
  };
  window.addEventListener('pointerdown', go);
  window.addEventListener('keydown', go);
}
