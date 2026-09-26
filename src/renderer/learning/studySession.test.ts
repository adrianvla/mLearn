import { describe, expect, it } from 'vitest';
import { studySessionState } from './studySession';

describe('study session presentation contract', () => {
  it('gates rating on reveal and blocks it throughout write failure and retry', () => {
    const base = { ready: true, index: 1, total: 3, revealed: false, write: null } as const;
    expect(studySessionState(base)).toMatchObject({ phase: 'question', current: 2, canRate: false });
    expect(studySessionState({ ...base, revealed: true })).toMatchObject({ phase: 'revealed', canRate: true });
    expect(studySessionState({ ...base, revealed: true, write: 'pending' })).toMatchObject({ phase: 'saving', canRate: false });
    expect(studySessionState({ ...base, revealed: true, write: 'failed' })).toMatchObject({ phase: 'save-failed', canRate: false });
    expect(studySessionState({ ...base, answered: true })).toMatchObject({ phase: 'answered', canAdvance: true });
  });

  it('bounds cursor and completion without inventing a question', () => {
    expect(studySessionState({ ready: true, index: 3, total: 3, revealed: false, write: null }))
      .toMatchObject({ phase: 'complete', completed: 3, current: 3, canRate: false });
  });
});
