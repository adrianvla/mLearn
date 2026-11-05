import type { ReviewGrade, ReviewTarget, ResponseMethod } from '@mlearn/contracts';

export const ratingActions = [
  { key: '1', label: 'Missed', quality: 'missed', easy: false, tone: 'negative' },
  { key: '2', label: 'Struggled', quality: 'struggled', easy: false, tone: 'warning' },
  { key: '3', label: 'Fluent', quality: 'fluent', easy: false, tone: 'positive' },
  { key: '4', label: 'Easy', quality: 'fluent', easy: true, tone: 'neutral' },
] as const;
export type RatingAction = typeof ratingActions[number];
export type RatingState = {
  readonly expanded: boolean;
  readonly pending: { readonly key: string; readonly at: number } | null;
  readonly drafts: Readonly<Record<string, ReviewGrade>>;
};
export type RatingResult = {
  readonly state: RatingState;
  readonly grades: ReviewGrade[] | null;
  readonly handled: boolean;
};
export function initialRating(expanded = false): RatingState {
  return { expanded, pending: null, drafts: {} };
}
export function ratingGrade(targetId: string, action: RatingAction, method: ResponseMethod): ReviewGrade {
  return { targetId, quality: action.quality, easy: action.easy, method };
}
export function rateAll(targets: readonly ReviewTarget[], state: RatingState, action: RatingAction, method: ResponseMethod): ReviewGrade[] {
  return targets.map(target => state.drafts[target.id]
    ? state.drafts[target.id] : ratingGrade(target.id, action, method));
}
export function rateTarget(targets: readonly ReviewTarget[], state: RatingState, grade: ReviewGrade): RatingResult {
  const drafts = { ...state.drafts, [grade.targetId]: grade };
  const next = { ...state, pending: null, drafts };
  return {
    state: next, handled: true,
    grades: targets.every(target => drafts[target.id] !== undefined) ? targets.map(target => drafts[target.id]) : null,
  };
}
/** Chords expire by event timestamp, not a timer that can submit while focus changes. */
export function ratingKey(targets: readonly ReviewTarget[], state: RatingState, key: string, at: number, workedOut: boolean): RatingResult {
  const method = workedOut ? 'worked_out' : 'remembered';
  const pending = state.pending && at - state.pending.at <= 1500 ? state.pending : null;
  const action = ratingActions.find(item => item.key === key);
  if (key === 'Escape') return {
    state: { ...state, pending: null, expanded: pending ? state.expanded : false }, grades: null,
    handled: !!pending || state.expanded,
  };
  if (action) {
    if (!state.expanded || pending?.key === key)
      return { state: { ...state, pending: null }, grades: rateAll(targets, state, action, method), handled: true };
    return { state: { ...state, pending: { key, at } }, grades: null, handled: true };
  }
  if (state.expanded && pending) {
    const matching = targets.filter(target => target.mnemonic?.toLowerCase() === key.toLowerCase());
    const pendingAction = ratingActions.find(item => item.key === pending.key);
    // Ambiguous package mnemonics remain touch/click accessible; never guess.
    if (matching.length === 1 && pendingAction)
      return rateTarget(targets, state, ratingGrade(matching[0].id, pendingAction, method));
  }
  return { state: { ...state, pending }, grades: null, handled: false };
}

export type LearningKeyContext = {
  readonly repeat: boolean;
  readonly composing: boolean;
  readonly prevented: boolean;
  readonly editable: boolean;
  readonly selected: boolean;
  readonly modal: boolean;
  readonly modified: boolean;
};
export function learningKeyAllowed(context: LearningKeyContext): boolean {
  return !Object.values(context).some(Boolean);
}
