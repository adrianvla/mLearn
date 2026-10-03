/** The presentation contract shared by vocabulary and grammar assessment. */
export type StudySessionPhase = 'loading' | 'question' | 'revealed' | 'saving' | 'save-failed' | 'answered' | 'complete';

/**
 * The durable-write state a surface renders, projected from the phase.
 *
 * `null` means no write is in flight. This is the only place the phase
 * vocabulary is translated for write reporting, so a surface cannot disagree
 * with the contract about which phases are a write.
 */
export type StudySessionWriteStatus = 'pending' | 'failed' | null;

/**
 * The two states a durable write can be observed in, without the idle case.
 *
 * Surfaces spell this union inline in several places — a rating write, a
 * retraction write, a pending journal record, a review probe. They are all the
 * same two states of the same concept (a study write that either still has not
 * landed or was refused), so the vocabulary is declared once here and derived
 * everywhere else. Whether a surface encodes "idle" as `null` or as the absence
 * of a record is a per-surface decision and is deliberately left alone.
 */
export type StudyWriteState = Exclude<StudySessionWriteStatus, null>;

/** Projects the write-reporting status from a session phase. */
export function studySessionWriteStatus(phase: StudySessionPhase): StudySessionWriteStatus {
  return phase === 'saving' ? 'pending' : phase === 'save-failed' ? 'failed' : null;
}

export interface StudySessionSnapshot {
  ready: boolean;
  index: number;
  total: number;
  revealed: boolean;
  write: StudySessionWriteStatus;
  answered?: boolean;
}

export interface StudySessionState {
  phase: StudySessionPhase;
  completed: number;
  total: number;
  current: number;
  canRate: boolean;
  canAdvance: boolean;
  /** Write reporting for this phase, derived from the same vocabulary. */
  write: StudySessionWriteStatus;
}

export function studySessionState(snapshot: StudySessionSnapshot): StudySessionState {
  const total = Math.max(0, snapshot.total);
  const completed = Math.min(Math.max(0, snapshot.index), total);
  const phase: StudySessionPhase = !snapshot.ready ? 'loading'
    : snapshot.write === 'pending' ? 'saving'
    : snapshot.write === 'failed' ? 'save-failed'
    : completed >= total ? 'complete'
    : snapshot.answered ? 'answered'
    : snapshot.revealed ? 'revealed'
    : 'question';
  return {
    phase,
    completed,
    total,
    current: total > 0 ? Math.min(completed + 1, total) : 0,
    canRate: phase === 'revealed',
    canAdvance: phase === 'answered',
    write: studySessionWriteStatus(phase),
  };
}
