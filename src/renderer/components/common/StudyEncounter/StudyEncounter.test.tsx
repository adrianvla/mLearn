import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { StudyEncounter, StudySessionHUD } from './StudyEncounter';

vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

describe('shared retrieval encounter', () => {
  it('shows visit progress without a finish-line denominator for continuous work', () => {
    dispose = render(() => <StudySessionHUD completed={13} />, document.body);
    expect(document.body.textContent).toContain('mlearn.StudyEncounter.VisitProgress');
    expect(document.body.textContent).not.toContain('mlearn.StudyEncounter.Progress');
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('retains a progress bar and finite-session label for admitted bounded work', () => {
    dispose = render(() => <StudySessionHUD completed={1} total={2} />, document.body);
    expect(document.body.textContent).toContain('mlearn.StudyEncounter.Progress');
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('shows package-defined recall labels once, without default retrieval or comparison narration', () => {
    const [revealed, setRevealed] = createSignal(false);
    dispose = render(() => <StudyEncounter prompt="cue" answer="answer" revealed={revealed()} onReveal={() => setRevealed(true)}
      rating={{ capabilities: ['future:relationship'], capabilityLabels: { 'future:relationship': 'Speaker relationship' }, keyboardMode: 'mnemonic', armed: true, onSubmit: vi.fn() }} />, document.body);
    expect(document.querySelector('.study-encounter__cue')?.textContent).toContain('Speaker relationship');
    expect(document.body.textContent).not.toContain('mlearn.StudyEncounter.Retrieve');
    setRevealed(true);
    expect(document.body.textContent).not.toContain('mlearn.StudyEncounter.Compare');
    expect(document.querySelectorAll('.recall-cue')).toHaveLength(1);
  });
  it('keeps the answer and response controls out of the task until explicit reveal, for arbitrary material', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const [revealed, setRevealed] = createSignal(false);
    const submit = vi.fn();
    dispose = render(() => <StudyEncounter prompt={<span>package-defined construction</span>}
      answer={<span>package-defined explanation</span>} revealed={revealed()} onReveal={() => setRevealed(true)}
      rating={{ capabilities: ['third-party:construction-recall'], keyboardMode: 'mnemonic', armed: true, onSubmit: submit }} />, root);
    expect(root.textContent).toContain('package-defined construction');
    expect(root.textContent).not.toContain('package-defined explanation');
    expect(root.querySelector('.study-encounter__response')?.hasAttribute('hidden')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(submit).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.study-encounter__reveal')!.click();
    expect(root.textContent).toContain('package-defined explanation');
    expect(root.querySelector('.study-encounter__response')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelectorAll('.rating-matrix__quality')).toHaveLength(4);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(submit).toHaveBeenCalledWith([{ capability: 'third-party:construction-recall', quality: 'fluent' }], undefined);
  });
  it('keeps the four-grade grammar in practice without inventing an interval', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const submit = vi.fn();
    dispose = render(() => <StudyEncounter prompt="prompt" answer="answer" revealed={true} onReveal={() => {}}
      rating={{ capabilities: ['sense-recognition'], keyboardMode: 'spatial', initiallyExpanded: true, armed: true, onSubmit: submit }} />, root);
    expect(root.textContent).toContain('mlearn.Rating.Matrix.Easy');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(submit).toHaveBeenCalledWith([{ capability: 'sense-recognition', quality: 'fluent', easy: true }], { easy: true });
  });

  it('uses the same revealed card for reference continuation without recall instructions or rating controls', () => {
    const [available, setAvailable] = createSignal(true);
    const submit = vi.fn();
    dispose = render(() => <StudyEncounter prompt="cue" answer="reference" revealed={true} onReveal={() => {}}
      ratingAvailable={available()} rating={{ capabilities: ['future:recall'], keyboardMode: 'mnemonic', armed: true, onSubmit: submit }}>
      <button>Continue</button>
    </StudyEncounter>, document.body);
    expect(document.querySelectorAll('.rating-matrix__quality')).toHaveLength(4);
    setAvailable(false);
    expect(document.querySelector('.rating-matrix')).toBeNull();
    expect(document.querySelector('.study-encounter__instruction')).toBeNull();
    expect(document.body.textContent).toContain('reference');
    expect(document.body.textContent).toContain('Continue');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(submit).not.toHaveBeenCalled();
  });

});
