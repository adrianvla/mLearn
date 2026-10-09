// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, type ComponentProps } from 'solid-js';
import { DEFAULT_SETTINGS, type Token } from '../../../../shared/types';
import { hashWordSync } from '../../../services/srsAlgorithm';

vi.mock('../../../context', () => ({
  useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, coloredProsodyEnabled: false } }),
  useLanguage: () => ({ currentLangData: () => null, currentLanguage: () => 'ja', currentSourceKey: () => 'epub-resource', getLanguageFeatures: () => ({}), supportsGrammar: () => false }),
  useFlashcards: () => ({}),
}));
vi.mock('../../../components/reader/OcrWord', () => ({ OcrWord: (props: { token: Token }) => <span>{props.token.word}</span> }));

import { ReaderTextPage } from './ReaderRoute';

const page: ComponentProps<typeof ReaderTextPage>['page'] = {
  id: 'chapter-1', kind: 'text', text: '会う', name: 'Chapter', index: 0,
  sourceChunks: [{ sourceIndex: 0, blockStart: 11, sourceStart: 11 }],
};
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
    expect(onTokenDataChange).toHaveBeenLastCalledWith([{
      boxIndex: 0, tokens, contextPhrase: '会う', pageContentId: hashWordSync('会う'),
      sourceChunk: { sourceIndex: 0, blockStart: 11, sourceStart: 11 },
    }]);
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

  it('keeps the body source anchor when the first block is a heading', async () => {
    const onTokenDataChange = vi.fn();
    const host = document.createElement('div');
    const titledPage = {
      ...page, title: 'Chapter', text: 'Chapter\n\n会う',
      sourceChunks: [
        { sourceIndex: 0, blockStart: 0, sourceStart: 0 },
        { sourceIndex: 0, blockStart: 9, sourceStart: 9 },
      ],
    };
    const dispose = render(() => <ReaderTextPage page={titledPage} tokenizeMany={async () => [tokens]}
      tokenJoinSeparator="" onWordHover={() => undefined} onWordLeave={() => undefined}
      onTokenDataChange={onTokenDataChange} />, host);
    await Promise.resolve();
    await Promise.resolve();
    expect(onTokenDataChange).toHaveBeenLastCalledWith([{
      boxIndex: 0, tokens, contextPhrase: '会う', pageContentId: hashWordSync('Chapter\n\n会う'),
      sourceChunk: { sourceIndex: 0, blockStart: 9, sourceStart: 9 },
    }]);
    dispose();
  });
});
