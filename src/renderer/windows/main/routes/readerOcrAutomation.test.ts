import {
  isReaderOcrReadinessErrorMessage,
  readerOcrCanQueue,
  readerOcrShouldClearStatus,
  resolveReaderOcrAutomationState,
} from './readerOcrAutomation';

describe('reader OCR automation state', () => {
  it('does not queue OCR when OCR is disabled', () => {
    const state = resolveReaderOcrAutomationState({
      ocrEnabled: false,
      languageDataLoading: true,
      readinessError: 'OCR runtime language data is required for ja',
    });

    expect(state).toEqual({ kind: 'disabled' });
    expect(readerOcrCanQueue(state)).toBe(false);
    expect(readerOcrShouldClearStatus(state)).toBe(true);
  });

  it('waits quietly while selected language metadata is still loading', () => {
    const state = resolveReaderOcrAutomationState({
      ocrEnabled: true,
      languageDataLoading: true,
      readinessError: 'Language data is required before running OCR for ja',
    });

    expect(state).toEqual({ kind: 'waiting-for-language-data' });
    expect(readerOcrCanQueue(state)).toBe(false);
    expect(readerOcrShouldClearStatus(state)).toBe(true);
  });

  it('blocks when selected language data is still missing after loading finished', () => {
    const state = resolveReaderOcrAutomationState({
      ocrEnabled: true,
      languageDataLoading: false,
      readinessError: 'Language data is required before running OCR for ja',
    });

    expect(state).toEqual({
      kind: 'blocked',
      message: 'Language data is required before running OCR for ja',
    });
    expect(readerOcrCanQueue(state)).toBe(false);
    expect(readerOcrShouldClearStatus(state)).toBe(false);
  });

  it('blocks with a visible readiness message only after language data is loaded', () => {
    const state = resolveReaderOcrAutomationState({
      ocrEnabled: true,
      languageDataLoading: false,
      readinessError: 'OCR runtime language data is required for ja',
    });

    expect(state).toEqual({
      kind: 'blocked',
      message: 'OCR runtime language data is required for ja',
    });
    expect(readerOcrCanQueue(state)).toBe(false);
    expect(readerOcrShouldClearStatus(state)).toBe(false);
  });

  it('queues OCR only when enabled language metadata declares an OCR runtime', () => {
    const state = resolveReaderOcrAutomationState({
      ocrEnabled: true,
      languageDataLoading: false,
      readinessError: null,
    });

    expect(state).toEqual({ kind: 'ready' });
    expect(readerOcrCanQueue(state)).toBe(true);
    expect(readerOcrShouldClearStatus(state)).toBe(false);
  });

  it('identifies readiness errors as queue blockers instead of OCR engine failures', () => {
    expect(isReaderOcrReadinessErrorMessage('Language data is required before running OCR for ja')).toBe(true);
    expect(isReaderOcrReadinessErrorMessage('OCR runtime language data is required for ja')).toBe(true);
    expect(isReaderOcrReadinessErrorMessage('OCR request failed: 500 - model crashed')).toBe(false);
  });
});
