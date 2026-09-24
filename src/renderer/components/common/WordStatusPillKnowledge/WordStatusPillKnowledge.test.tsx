// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { WordStatusPillKnowledge } from './WordStatusPillKnowledge';
import { surfaceEntityId } from '../../../../shared/graph/load';
import { hashWordSync } from '../../../services/srsAlgorithm';
const inspect = vi.hoisted(() => vi.fn());
const recordAttempt = vi.hoisted(() => vi.fn());
vi.mock('../../../services/openKnowledgeInspector', () => ({ openKnowledgeInspector: inspect }));
vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { language: 'ja', ratingKeyboardMode: 'mnemonic' } }),
  useLocalization: () => ({ t: (key: string) => key }),
  useFlashcards: () => ({ getComprehensiveWordStatusWithSourceSync: () => ({ status: 'known', basis: 'evidence' }), recordAttempt }),
}));
vi.mock('../../../hooks/useKnowledgeProjection', () => ({ useKnowledgeProjection: () => ({
  projection: () => undefined,
  capabilities: () => ['sense-recognition', 'surface-recognition'],
}) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); });
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
    expect(recordAttempt).toHaveBeenCalledTimes(2);
    expect(recordAttempt).toHaveBeenCalledWith('犬', 'surface-recognition', 'missed', expect.objectContaining({ language: 'ja' }));
    expect(recordAttempt).toHaveBeenCalledWith('犬', 'sense-recognition', 'missed', expect.objectContaining({ language: 'ja' }));
  });

  it('returns to the summary after an attempt so Rate can start another attempt', () => {
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <WordStatusPillKnowledge word="犬" language="ja" />, container);
    const rateButton = Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'mlearn.Knowledge.Popup.Rate')!;
    rateButton.click();
    container.querySelector<HTMLButtonElement>('.rating-matrix__quality')!.click();
    expect(recordAttempt).toHaveBeenCalled();
    expect(container.querySelector('.rating-matrix')).toBeNull();
    rateButton.click();
    expect(container.querySelector('.rating-matrix__quality')).not.toBeNull();
  });
});
