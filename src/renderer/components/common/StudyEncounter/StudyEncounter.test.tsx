import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { StudyEncounter } from './StudyEncounter';

vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

describe('shared retrieval encounter', () => {
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
    expect(root.querySelectorAll('.rating-matrix__quality')).toHaveLength(3);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(submit).toHaveBeenCalledWith([{ capability: 'third-party:construction-recall', quality: 'fluent' }], undefined);
  });
  it('omits scheduler-only Easy in both displayed controls and spatial shortcuts', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const submit = vi.fn();
    dispose = render(() => <StudyEncounter prompt="prompt" answer="answer" revealed={true} onReveal={() => {}}
      rating={{ capabilities: ['sense-recognition'], keyboardMode: 'spatial', initiallyExpanded: true, armed: true, onSubmit: submit }} />, root);
    expect(root.textContent).not.toContain('mlearn.Rating.Matrix.Easy');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(submit).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    expect(submit).toHaveBeenCalledWith([{ capability: 'sense-recognition', quality: 'fluent' }], undefined);
  });

});
