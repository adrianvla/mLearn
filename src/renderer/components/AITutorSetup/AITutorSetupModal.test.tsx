// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { AITutorSetupModal } from './AITutorSetupModal';
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: () => ({ supportsGrammar: () => true }) }));
vi.mock('../common', () => ({
  Modal: (props: { children?: JSX.Element; footer?: JSX.Element }) => <div>{props.children}{props.footer}</div>,
  Btn: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Textarea: (props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  RadioChoice: (props: { name: string; label: string; checked: boolean; onChange: () => void }) => (
    <label><input type="radio" name={props.name} checked={props.checked} onChange={props.onChange} />{props.label}</label>
  ),
  HintText: (props: { children?: JSX.Element }) => <p>{props.children}</p>,
  TabContainer: () => <div>Manual selection tabs</div>,
}));
vi.mock('./GrammarSelector', () => ({ GrammarSelector: () => <div>Grammar selector</div> }));
vi.mock('./WordSelector', () => ({ WordSelector: () => <div>Word selector</div> }));
vi.mock('./MediaSelector', () => ({ MediaSelector: () => <div>Media selector</div> }));

describe('tutor purpose workflow', () => {
  it('starts with a practice purpose and keeps item selection behind an explicit advanced control', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const start = vi.fn();
    const dispose = render(() => <AITutorSetupModal isOpen onClose={() => undefined} onStart={start} />, host);
    expect(host.querySelector('input[type="radio"]:checked')).not.toBeNull();
    expect(host.textContent).not.toContain('Grammar selector');
    const input = host.querySelector('textarea')!;
    input.value = 'Help me describe my work.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const advanced = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'mlearn.AITutorSetup.Advanced');
    advanced?.click();
    expect(host.textContent).toContain('Grammar selector');
    expect(host.querySelector('textarea')).toBeNull();
    Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.Back')?.click();
    expect(host.querySelector('textarea')?.value).toBe('Help me describe my work.');
    Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'mlearn.AITutorSetup.StartSession')?.click();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      customInstructions: expect.stringContaining('Help me describe my work.'),
      selectedWords: [], selectedGrammar: [],
    }));
    expect(start.mock.calls[0][0].customInstructions).toContain('mlearn.AITutorSetup.IntentPlan');
    dispose();
    host.remove();
  });
});
