// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { OcrOverlay, type OcrResult } from './OcrOverlay';

const mocks = vi.hoisted(() => ({
  tokenize: vi.fn(),
  trackWordHovered: vi.fn(),
  cancelWordHover: vi.fn(),
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
    trackWordHovered: mocks.trackWordHovered,
    cancelWordHover: mocks.cancelWordHover,
  }),
  useLanguage: () => ({
    isTokenTranslatable: () => true,
    getLanguageFeatures: () => ({
      supportsReadings: false,
      supportsVerticalText: true,
      tokenizerCapabilities: {},
    }),
    currentLangData: () => null,
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
    word?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(onWordHover).toHaveBeenCalledOnce();

    dispose();
  });
});
