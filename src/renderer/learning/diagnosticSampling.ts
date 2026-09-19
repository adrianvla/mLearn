/**
 * Category-balanced adaptive diagnostic sampling (R09).
 *
 * A placement probe samples a small representative cross-section across
 * categories (package-owned level bands), expands around discovered gaps,
 * and STOPS when further checks could no longer change the recommendation:
 *
 * - First pass draws one item per category (balanced), in pool order.
 * - A category becomes `secure` after `secureStreak` consecutive hits
 *   (likely-secure areas are bypassed — never fully rerated), `gap` after
 *   `gapConfirm` misses, `mixed` once its sample cap is reached.
 * - Only undecided categories keep drawing items; gaps expand first.
 * - The session ends when every category is decided, the global budget is
 *   reached, or a stable placement exists and every remaining undecided
 *   category sits BELOW it (sampling lower bands cannot raise placement).
 *
 * HONESTY BOUND (R09/R20): this is an explainable heuristic, not a
 * calibrated measurement. Sampled items produce real canonical evidence via
 * the caller; every UNSAMPLED item stays unmeasured — group results select
 * and recommend, they never certify or claim anything about unsampled
 * targets. Deterministic by design: pool order is the caller's responsibility.
 */

export type DiagnosticQuality = 'fluent' | 'struggled' | 'missed';

export interface DiagnosticCategory {
  /** Stable id (e.g. the raw_level as string). */
  id: string;
  /** Package-owned display label. */
  label: string;
  /** Candidate keys, caller-chosen order; the sampler never reorders. */
  items: readonly string[];
}

export interface DiagnosticConfig {
  /** Consecutive hits that mark a category likely-secure. */
  secureStreak: number;
  /** Misses that mark a category a gap. */
  gapConfirm: number;
  /** Max items drawn from one category. */
  categoryCap: number;
  /** Global sampling budget. */
  maxTotal: number;
}

export const DIAGNOSTIC_DEFAULTS: DiagnosticConfig = {
  secureStreak: 3,
  gapConfirm: 2,
  categoryCap: 5,
  maxTotal: 14,
};

export type CategoryStatus = 'undecided' | 'secure' | 'gap' | 'mixed';

export interface DiagnosticPick {
  categoryId: string;
  key: string;
}

export interface DiagnosticCategoryResult {
  categoryId: string;
  label: string;
  sampled: number;
  /** Presented but skipped without evidence (G04 user control). */
  skipped: number;
  hits: number;
  misses: number;
  status: CategoryStatus;
}

export interface DiagnosticResult {
  /** Highest category that is not a gap among decided ones; null when none. */
  placement: { categoryId: string; label: string } | null;
  reason: 'all-decided' | 'budget' | 'stable' | 'empty';
  categories: DiagnosticCategoryResult[];
  sampledCount: number;
}

interface CategoryState {
  category: DiagnosticCategory;
  sampledKeys: string[];
  /** Keys presented but explicitly skipped by the learner — no evidence. */
  skippedKeys: string[];
  hits: number;
  misses: number;
  /** Consecutive hits ending at the latest sample. */
  currentStreak: number;
  status: CategoryStatus;
}

function decideState(state: CategoryState, config: DiagnosticConfig): CategoryStatus {
  if (state.misses >= config.gapConfirm) return 'gap';
  if (state.currentStreak >= config.secureStreak) return 'secure';
  if (state.sampledKeys.length >= config.categoryCap) return 'mixed';
  return 'undecided';
}

/**
 * Adaptive placement sampler over difficulty-ordered categories.
 * `record` accepts only the key of the current pending pick (session
 * integrity: one submission per sampled item), so replays and stale
 * submissions cannot double-count.
 */
export class DiagnosticSession {
  private readonly states: CategoryState[];
  private readonly byKey = new Map<string, CategoryState>();
  private readonly config: DiagnosticConfig;
  private sampledCount = 0;
  private pending: DiagnosticPick | null = null;

  constructor(categories: readonly DiagnosticCategory[], config?: Partial<DiagnosticConfig>) {
    this.config = { ...DIAGNOSTIC_DEFAULTS, ...config };
    this.states = categories.map((category) => {
      const state: CategoryState = {
        category,
        sampledKeys: [],
        skippedKeys: [],
        hits: 0,
        misses: 0,
        currentStreak: 0,
        status: category.items.length > 0 ? 'undecided' : 'mixed',
      };
      for (const key of category.items) this.byKey.set(key, state);
      return state;
    });
  }

