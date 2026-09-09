import { DEFAULT_SETTINGS, type Settings } from './types';

/**
 * Scaffold stances — what the LEARNER wants from a scaffold, not when the
 * scaffold appears. Policy owns the "when": evidence fades, status limits,
 * and task-validity decisions are TeachingPolicy/ScaffoldPolicy decisions,
 * never user-facing algorithm knobs.
 *
 * Stances (internal semantics; the UI exposes only the smallest control each
 * feature actually needs):
 * - 'adaptive' — no learner preference; ScaffoldPolicy decides.
 * - 'prefer'   — soft preference; bias toward showing, policy still fades.
 * - 'require'  — hard accessibility/presentation constraint: the scaffold
 *                MUST be shown, even when that makes an access unmeasurable.
 *                Task selection adapts instead of violating the constraint.
 * - 'avoid'    — soft preference against; rendering honors it, policy never
 *                forces the scaffold to obtain clean evidence.
 * - 'forbid'   — hard constraint against showing the scaffold.
 *
 * Open world: package-declared scaffolds (namespaced ids, e.g.
 * 'x-acme::tone-ladder') have no core stance — they resolve to 'adaptive'
 * (safe/inert) without a core edit, mirroring AttemptScaffolds' open index
 * signature.
 */
export type ScaffoldStance = 'adaptive' | 'prefer' | 'require' | 'avoid' | 'forbid';

export type ReadingScaffoldSettings = Partial<Pick<Settings, 'showReadingAnnotations' | 'hideReadingForKnownWords'>>;

/**
 * Readings (furigana/romanization) are an accessibility requirement as often
 * as a preference, so the control is a hard-constraint dial:
 * off = never show; adaptive = policy fades them for known words;
 * on-without-fade = ALWAYS show — mLearn conditions reading evidence on the
 * visible furigana instead of overriding the learner's requirement.
 */
export function readingScaffoldStance(settings: ReadingScaffoldSettings): 'forbid' | 'adaptive' | 'require' {
  if (!(settings.showReadingAnnotations ?? DEFAULT_SETTINGS.showReadingAnnotations!)) return 'forbid';
  return (settings.hideReadingForKnownWords ?? DEFAULT_SETTINGS.hideReadingForKnownWords ?? false) ? 'adaptive' : 'require';
}

export function applyReadingScaffoldStance(stance: 'forbid' | 'adaptive' | 'require'): Partial<Settings> {
  switch (stance) {
    case 'forbid':
      return { showReadingAnnotations: false };
    case 'require':
      return { showReadingAnnotations: true, hideReadingForKnownWords: false };
    case 'adaptive':
      return { showReadingAnnotations: true, hideReadingForKnownWords: true };
  }
}

export type ProsodyScaffoldSettings = Partial<Pick<Settings, 'coloredProsodyEnabled'>>;

/**
 * Pitch/tone coloring is an appearance-level preference, not a measurement
 * control: the learner says whether they want it; ScaffoldPolicy owns when it
 * fades (status limit, evidence fade are policy internals, not settings).
 */
export function prosodyScaffoldStance(settings: ProsodyScaffoldSettings): 'avoid' | 'prefer' {
  return (settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled) ? 'prefer' : 'avoid';
}

export function applyProsodyScaffoldStance(stance: 'avoid' | 'prefer'): Partial<Settings> {
  return { coloredProsodyEnabled: stance === 'prefer' };
}

/** Core scaffolds with built-in semantics; anything else is namespaced package extension. */
export const CORE_SCAFFOLD_IDS: readonly string[] = ['reading', 'translation', 'prosody', 'audio'];

/**
 * Stance for any scaffold id. Unknown package-declared scaffolds resolve to
 * 'adaptive' — safe and inert — so extension scaffolds survive the pipeline
 * without runtime branches.
 */
export function scaffoldStance(
  settings: ReadingScaffoldSettings & ProsodyScaffoldSettings,
  scaffoldId: string,
): ScaffoldStance {
  if (scaffoldId === 'reading') return readingScaffoldStance(settings);
  if (scaffoldId === 'prosody') return prosodyScaffoldStance(settings);
  return 'adaptive';
}
