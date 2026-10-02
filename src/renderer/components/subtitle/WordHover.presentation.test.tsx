// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { WordHover } from './WordHover';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';

const inspect = vi.hoisted(() => vi.fn());
vi.mock('../../services/openKnowledgeInspector', async original => ({
  ...await original<typeof import('../../services/openKnowledgeInspector')>(), openKnowledgeInspector: inspect,
}));

const [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS });

vi.mock('../../context', () => ({
  useSettings: () => ({ settings, updateSettings: (next: object) => setSettings(next) }),
  useLocalization: () => ({ t: (key: string) => key }),
  useFlashcards: () => ({
    addFlashcard: vi.fn(), getCardByWordSync: () => null,
    getComprehensiveWordStatusWithSourceSync: () => ({ status: 'unknown' }),
  }),
  useLanguage: () => ({
    currentLangData: () => null, getFrequency: () => null,
    getLevelName: () => '', getFreqLevelNames: () => ({}),
    getLanguageFeatures: () => ({ tokenizerCapabilities: {} }),
    getCanonicalForm: (word: string) => word, getWordVariants: (word: string) => [word],
  }),
}));
vi.mock('../../hooks/useDictionaryTargetLanguage', () => ({ useDictionaryTargetLanguage: () => () => 'en' }));
vi.mock('../../hooks/useTranslation', () => ({ useTokenizer: () => ({ tokenize: vi.fn() }), getCachedTranslation: () => null }));
vi.mock('../../services/llmProvider', () => ({ getCachedExplanation: () => null }));
vi.mock('../common/Smart', () => ({ ResourcePill: () => null,
  WordStatusPill: (props: { onInspect?: () => void; cycleClaims?: boolean; suppressKnowledgePopover?: boolean }) =>
    <button data-testid="status-record" data-cycle-claims={String(props.cycleClaims === true)}
      data-nested-popover={String(!props.suppressKnowledgePopover)} onClick={props.onInspect}>Status</button>,
}));

describe('shared popup presentation', () => {
  let host: HTMLDivElement;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    setSettings({ ...DEFAULT_SETTINGS });
    inspect.mockClear();
  });
  afterEach(() => { dispose?.(); host.remove(); });

  it('retains dictionary alternatives and updates an open popup from shared preferences', () => {
    dispose = render(() => <WordHover word="form" token={{ word: 'form', actual_word: 'form', type: 'noun' }} position={{ x: 200, y: 200 }}
      translationData={{ data: [{ definitions: 'short meaning' }] }}
      dictionaryEntries={[
        { word: 'form', reading: '', meanings: ['first distinct meaning'] },
        { word: 'form', reading: '', meanings: ['second distinct meaning'] },
      ]} />, host);
    const popup = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(popup.textContent).toContain('short meaning');
    expect(popup.textContent).toContain('first distinct meaning');
    expect(popup.textContent).toContain('second distinct meaning');
    expect(popup.style.getPropertyValue('--word-hover-scale')).toBe('1');
    setSettings({ showReadingAnnotations: false });
    expect(popup.classList.contains('word-hover--readings-hidden')).toBe(true);
    setSettings({ showReadingAnnotations: true });
    expect(popup.classList.contains('word-hover--readings-hidden')).toBe(false);
    setSettings({ wordHoverSizePercent: 75 });
    expect(popup.style.getPropertyValue('--word-hover-scale')).toBe('0.75');
    setSettings({ wordHoverSizePercent: Infinity });
    expect(popup.style.getPropertyValue('--word-hover-scale')).toBe('1');
  });

  it('opens the same dictionary identity from status and Inspect without cycling claims or a nested rating popup', () => {
    setSettings({ language: 'future-language' });
    dispose = render(() => <WordHover word="walk" token={{ word: 'walked', actual_word: 'walk', type: 'verb' }}
      position={{ x: 200, y: 200 }} translationData={{ data: [{ definitions: 'go on foot' }] }} />, host);
    const status = host.querySelector<HTMLButtonElement>('[data-testid="status-record"]')!;
    expect(status.dataset.cycleClaims).toBe('false');
    expect(status.dataset.nestedPopover).toBe('false');
    status.click();
    host.querySelector<HTMLButtonElement>('.word-hover-inspect')!.click();
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(inspect.mock.calls[0]).toEqual(inspect.mock.calls[1]);
    expect(inspect).toHaveBeenCalledWith(surfaceKnowledgeInspection(settings.language, 'walk'));
  });
});
