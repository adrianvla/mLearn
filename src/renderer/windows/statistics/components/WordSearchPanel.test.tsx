// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render } from 'solid-js/web';
import { WordSearchPanel } from './WordSearchPanel';
import { openKnowledgeInspector } from '../../../services/openKnowledgeInspector';
vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { language: 'synthetic' } }),
  useFlashcards: () => ({ store: { wordKnowledge: { 'synthetic:key': { word: 'example' } }, flashcards: {} } }),
}));
vi.mock('../../../services/openKnowledgeInspector', () => ({ openKnowledgeInspector: vi.fn() }));
describe('WordSearchPanel', () => {
  it('opens the canonical inspector on selection without mounting a graph or loading a projection', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => <WordSearchPanel />, host);
    const input = host.querySelector('input')!;
    input.value = 'exam'; input.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector('button')!.click();
    expect(openKnowledgeInspector).toHaveBeenCalledWith(expect.objectContaining({ surface: 'example', language: 'synthetic', target: expect.objectContaining({ kind: 'surface' }) }));
    expect(host.querySelector('svg')).toBeNull();
    dispose(); host.remove();
  });
});
