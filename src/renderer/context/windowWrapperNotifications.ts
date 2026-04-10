const ANKI_CACHE_STATUS_FRAGMENT = 'Loaded from cache';

export interface AnkiCacheToastGate {
  shouldShow: (statusMessage: string, localizationReady: boolean) => boolean;
}

export function createAnkiCacheToastGate(): AnkiCacheToastGate {
  let lastShownStatusMessage: string | null = null;

  return {
    shouldShow(statusMessage: string, localizationReady: boolean): boolean {
      if (!statusMessage.includes(ANKI_CACHE_STATUS_FRAGMENT)) {
        lastShownStatusMessage = null;
        return false;
      }

      if (!localizationReady) {
        return false;
      }

      if (lastShownStatusMessage === statusMessage) {
        return false;
      }

      lastShownStatusMessage = statusMessage;
      return true;
    },
  };
}