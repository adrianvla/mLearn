// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { OcrOverlay, type OcrResult } from './OcrOverlay';

const mocks = vi.hoisted(() => ({
  tokenize: vi.fn(),
  trackWordHovered: vi.fn(),
  cancelWordHover: vi.fn(),
  getAccessStatus: vi.fn(() => ({ status: 'unknown' as const, ease: 0, source: 'None' as const, untracked: true })),
}));

vi.mock('../../hooks', () => ({
  useTokenizer: () => ({ tokenize: mocks.tokenize }),
  warmTranslationCache: vi.fn(),
}));

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: {
      language: 'test',
      uiLanguage: 'en',
      readerWordHoverTrigger: 'hover',
    },
  }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getAccessStatus: mocks.getAccessStatus,
    trackWordHovered: mocks.trackWordHovered,
    cancelWordHover: mocks.cancelWordHover,
    getComprehensiveWordStatusWithSourceSync: () => ({ status: 'unknown', source: 'None', timesSeen: 0 }),
  }),
  useLanguage: () => ({
    isTokenTranslatable: () => true,
    getLanguageFeatures: () => ({
      supportsReadings: false,
      supportsVerticalText: true,
      tokenizerCapabilities: {},
    }),
    currentLangData: () => null,
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getReadingVariants: (reading: string) => [reading],
  }),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

describe('OcrOverlay', () => {
  let container: HTMLDivElement;
  let image: HTMLImageElement;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    container = document.createElement('div');
    document.body.appendChild(container);
    image = document.createElement('img');
    Object.defineProperties(image, {
      clientWidth: { value: 1000 },
      clientHeight: { value: 1000 },
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 1000 },
      offsetLeft: { value: 0 },
      offsetTop: { value: 0 },
    });
    mocks.tokenize.mockReset();
    mocks.getAccessStatus.mockClear();
    mocks.trackWordHovered.mockReset();
    mocks.cancelWordHover.mockReset();
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it('makes a new OCR box hoverable before asynchronous tokenization resolves', async () => {
    mocks.tokenize.mockReturnValue(new Promise(() => {}));
    const onWordHover = vi.fn();
    const result: OcrResult = {
      boxes: [{
        box: [[100, 100], [250, 100], [250, 200], [100, 200]],
        text: 'new crop',
        is_vertical: false,
      }],
      sent_size: { width: 1000, height: 1000 },
    };

    const dispose = render(() => (
      <OcrOverlay
        result={result}
        imageElement={image}
        onWordHover={onWordHover}
      />
    ), container);
    await Promise.resolve();

    const word = container.querySelector('.ocr-word');
    expect(word).not.toBeNull();
    expect(mocks.getAccessStatus).toHaveBeenCalledWith('new crop', 'surface-recognition', 'test');
    expect(mocks.getAccessStatus).toHaveBeenCalledWith('new crop', 'sense-recognition', 'test');
    word?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(onWordHover).toHaveBeenCalledOnce();

    dispose();
  });

  it('does not publish tokens from a previous page after the page changes', async () => {
    const pending = new Map<string, (tokens: Array<{ word: string; surface: string; type: string }>) => void>();
    mocks.tokenize.mockImplementation((text: string) => new Promise((resolve) => pending.set(text, resolve)));
    const makeResult = (text: string): OcrResult => ({
      boxes: [{ box: [[100, 100], [250, 100], [250, 200], [100, 200]], text }],
      sent_size: { width: 1000, height: 1000 },
    });
    const [result, setResult] = createSignal(makeResult('first page'));
    const onTokenDataChange = vi.fn();
    const dispose = render(() => (
      <OcrOverlay result={result()} imageElement={image} onTokenDataChange={onTokenDataChange} />
    ), container);

    setResult(makeResult('second page'));
    pending.get('first page')?.([{ word: 'first', surface: 'first', type: 'word' }]);
    await Promise.resolve();
    expect(onTokenDataChange.mock.lastCall?.[0]).toEqual([]);
    pending.get('second page')?.([{ word: 'second', surface: 'second', type: 'word' }]);
    await Promise.resolve();
    expect(onTokenDataChange.mock.lastCall?.[0][0].tokens[0].word).toBe('second');

    dispose();
  });
});
