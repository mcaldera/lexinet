import { claimNext, type Claim, type ClaimGaps } from './claim';
import { FULL_NAME } from './fade';
import type { NodeState } from './unlock';

/**
 * Why a word wants the player's attention, most urgent first:
 * danger: a claim about to fall after a miss, or the missed word to win back ·
 * ready: a claim step is open now · threat: hostile, rebelling or fading ·
 * new: just revealed and never tried.
 */
export type AttentionKind = 'danger' | 'ready' | 'threat' | 'new';
export const ATTENTION_ORDER: AttentionKind[] = ['danger', 'ready', 'threat', 'new'];
export type Attention = { id: string; kind: AttentionKind };

export type AttentionInput = {
  states: Map<string, NodeState>;
  claims: Map<string, Claim | undefined>;
  /** Displayed health of conquered words. */
  health: Map<string, number | null>;
  /** Hostile frontier words and rebelling conquered words. */
  hostile: Set<string>;
  /** Frontier words revealed recently and not visited yet. */
  fresh: Set<string>;
  nowMs: number;
  gaps: ClaimGaps;
  /** Words that can't be opened right now (wrong-answer lock). */
  blocked?: (id: string) => boolean;
  /** Endangered claims and the missed word each depends on (core/danger.ts). */
  danger?: Map<string, { from: string }>;
};

/** Words that need attention, sorted by urgency (see ATTENTION_ORDER). */
export function attentionList(input: AttentionInput): Attention[] {
  const { states, claims, health, hostile, fresh, nowMs, gaps } = input;
  const out: Attention[] = [];
  const rescuers = new Set([...(input.danger?.values() ?? [])].map((d) => d.from));
  for (const [id, st] of states) {
    if (st === 'locked') continue;
    // The missed word stays flagged while locked: that's where the clock is ticking.
    if (rescuers.has(id) || input.danger?.has(id)) {
      out.push({ id, kind: 'danger' });
      continue;
    }
    if (input.blocked?.(id)) continue;
    let kind: AttentionKind | null = null;
    if (st === 'claimed') {
      const next = claimNext(claims.get(id), gaps);
      if (next && next.opensAt <= nowMs) kind = 'ready';
    } else if (hostile.has(id)) {
      kind = 'threat';
    } else if (st === 'conquered' && (health.get(id) ?? 1) < FULL_NAME) {
      kind = 'threat';
    } else if (st === 'frontier' && fresh.has(id)) {
      kind = 'new';
    }
    if (kind) out.push({ id, kind });
  }
  return out.sort((a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind));
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
