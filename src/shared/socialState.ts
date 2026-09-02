/**
 * Ephemeral social/affective turn state — turn/session-scoped BY DESIGN.
 * Never journaled; durable social facts belong to memory.belief /
 * resolution events via Dreamer. Structural signals only (punctuation,
 * casing, message shape, correction counts) so inference stays
 * language-agnostic. No numeric scores ever reach a prompt.
 */

export type SocialTone =
  | 'neutral'
  | 'frustrated'
  | 'uncertain'
  | 'excited'
  | 'confident'
  | 'withdrawn';

export interface TurnSocialState {
  tone: SocialTone;
  /** Human-readable structural evidence — logging/audit only; never prompt-interpolated. */
  evidence: string;
  /** 'checker' (LLM verdict from the existing checker pass) beats 'heuristic'. */
  source: 'heuristic' | 'checker';
}

// ---------------------------------------------------------------------------
// Turn-affect heuristic — STRUCTURAL signals only (punctuation shape, casing,
// message repetition, correction pressure). No word lists, no language
// conditionals, no numbers in evidence. Conservative: null unless a signal
// clears its threshold.
// ---------------------------------------------------------------------------

export interface TurnAffectOptions {
  /** Corrections served on very recent turns — sustained correction pressure. */
  correctionCount?: number;
  /** The learner asked the exact same question again in this thread. */
  repeatedQuestion?: boolean;
}

const BURST_REPEATED_LIMIT = 3;
const CAPS_MIN_LETTERS = 6;
const CAPS_RATIO_THRESHOLD = 0.6;
const CORRECTION_PRESSURE_THRESHOLD = 2;

interface StructuralSignals {
  capsShout: boolean;
  bangBurst: boolean;
  questionBurst: boolean;
  mixedBurst: boolean;
  repeatedPunctuation: boolean;
  ellipsisRun: boolean;
}


function detectStructuralSignals(text: string): StructuralSignals {
  // Case ratio only meaningfully applies to scripts that distinguish case;
  // other scripts simply never clear the threshold.
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const upperCase = (text.match(/\p{Lu}/gu) ?? []).length;
  const bangs = (text.match(/[!！]/gu) ?? []).length;
  const questions = (text.match(/[?？]/gu) ?? []).length;
  const punctuationRuns = text.match(/\p{Po}{3,}/gu) ?? [];
  return {
    capsShout: letters >= CAPS_MIN_LETTERS && upperCase / letters >= CAPS_RATIO_THRESHOLD,
    bangBurst: /[!！]{2,}/u.test(text) || bangs >= BURST_REPEATED_LIMIT,
    questionBurst: /[?？]{2,}/u.test(text) || questions >= BURST_REPEATED_LIMIT,
    mixedBurst: /[!！][?？]|[?？][!！]/u.test(text),
    // Same-char runs are the burst/ellipsis signals' territory; only a jumble
    // of distinct punctuation reads as generic piling-up agitation.
    repeatedPunctuation: punctuationRuns.some((run) => new Set(run).size > 1),
    // Dots, ellipsis characters, and repeated CJK full stops all read as trailing off.
    ellipsisRun: /\.{3,}|…|。{2,}/u.test(text),
  };
}

const SIGNAL_CLAUSES: Record<keyof StructuralSignals, string> = {
  capsShout: 'all-caps shouting',
  bangBurst: 'a burst of exclamation marks',
  questionBurst: 'a burst of question marks',
  mixedBurst: 'punctuation piles up',
  repeatedPunctuation: 'punctuation piles up',
  ellipsisRun: 'the message trails off with ellipses',
};

/**
 * Infer ephemeral affect for one user turn from structural signals alone.
 * Returns null when nothing clears a threshold — never a weak guess.
 */
export function inferTurnAffect(text: string, opts: TurnAffectOptions = {}): TurnSocialState | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const signals = detectStructuralSignals(trimmed);
  const correctionPressure = (opts.correctionCount ?? 0) >= CORRECTION_PRESSURE_THRESHOLD;

  const frustrated =
    signals.capsShout ||
    signals.mixedBurst ||
    signals.repeatedPunctuation ||
    correctionPressure;
  const uncertain = signals.ellipsisRun || signals.questionBurst || opts.repeatedQuestion === true;
  const excited = signals.bangBurst && !signals.capsShout;

  const tone: SocialTone | null = frustrated ? 'frustrated' : uncertain ? 'uncertain' : excited ? 'excited' : null;
  if (!tone) return null;

  const clauses: string[] = [];
  if (signals.capsShout) clauses.push(SIGNAL_CLAUSES.capsShout);
  if (signals.bangBurst) clauses.push(SIGNAL_CLAUSES.bangBurst);
  if (signals.questionBurst) clauses.push(SIGNAL_CLAUSES.questionBurst);
  if (signals.mixedBurst || signals.repeatedPunctuation) clauses.push(SIGNAL_CLAUSES.mixedBurst);
  if (signals.ellipsisRun) clauses.push(SIGNAL_CLAUSES.ellipsisRun);
  if (correctionPressure) clauses.push('recent corrections are stacking up');
  if (opts.repeatedQuestion) clauses.push('the same question was asked again');

  return {
    tone,
    evidence: clauses.join(', '),
    source: 'heuristic',
  };
}

/** Exact tone values accepted at every entry point; anything else ⇒ no climate section. */
export const SOCIAL_TONES: ReadonlySet<SocialTone> = new Set([
  'neutral',
  'frustrated',
  'uncertain',
  'excited',
  'confident',
  'withdrawn',
]);

// Code-authored fixed clauses keyed by the tone enum. This is the ONLY text the
// climate section may contain — `evidence` and any other dynamic string are
// untrusted model/user-derived text and must never be interpolated here.
const CLIMATE_CLAUSES: Record<SocialTone, string> = {
  frustrated: 'Signals suggest the learner is frustrated right now — slow down, acknowledge it, simplify your language, and go easy on corrections.',
  uncertain: 'Signals suggest the learner is unsure right now — reassure them, break things into smaller steps, and ask one simple question at a time.',
  excited: 'Signals suggest the learner is energized right now — match the energy and channel it into practice.',
  confident: 'Signals suggest the learner feels confident right now — stretch them gently with slightly harder material.',
  withdrawn: 'Signals suggest the learner is pulling back right now — lower the pressure, keep responses warm and short.',
  neutral: 'No strong affect signals — keep the current tone.',
};

/**
 * Render the prompt section for a turn's social state. Emits ONLY enum-keyed
 * static clauses; an out-of-union tone renders as empty (no section) instead of
 * falling through to dynamic text. No numbers ever.
 */
export function renderSocialClimate(state: TurnSocialState): string {
  if (!SOCIAL_TONES.has(state.tone)) return '';
  return [
    '## Conversation Climate',
    CLIMATE_CLAUSES[state.tone],
    'Treat this as a hint about delivery, not about the learner\'s ability — never call the mood out directly.',
  ].join('\n');
}
