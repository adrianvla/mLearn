export type ReaderOcrAutomationState =
  | { kind: 'disabled' }
  | { kind: 'waiting-for-language-data' }
  | { kind: 'blocked'; message: string }
  | { kind: 'ready' };

const OCR_READINESS_ERROR_PREFIXES = [
  'Language data is required before running OCR for ',
  'OCR runtime language data is required for ',
] as const;

interface ResolveReaderOcrAutomationStateOptions {
  ocrEnabled: boolean;
  languageDataLoading: boolean;
  readinessError: string | null;
}

export function resolveReaderOcrAutomationState(
  options: ResolveReaderOcrAutomationStateOptions,
): ReaderOcrAutomationState {
  if (!options.ocrEnabled) {
    return { kind: 'disabled' };
  }

  if (options.languageDataLoading) {
    return { kind: 'waiting-for-language-data' };
  }

  if (options.readinessError) {
    return { kind: 'blocked', message: options.readinessError };
  }

  return { kind: 'ready' };
}

export function readerOcrCanQueue(state: ReaderOcrAutomationState): boolean {
  return state.kind === 'ready';
}

export function readerOcrShouldClearStatus(state: ReaderOcrAutomationState): boolean {
  return state.kind === 'disabled' || state.kind === 'waiting-for-language-data';
}

export function isReaderOcrReadinessErrorMessage(message: string): boolean {
  return OCR_READINESS_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix));
}
