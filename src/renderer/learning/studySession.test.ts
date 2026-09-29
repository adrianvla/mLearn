import { describe, expect, it } from 'vitest';
import {
  studySessionState,
  studySessionWriteStatus,
  type StudySessionPhase,
  type StudySessionWriteStatus,
  type StudyWriteState,
} from './studySession';

describe('study session presentation contract', () => {
  it('gates rating on reveal and blocks it throughout write failure and retry', () => {
    const base = { ready: true, index: 1, total: 3, revealed: false, write: null } as const;
    expect(studySessionState(base)).toMatchObject({ phase: 'question', current: 2, canRate: false });
    expect(studySessionState({ ...base, revealed: true })).toMatchObject({ phase: 'revealed', canRate: true });
    expect(studySessionState({ ...base, revealed: true, write: 'pending' })).toMatchObject({ phase: 'saving', canRate: false });
    expect(studySessionState({ ...base, revealed: true, write: 'failed' })).toMatchObject({ phase: 'save-failed', canRate: false });
    expect(studySessionState({ ...base, answered: true })).toMatchObject({ phase: 'answered', canAdvance: true });
  });

  it('projects write reporting for exactly the write phases', () => {
    // Only a durable write reports status. Every other phase — including
    // completion, which arrives after a write settles — reports no write.
    const reporting: Record<StudySessionPhase, 'pending' | 'failed' | null> = {
      loading: null,
      question: null,
      revealed: null,
      saving: 'pending',
      'save-failed': 'failed',
      answered: null,
      complete: null,
    };
    for (const [phase, expected] of Object.entries(reporting) as [StudySessionPhase, 'pending' | 'failed' | null][]) {
      expect(studySessionWriteStatus(phase)).toBe(expected);
    }
  });

  it('derives write reporting from the same phase the surface renders', () => {
    const base = { ready: true, index: 1, total: 3, revealed: true } as const;
    expect(studySessionState({ ...base, write: null }).write).toBeNull();
    expect(studySessionState({ ...base, write: 'pending' }).write).toBe('pending');
    expect(studySessionState({ ...base, write: 'failed' }).write).toBe('failed');
    // Completion outranks the write in the phase order, so a settled session
    // reports no write even though the snapshot still describes one.
    expect(studySessionState({ ready: true, index: 3, total: 3, revealed: true, write: 'pending' }).write).toBeNull();
  });

  it('bounds cursor and completion without inventing a question', () => {
    expect(studySessionState({ ready: true, index: 3, total: 3, revealed: false, write: null }))
      .toMatchObject({ phase: 'complete', completed: 3, current: 3, canRate: false });
  });
});

describe('durable write vocabulary', () => {
  it('is declared once and every surface spelling derives from it', () => {
    // These used to be five independent inline unions that happened to match.
    // They are one concept, so the banner, the rating write, the retraction
    // write, the pending journal record and the review probe all name it.
    const states: StudyWriteState[] = ['pending', 'failed'];
    expect(states).toEqual<StudyWriteState[]>(['pending', 'failed']);
    // Idle is per-surface: nullable status, or the absence of a record.
    const idle: StudySessionWriteStatus = null;
    expect(idle).toBeNull();
    expect(studySessionWriteStatus('saving')).toBe<StudyWriteState>('pending');
    expect(studySessionWriteStatus('save-failed')).toBe<StudyWriteState>('failed');
    expect(studySessionWriteStatus('complete')).toBeNull();
  });
});
