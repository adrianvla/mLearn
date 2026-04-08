export {};

declare global {
  interface MLearnLiveTranslatorApi {
    addCard: (word: string, reading: string, translationDef?: string) => void;
    removeCard: (cardId: string) => void;
    show: () => void;
    hide: () => void;
    isVisible: () => boolean;
  }

  interface MLearnSubtitleSyncApi {
    show: () => void;
    hide: () => void;
    isVisible: () => boolean;
  }

  interface Window {
    mlearn?: {
      changeTrafficLights?: (visible: boolean) => void;
      captureScreen?: () => Promise<string>;
    };
    mLearnLiveTranslator?: MLearnLiveTranslatorApi;
    mLearnSubtitleSync?: MLearnSubtitleSyncApi;
  }
}