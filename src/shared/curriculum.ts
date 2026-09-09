import type { LearnableTarget } from './graph/types';

/**
 * Generic curriculum membership. A curriculum is whatever a language package
 * (or teacher data) DECLARES it to be: learnable targets grouped into buckets
 * of package-defined component scales. Core never merges scales by numeric
 * equality — vocabulary level 4 of the frequency scale and grammar level 4 of
 * the grammar scale are different buckets of different components — and never
 * hardcodes which components exist. A package may declare components this
 * file has never heard of.
 */
export interface CurriculumRequirement {
  /** Package-defined component scale id ('vocabulary', 'grammar', or package extension). */
  component: string;
  /** Bucket within the component's OWN scale (level number or package-defined id). */
  level: string | number;
  /** Stable display label (the word, pattern, character, …). */
  label: string;
  /** Graph-relative learnable target this requirement measures. */
  target: LearnableTarget;
  /** Optional package-defined weight; default 1. */
  weight?: number;
}

/** Measurement state of one curriculum target. Passive exposure is never measured progress. */
export type CurriculumTargetState = 'known' | 'learning' | 'unknown' | 'unmeasured';

export interface CurriculumBucketSummary {
  level: string | number;
  total: number;
  known: number;
  learning: number;
  unknown: number;
  /** No measurement — exposure or nothing at all. Never counted as progress. */
  unmeasured: number;
}

export interface CurriculumComponentSummary {
  component: string;
  buckets: readonly CurriculumBucketSummary[];
  total: number;
  known: number;
  learning: number;
  unknown: number;
  unmeasured: number;
  /** Every target measured at least once — mastery may still be low. */
  complete: boolean;
}

/**
 * Aggregates one component's requirements into per-bucket summaries. Bucket
 * order is the caller's (package-defined) level order; buckets absent from
 * `levelOrder` keep first-seen order after the known ones.
 */
export function summarizeCurriculumComponent(
  component: string,
  requirements: readonly CurriculumRequirement[],
  levelOrder: readonly (string | number)[],
  classify: (requirement: CurriculumRequirement) => CurriculumTargetState,
): CurriculumComponentSummary {
  const weightOf = (requirement: CurriculumRequirement): number => requirement.weight ?? 1;
  const buckets = new Map<string | number, CurriculumBucketSummary>();
  const bucketFor = (level: string | number): CurriculumBucketSummary => {
    let bucket = buckets.get(level);
    if (!bucket) {
      bucket = { level, total: 0, known: 0, learning: 0, unknown: 0, unmeasured: 0 };
      buckets.set(level, bucket);
    }
    return bucket;
  };
  for (const level of levelOrder) bucketFor(level);

  const totals = { total: 0, known: 0, learning: 0, unknown: 0, unmeasured: 0 };
  for (const requirement of requirements) {
    const state = classify(requirement);
    const weight = weightOf(requirement);
    const bucket = bucketFor(requirement.level);
    bucket.total += weight;
    totals.total += weight;
    bucket[state] += weight;
    totals[state] += weight;
  }

  const ordered = [...levelOrder, ...buckets.keys()];
  const seen = new Set<string | number>();
  const bucketList: CurriculumBucketSummary[] = [];
  for (const level of ordered) {
    if (seen.has(level)) continue;
    seen.add(level);
    const bucket = buckets.get(level);
    if (bucket) bucketList.push(bucket);
  }

  return {
    component,
    buckets: bucketList,
    ...totals,
    // A component with no declared requirements imposes nothing.
    complete: totals.unmeasured === 0,
  };
}
