// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { WordStatusPillKnowledge } from './WordStatusPillKnowledge';
import { surfaceEntityId } from '../../../../shared/graph/load';
import { hashWordSync } from '../../../services/srsAlgorithm';
const inspect = vi.hoisted(() => vi.fn());
const recordAttempt = vi.hoisted(() => vi.fn());
const submitRating = vi.hoisted(() => vi.fn());
vi.mock('../../../services/openKnowledgeInspector', () => ({ openKnowledgeInspector: inspect }));
vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { language: 'ja', ratingKeyboardMode: 'mnemonic' } }),
  useLocalization: () => ({ t: (key: string) => key }),
  useFlashcards: () => ({ getComprehensiveWordStatusWithSourceSync: () => ({ status: 'known', basis: 'evidence' }), recordAttempt, submitRating }),
}));
vi.mock('../../../hooks/useKnowledgeProjection', () => ({ useKnowledgeProjection: () => ({
  projection: () => undefined,
  capabilities: () => ['sense-recognition', 'surface-recognition'],
}) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); submitRating.mockReset(); });
describe('knowledge hover', () => {
  it('opens the canonical target inspector and rates explicit rows through the restored matrix', () => {
    const container = document.createElement('div'); document.body.append(container);
    const close = vi.fn();
    dispose = render(() => <WordStatusPillKnowledge word="犬" language="ja" onClose={close} />, container);
    const inspectButton = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes('mlearn.Knowledge.Popup.Inspect'));
    if (!inspectButton) throw new Error('Missing Inspect action');
    inspectButton.click();
    expect(inspect).toHaveBeenCalledWith({ language: 'ja', surface: '犬', target: { kind: 'surface', id: surfaceEntityId('ja', hashWordSync('犬')) } });
    expect(close).toHaveBeenCalledOnce();
    expect(container.querySelector('select')).toBeNull();

    // The full matrix stays behind the Rate toggle until asked for.
    const rateButton = Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'mlearn.Knowledge.Popup.Rate');
    if (!rateButton) throw new Error('Missing Rate action');
    expect(container.querySelector('.rating-matrix')).toBeNull();
    rateButton.click();
    expect(container.querySelector('.rating-matrix')).not.toBeNull();
    // The capability rows stay folded behind Adjust until asked for.
    const adjust = container.querySelector<HTMLButtonElement>('.rating-matrix__adjust');
    adjust!.click();
    expect(container.textContent).toContain('mlearn.Knowledge.Capability.surface-recognition');

    // Canonical chords: 1 arms the pending quality, w drafts the spelling
    // row. A partial state never submits — the untouched sense row
    // fabricates no observation.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    expect(recordAttempt).not.toHaveBeenCalled();
    // The draft cleared the pending chord, so arm the quality again: the
    // same digit twice = the All row. The explicit draft stands and the
    // word completes as one attempt.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(submitRating).toHaveBeenCalledOnce();
    expect(submitRating).toHaveBeenCalledWith('犬', [
      { capability: 'sense-recognition', quality: 'missed' },
      { capability: 'surface-recognition', quality: 'missed' },
    ], expect.objectContaining({ language: 'ja', attemptId: expect.any(String) }));
  });

  it('returns to the summary after an acknowledged attempt so Rate can start another attempt', async () => {
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordStatusPillKnowledge word="犬" language="ja" />, container);
    const rateButton = Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'mlearn.Knowledge.Popup.Rate')!;
    rateButton.click();
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    expect(submitRating).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('.rating-matrix')).toBeNull();
    rateButton.click();
    expect(container.querySelector('.rating-matrix__quality')).not.toBeNull();
  });

  // The pill owns no write vocabulary of its own: it renders the same
  // shared banner as flashcard review, word sync and grammar coverage, so a
  // rating that fails here is worded and offered a retry identically.
  it('surfaces the in-flight rating through the shared write banner and its pending state', async () => {
    let resolveFirst!: () => void;
    submitRating.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      resolveFirst = () => reject(new Error('disk unavailable'));
    }));
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordStatusPillKnowledge word="犬" language="ja" />, container);
    container.querySelector<HTMLButtonElement>('.word-status-knowledge__actions button')!.click();
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();

    const pending = container.querySelector('[role="status"]');
    expect(pending?.textContent).toBe('mlearn.Knowledge.Popup.Saving');
    // A live region, and the matrix disarmed while the write is unresolved.
    expect(pending?.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    // The shared banner owns the retry affordance, so a failure surfaces one
    // primary action rather than this surface's own ghost button.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('mlearn.Knowledge.Popup.SaveFailed');
    const retry = alert?.querySelector('button');
    expect(retry?.textContent).toBe('mlearn.Knowledge.Popup.Retry');
    expect(retry?.className).toContain('btn-primary');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps the matrix open until the rating is acknowledged and retries the same command after failure', async () => {
    let resolveFirst!: () => void;
    submitRating.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      resolveFirst = () => reject(new Error('disk unavailable'));
    })).mockResolvedValueOnce({ attemptId: 'attempt-1', completed: true });
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordStatusPillKnowledge word="犬" language="ja" />, container);
    container.querySelector<HTMLButtonElement>('.word-status-knowledge__actions button')!.click();
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();

    expect(submitRating).toHaveBeenCalledOnce();
    expect(container.querySelector('.rating-matrix')).not.toBeNull();
    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.Knowledge.Popup.Retry');
    expect(retry).toBeDefined();
    retry!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(submitRating).toHaveBeenCalledTimes(2);
    expect(submitRating.mock.calls[1]).toEqual(submitRating.mock.calls[0]);
    expect(container.querySelector('.rating-matrix')).toBeNull();
  });
});
