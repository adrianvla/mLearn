// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DEFAULT_SETTINGS, type LanguageData, type Token } from '../../../../shared/types';

const state = vi.hoisted(() => ({
  language: (): string => 'ja', sourceKey: (): string => 'source-a', data: () => null as LanguageData | null,
  translate: vi.fn(),
}));
vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, language: 'ru', coloredProsodyEnabled: true,
    dictionaryTargetLanguages: { ja: 'en', 'future-package': 'fr' } } }),
  useLanguage: () => ({ currentLangData: () => state.data(), currentLanguage: () => state.language(),
    currentSourceKey: () => state.sourceKey(), languageDataCatalog: () => [],
    getLanguageFeatures: () => ({ tokenizerCapabilities: { providesLemmas: true } }), supportsGrammar: () => false }),
  useFlashcards: () => ({}),
}));
vi.mock('../../../../shared/backends', async importOriginal => {
  const backend = { translate: (...args: unknown[]) => state.translate(...args) };
  return { ...await importOriginal<typeof import('../../../../shared/backends')>(), getBackend: () => backend };
});
vi.mock('../../../services/offlineCache', async importOriginal => ({
  ...await importOriginal<typeof import('../../../services/offlineCache')>(),
  setCachedTranslationBatchByLanguageDB: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../components/reader/OcrWord', () => ({ OcrWord: (props: { token: Token }) => <span>{props.token.word}</span> }));
import { ReaderTextPage } from './ReaderRoute';

const metadata = (revision: string): LanguageData => ({ name: 'Package-defined source', settings: { fixed: {} },
  resolvedVariantId: revision, prosody: { type: 'package-pattern', coloring: {
    renderer: 'pitch-accent-category', paletteId: 'source-palette', colors: {}, labels: {},
  } } });
const token = (word: string): Token => ({ word, actual_word: word, type: 'package-category' });
const page = (word: string) => ({ id: 'unchanged-page', kind: 'text' as const, text: word, name: 'Authored page', index: 0 });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  state.translate.mockReset().mockImplementation(async (word: string) => ({ data: [{ reading: word, definitions: ['Source meaning'] }] }));
  state.language = () => 'ja'; state.sourceKey = () => 'source-a'; state.data = () => metadata('author-v1');
});

describe('Reader text page admitted dictionary warming', () => {
  it('uses the actual mounted source, variant and target while Study remains Russian', async () => {
    const host = document.createElement('div');
    const word = 'source-warm-one';
    const dispose = render(() => <ReaderTextPage page={page(word)} tokenizeMany={async () => [[token(word)]]}
      tokenJoinSeparator="" onWordHover={() => undefined} onWordLeave={() => undefined} />, host);
    try {
      await vi.waitFor(() => expect(state.translate).toHaveBeenCalled());
      expect(state.translate).toHaveBeenCalledWith(word, 'ja', { variant: 'author-v1', dictionaryTargetLanguage: 'en' });
      expect(state.translate.mock.calls.every(call => call[1] !== 'ru')).toBe(true);
      expect(host.textContent).toContain(word);
    } finally { dispose(); }
  });

  it('rejects late old-source token publication and rewarms unchanged text for the new source', async () => {
    const [source, setSource] = createSignal('ja');
    state.language = source; state.sourceKey = () => `resource:${source()}`;
    state.data = () => metadata(source() === 'ja' ? 'author-v1' : 'author-v2');
    const first = deferred<Token[][]>(), second = deferred<Token[][]>();
    const tokenizeMany = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const host = document.createElement('div'), word = 'source-warm-two';
    const dispose = render(() => <ReaderTextPage page={page(word)} tokenizeMany={tokenizeMany}
      tokenJoinSeparator="" onWordHover={() => undefined} onWordLeave={() => undefined} />, host);
    try {
      setSource('future-package');
      expect(tokenizeMany).toHaveBeenCalledTimes(2);
      first.resolve([[token('stale-source-token')]]);
      await Promise.resolve(); await Promise.resolve();
      expect(state.translate).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain('stale-source-token');
      second.resolve([[token(word)]]);
      await vi.waitFor(() => expect(state.translate).toHaveBeenCalled());
      expect(state.translate).toHaveBeenCalledWith(word, 'future-package', { variant: 'author-v2', dictionaryTargetLanguage: 'fr' });
    } finally { dispose(); }
  });
  it('joins identical simultaneous page warmers at the underlying backend boundary', async () => {
    const { warmTranslationCache } = await import('../../../hooks/useTranslation');
    const response = deferred<{ data: { definitions: string[] }[] }>();
    state.translate.mockReturnValue(response.promise);
    const data = metadata('concurrent-source');
    const first = warmTranslationCache(['shared-source-word'], undefined, undefined, 'ja', 'en', data);
    const second = warmTranslationCache(['shared-source-word'], undefined, undefined, 'ja', 'en', data);
    try {
      await Promise.resolve(); await Promise.resolve();
      expect(state.translate).toHaveBeenCalledOnce();
    } finally {
      response.resolve({ data: [{ definitions: ['Source meaning'] }] });
      await Promise.all([first, second]);
    }
  });

});
