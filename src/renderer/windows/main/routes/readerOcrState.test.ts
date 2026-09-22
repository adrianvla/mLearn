import { describe, expect, it } from 'vitest';
import { createReaderOcrState } from './readerOcrState';
import type { OcrResult } from '../../../components/reader';

const result = (text: string): OcrResult => ({ boxes: [{ text, box: [[0, 0], [1, 0], [1, 1], [0, 1]] }] });

describe('reader OCR content lifetime', () => {
  it('requires fresh OCR when another book has the same page filename', () => {
    const state = createReaderOcrState();
    state.capture().write('page-0-001.jpg', result('first book'));
    state.reset();
    expect(state.results['page-0-001.jpg']).toBeUndefined();
    state.capture().write('page-0-001.jpg', result('second book'));
    expect(state.results['page-0-001.jpg'].boxes[0].text).toBe('second book');
  });

  it('discards delayed OCR from a replaced book without overwriting its replacement', async () => {
    const state = createReaderOcrState();
    const oldRequest = state.capture();
    let resolve!: (value: OcrResult) => void;
    const pending = new Promise<OcrResult>((done) => { resolve = done; })
      .then((response) => oldRequest.write('page-0-001.jpg', response));
    state.reset();
    state.capture().write('page-0-001.jpg', result('replacement'));
    resolve(result('stale'));
    expect(await pending).toBe(false);
    expect(state.results['page-0-001.jpg'].boxes[0].text).toBe('replacement');
    expect(oldRequest.isCurrent()).toBe(false);
  });

  it('invalidates requests across language changes even when changing back', () => {
    const state = createReaderOcrState();
    const firstLanguage = state.capture();
    state.reset();
    state.reset();
    expect(firstLanguage.write('page', result('outdated language data'))).toBe(false);
    expect(state.results.page).toBeUndefined();
  });
});
