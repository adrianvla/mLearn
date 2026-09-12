// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type ComponentProps } from 'solid-js';
import { DEFAULT_SETTINGS, type Token } from '../../../../shared/types';

vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, coloredProsodyEnabled: false } }),
  useLanguage: () => ({ currentLangData: () => null, getLanguageFeatures: () => ({}), supportsGrammar: () => false }),
  useFlashcards: () => ({}),
}));
vi.mock('../../../components/reader/OcrWord', () => ({ OcrWord: (props: { token: Token }) => <span>{props.token.word}</span> }));

import { ReaderTextPage } from './ReaderRoute';

const page: ComponentProps<typeof ReaderTextPage>['page'] = { id: 'chapter-1', kind: 'text', text: '会う', name: 'Chapter', index: 0 };
const tokens: Token[] = [{ word: '会う', surface: '会う', actual_word: '会う', type: 'verb' }];

describe('Reader text page token publication', () => {
  it('publishes EPUB paragraph tokens with real context and no invented OCR geometry', async () => {
    const onTokenDataChange = vi.fn();
    const host = document.createElement('div');
    const dispose = render(() => <ReaderTextPage page={page} tokenizeMany={async () => [tokens]}
      tokenJoinSeparator="" onWordHover={() => undefined} onWordLeave={() => undefined}
      onTokenDataChange={onTokenDataChange} />, host);
    await Promise.resolve();
    await Promise.resolve();
    expect(host.textContent).toContain('会う');
    expect(onTokenDataChange).toHaveBeenLastCalledWith([{ boxIndex: 0, tokens, contextPhrase: '会う' }]);
    dispose();
  });

  it('clears previously published words when replacement text cannot tokenize', async () => {
    const [currentPage, setPage] = createSignal(page);
    const onTokenDataChange = vi.fn();
    const tokenizeMany = vi.fn().mockResolvedValueOnce([tokens]).mockRejectedValueOnce(new Error('offline'));
    const host = document.createElement('div');
    const dispose = render(() => <ReaderTextPage page={currentPage()} tokenizeMany={tokenizeMany}
      tokenJoinSeparator="" onWordHover={() => undefined} onWordLeave={() => undefined}
      onTokenDataChange={onTokenDataChange} />, host);
    await Promise.resolve();
    await Promise.resolve();
    setPage({ ...page, text: '別の本文' });
    await Promise.resolve();
    await Promise.resolve();
    expect(onTokenDataChange).toHaveBeenLastCalledWith([]);
    dispose();
  });
});
