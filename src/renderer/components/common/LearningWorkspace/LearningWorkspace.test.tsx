// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningWorkspace, useLearningInput } from './LearningWorkspace';
import { StudyEncounter } from '../StudyEncounter/StudyEncounter';
vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));

describe('foreground learning input', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });
  it('does not retain reveal or rating owners across repeated workspace visits', () => {
    const visits = Array.from({ length: 3 }, () => ({ reveal: vi.fn(), rate: vi.fn() }));
    const container = document.createElement('div'); document.body.append(container);
    const key = (value: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, cancelable: true }));
    for (const [index, visit] of visits.entries()) {
      const Task = () => {
        const [revealed, reveal] = createSignal(false);
        return <StudyEncounter prompt="Cue" answer="Answer" revealed={revealed()} onReveal={() => { visit.reveal(); reveal(true); }}
          rating={{ capabilities: ['sense-recognition'], armed: true, keyboardMode: 'mnemonic', onSubmit: visit.rate }} />;
      };
      dispose = render(() => <LearningWorkspace><Task /></LearningWorkspace>, container);
      key(' '); key('3');
      expect(visit.reveal).toHaveBeenCalledOnce(); expect(visit.rate).toHaveBeenCalledOnce();
      for (const previous of visits.slice(0, index)) {
        expect(previous.reveal).toHaveBeenCalledOnce(); expect(previous.rate).toHaveBeenCalledOnce();
      }
      dispose(); dispose = undefined;
      key(' '); key('3');
      expect(visit.reveal).toHaveBeenCalledOnce(); expect(visit.rate).toHaveBeenCalledOnce();
    }
  });
  it('owns reveal, rating and Undo in one listener and releases all task handlers', () => {
    const rated = vi.fn(), undo = vi.fn();
    const listen = vi.spyOn(window, 'addEventListener');
    const container = document.createElement('div'); document.body.append(container);
    const Task = () => {
      const [revealed, reveal] = createSignal(false);
      useLearningInput('surface', event => { if (event.ctrlKey && event.key === 'z') { event.preventDefault(); undo(); } });
      return <StudyEncounter prompt="Cue" answer="Answer" revealed={revealed()} onReveal={() => reveal(true)}
        rating={{ capabilities: ['sense-recognition'], armed: true, keyboardMode: 'mnemonic', onSubmit: rated }} />;
    };
    dispose = render(() => <LearningWorkspace><Task /></LearningWorkspace>, container);
    const key = (value: string, options: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, cancelable: true, ...options }));
    expect(listen.mock.calls.filter(([name]) => name === 'keydown')).toHaveLength(1);
    key('3'); expect(rated).not.toHaveBeenCalled();
    key(' ', { isComposing: true }); expect(container.textContent).not.toContain('Answer');
    key(' ', { repeat: true }); expect(container.textContent).not.toContain('Answer');
    key(' '); expect(container.textContent).toContain('Answer'); expect(rated).not.toHaveBeenCalled();
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
    key('3'); expect(rated).not.toHaveBeenCalled(); dialog.remove();
    key('z', { ctrlKey: true }); expect(undo).toHaveBeenCalledOnce();
    key('3'); expect(rated).toHaveBeenCalledOnce();
    dispose(); key('z', { ctrlKey: true }); expect(undo).toHaveBeenCalledOnce();
  });
});
