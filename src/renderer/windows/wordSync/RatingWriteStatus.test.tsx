// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { RatingWriteStatus } from './RatingWriteStatus';
import { studySessionState, type StudySessionSnapshot } from '../../learning/studySession';

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

const snapshot = (over: Partial<StudySessionSnapshot> = {}) => studySessionState({
  ready: true, index: 0, total: 3, revealed: true, write: null, ...over,
});

describe('RatingWriteStatus', () => {
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
  afterEach(() => { container.remove(); });

  it('stays silent while the write is not in flight', () => {
    const dispose = render(() => <RatingWriteStatus presentation={snapshot()} retry={null} onRetry={() => {}} />, container);
    expect(container.textContent).toBe('');
    dispose();
  });

  it('announces a pending write politely', () => {
    const dispose = render(() => <RatingWriteStatus presentation={snapshot({ write: 'pending' })} retry={{}} onRetry={() => {}} />, container);
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toBe('mlearn.WordSync.SavingRating');
    dispose();
  });

  it('raises an assertive failure banner carrying a retry button', () => {
    const dispose = render(() => <RatingWriteStatus presentation={snapshot({ write: 'failed' })} retry={{}} onRetry={() => {}} />, container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.WordSync.SaveFailed');
    expect(container.querySelector('button')?.textContent).toBe('mlearn.Global.TryAgain');
    dispose();
  });

  it('does not fire onRetry when the failed payload has already been cleared', () => {
    const onRetry = vi.fn();
    const dispose = render(() => <RatingWriteStatus presentation={snapshot({ write: 'failed' })} retry={null} onRetry={onRetry} />, container);
    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRetry).not.toHaveBeenCalled();
    dispose();
  });

  it('applies the surface class and the failure-only class', () => {
    const dispose = render(
      () => <RatingWriteStatus presentation={snapshot({ write: 'failed' })} retry={{}} onRetry={() => {}} class="write" failedClass="write--failed" />,
      container,
    );
    expect(container.querySelector('[role="alert"]')?.className).toBe('write write--failed');
    dispose();
  });
});
