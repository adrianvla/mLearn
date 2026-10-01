// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { WordHover } from './WordHover';

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
vi.mock('../common/Smart', () => ({ ResourcePill: () => null, WordStatusPill: () => null }));

describe('shared popup presentation', () => {
  let host: HTMLDivElement;
  let dispose: (() => void) | undefined;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    setSettings({ ...DEFAULT_SETTINGS });
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
});