  /** Categories still undecided AND with unexhausted pools. */
  private drawnCount(state: CategoryState): number {
    return state.sampledKeys.length + state.skippedKeys.length;
  }

  private drawable(): CategoryState[] {
    return this.states.filter(
      (state) => state.status === 'undecided' && this.drawnCount(state) < Math.min(state.category.items.length, this.config.categoryCap),
    );
  }

  private highestSecure(): CategoryState | null {
    let found: CategoryState | null = null;
    for (const state of this.states) {
      if (state.status === 'secure') found = state;
    }
    return found;
  }

  /**
   * Next balanced/adaptive pick, or null when the stop rule fired. Gap
   * categories expand first (diagnose around discovered gaps); otherwise the
   * least-sampled undecided category draws, ties going to the HARDER
   * category — placement information lives at the upper boundary, so the
   * first pass still visits every category once (balanced) before any
   * second draw.
   */
  pick(): DiagnosticPick | null {
    if (this.pending !== null) return this.pending;
    if (this.sampledCount >= this.config.maxTotal) return null;
    const drawable = this.drawable();
    if (drawable.length === 0) return null;
    const secure = this.highestSecure();
    const aboveStable = secure === null
      ? drawable
      : drawable.filter((state) => this.states.indexOf(state) > this.states.indexOf(secure));
    if (aboveStable.length === 0) return null; // nothing left can raise placement
    const withMisses = aboveStable.filter((state) => state.misses > 0);
    const pool = withMisses.length > 0 ? withMisses : aboveStable;
    let chosen = pool[0]!;
    for (const state of pool) {
      const harder = this.states.indexOf(state) > this.states.indexOf(chosen);
      // Balance counts DRAWS (sampled + skipped): a skipped item consumed the
      // learner's attention, so it must count toward a category's share.
      if (this.drawnCount(state) < this.drawnCount(chosen) || (harder && this.drawnCount(state) === this.drawnCount(chosen))) chosen = state;
    }
    const drawn = new Set([...chosen.sampledKeys, ...chosen.skippedKeys]);
    const key = chosen.category.items.find((item) => !drawn.has(item));
    if (key === undefined) return null; // unreachable: drawable() guarantees an un-drawn item
    this.pending = { categoryId: chosen.category.id, key };
    return this.pending;
  }

  /**
   * Records the outcome of the pending pick. Fluent counts as a hit;
   * struggled/missed count as misses (a struggled retrieval is not a
   * demonstrated fluent retrieval). Anything else is rejected.
   */
  record(key: string, quality: DiagnosticQuality): boolean {
    if (this.pending === null || this.pending.key !== key) return false;
    const state = this.byKey.get(key);
    if (state === undefined) return false;
    state.sampledKeys.push(key);
    if (quality === 'fluent') {
      state.hits += 1;
      state.currentStreak += 1;
    } else {
      state.misses += 1;
      state.currentStreak = 0;
    }
    state.status = decideState(state, this.config);
    this.sampledCount += 1;
    this.pending = null;
    return true;
  }

  /**
   * Advances past the pending pick WITHOUT recording anything — a skip is
   * not evidence (G04). The key is never re-presented this session; it does
   * not count as sampled and appears in the trace as skipped.
   */
  skip(key: string): boolean {
    if (this.pending === null || this.pending.key !== key) return false;
    const state = this.byKey.get(key);
    if (state === undefined) return false;
    state.skippedKeys.push(key);
    this.pending = null;
    return true;
  }

  isComplete(): boolean {
    return this.pick() === null;
  }

  result(): DiagnosticResult {
    const categories = this.states.map((state) => ({
      categoryId: state.category.id,
      label: state.category.label,
      sampled: state.sampledKeys.length,
      skipped: state.skippedKeys.length,
      hits: state.hits,
      misses: state.misses,
      status: state.status,
    }));
    let placement: DiagnosticResult['placement'] = null;
    for (const state of this.states) {
      if (state.status === 'secure' || (state.status === 'mixed' && state.hits > state.misses)) {
        placement = { categoryId: state.category.id, label: state.category.label };
      }
    }
    const drawableCount = this.drawable().length;
    let reason: DiagnosticResult['reason'];
    if (this.states.every((state) => state.category.items.length === 0)) reason = 'empty';
    else if (drawableCount === 0) reason = 'all-decided';
    else if (this.sampledCount >= this.config.maxTotal) reason = 'budget';
    else reason = 'stable';
    return { placement, reason, categories, sampledCount: this.sampledCount };
  }
}
