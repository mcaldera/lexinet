import { claimNext, type Claim, type ClaimGaps } from './claim';
import type { NodeState } from './unlock';

/**
 * Why a word wants the player's attention, most urgent first:
 * broken: a held word you missed or let fade too far, a gap in your supply
 * (one right answer repairs it) · raid: a chokepoint under raid, to defend
 * with a right answer · ready: a claim step is open now · reclaim: a lost
 * word one answer wins back · due: a held word's review (or tense) is due ·
 * new: just revealed and never tried.
 */
export type AttentionKind = 'broken' | 'raid' | 'ready' | 'reclaim' | 'due' | 'new';
export const ATTENTION_ORDER: AttentionKind[] = [
  'broken',
  'raid',
  'ready',
  'reclaim',
  'due',
  'new',
];
export type Attention = { id: string; kind: AttentionKind };

export type AttentionInput = {
  states: Map<string, NodeState>;
  claims: Map<string, Claim | undefined>;
  /** Frontier words revealed recently and not visited yet. */
  fresh: Set<string>;
  nowMs: number;
  gaps: ClaimGaps;
  /** Broken held words and how many words hang on each (biggest gap first). */
  broken?: Map<string, number>;
  /** Words that can't be opened right now (wrong-answer lock). */
  blocked?: (id: string) => boolean;
  /** Words with a card due for review (the queue, which only serves nearby words). */
  due?: Set<string>;
  /** Lost words that one right answer still wins back (core/fallen.ts). */
  reclaim?: Set<string>;
  /** Raided words still to defend (core/raid.ts). */
  raid?: Set<string>;
};

/** Words that need attention, sorted by urgency (see ATTENTION_ORDER). */
export function attentionList(input: AttentionInput): Attention[] {
  const { states, claims, fresh, nowMs, gaps } = input;
  const out: Attention[] = [];
  for (const [id, st] of states) {
    if (st === 'locked') continue;
    // A broken word stays flagged while locked after the miss: the siege clock is ticking.
    if (st === 'conquered' && input.broken?.has(id)) {
      out.push({ id, kind: 'broken' });
      continue;
    }
    if (input.blocked?.(id)) continue;
    let kind: AttentionKind | null = null;
    if (input.raid?.has(id)) {
      kind = 'raid';
    } else if (st === 'claimed') {
      const next = claimNext(claims.get(id), gaps);
      if (next && next.opensAt <= nowMs) kind = 'ready';
    } else if (st === 'frontier' && input.reclaim?.has(id)) {
      kind = 'reclaim';
    } else if (st === 'conquered' && input.due?.has(id)) {
      kind = 'due';
    } else if (st === 'frontier' && fresh.has(id)) {
      kind = 'new';
    }
    if (kind) out.push({ id, kind });
  }
  const hang = (a: Attention) => (a.kind === 'broken' ? (input.broken?.get(a.id) ?? 0) : 0);
  return out.sort(
    (a, b) =>
      ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind) || hang(b) - hang(a),
  );
}

/** Words that went from hidden to "?" between two snapshots of the states. */
export function newlyRevealed(
  before: Map<string, NodeState>,
  after: Map<string, NodeState>,
): string[] {
  return [...after]
    .filter(([id, st]) => st === 'frontier' && (before.get(id) ?? 'locked') === 'locked')
    .map(([id]) => id);
}
