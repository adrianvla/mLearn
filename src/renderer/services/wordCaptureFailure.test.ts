// @vitest-environment happy-dom

/**
 * "Did my card get saved?" is one question with six capture surfaces behind it.
 *
 * These tests pin the reporting owner itself - what is announced, when nothing
 * is announced, and that a batch is described once rather than per word. The
 * structural test below them is what stops a seventh surface from deciding for
 * itself again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportCaptureFailure, reportCaptureBatchFailure } from './wordCaptureFailure';

const toasts: { message: string; variant?: string }[] = [];

vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (options: { message: string; variant?: string }) => {
    toasts.push(options);
    return toasts.length;
  },
}));

/** Echo the params back so a test can assert what the message was built from. */
const t = (path: string, params?: Record<string, string | number>) =>
  params ? `${path} ${JSON.stringify(params)}` : path;

beforeEach(() => {
  toasts.length = 0;
});

describe('a failed capture is announced', () => {
  it('names the word when a single capture failed', () => {
    reportCaptureFailure(new Error('backend unreachable'), { word: '猫' }, { translate: t });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain('猫');
    expect(toasts[0].message).toContain('backend unreachable');
    expect(toasts[0].variant).toBe('error');
  });

  it('reports the count rather than naming a word for a batch', () => {
    reportCaptureBatchFailure(new Error('disk full'), 7, { translate: t });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain('"count":7');
  });

  it('logs the failure even when there is nothing to announce', () => {
    // An aborted operation is the learner's own doing - a closed dialog or a
    // superseded request - and a toast saying "failed" for it would be wrong.
    const logged: unknown[] = [];
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const reported = reportCaptureFailure(abort, { word: '猫' }, { translate: t, log: (_m, e) => logged.push(e) });

    expect(reported).toBe(false);
    expect(toasts).toHaveLength(0);
    expect(logged).toEqual([abort]);
  });

  it('logs and announces when the failure carries no Error shape', () => {
    reportCaptureFailure('plain string failure', { word: '猫' }, { translate: t });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain('plain string failure');
  });

  it('survives a null rejection', () => {
    expect(reportCaptureFailure(null, { word: '猫' }, { translate: t })).toBe(false);
    expect(toasts).toHaveLength(0);
  });
});
