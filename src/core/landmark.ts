import type { NodeState } from './unlock';

/**
 * Landmarks: a category where you hold enough conquered words builds one. It
 * stands while you keep them and shields the category's words (hostile and
 * rebel pressure on them is reduced, like a hint). Derived from state.
 */
export type LandmarkRules = { share: number; max: number };

/** Conquered words a category of `size` words needs for its landmark. */
export const landmarkNeed = (size: number, rules: LandmarkRules) =>
  Math.max(1, Math.min(rules.max, Math.ceil(size * rules.share)));

/** Categories whose landmark currently stands. */
export function landmarks(
  regions: { id: number; words: string[] }[],
  states: Map<string, NodeState>,
  rules: LandmarkRules,
): Set<number> {
  return new Set(
    regions
      .filter(
        (r) =>
          r.words.filter((w) => states.get(w) === 'conquered').length >=
          landmarkNeed(r.words.length, rules),
      )
      .map((r) => r.id),
  );
}

/** Words protected by a standing landmark (every word of its category). */
export function landmarkWords(regions: { id: number; words: string[] }[], built: Set<number>) {
  return new Set(regions.filter((r) => built.has(r.id)).flatMap((r) => r.words));
}
