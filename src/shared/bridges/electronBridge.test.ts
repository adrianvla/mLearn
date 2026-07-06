import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function createMockIPC() {
  return {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    onSettings: vi.fn(),
    onSettingsSaved: vi.fn(),
    getFlashcards: vi.fn(),
    saveFlashcards: vi.fn(),
    onFlashcards: vi.fn(),
    onNewDayFlashcards: vi.fn(),
    onFlashcardConnectOpen: vi.fn(),
    onReviewFlashcardRequest: vi.fn(),
    saveFlashcardImage: vi.fn(),
    resolveFlashcardImage: vi.fn(),
    deleteFlashcardImage: vi.fn(),
    saveFlashcardVideo: vi.fn(),
    deleteFlashcardVideo: vi.fn(),
    getFlashcardTts: vi.fn(),
    generateFlashcardTts: vi.fn(),
    batchGenerateFlashcardTts: vi.fn(),
    getFlashcardTtsMeta: vi.fn(),
    deleteFlashcardTts: vi.fn(),
    getLocalization: vi.fn(),
    onLocalization: vi.fn(),
    changeUILanguage: vi.fn(),
    getLangData: vi.fn(),
    onLangData: vi.fn(),
    getLanguageDataCatalog: vi.fn(),
    onLanguageDataCatalog: vi.fn(),
    installLanguageData: vi.fn(),
    onLanguageDataInstalled: vi.fn(),
    onLanguageDataInstallError: vi.fn(),
    installLanguage: vi.fn(),
    onLanguageInstalled: vi.fn(),
    onLanguageInstallError: vi.fn(),
    publishAppActivitySourceUpdate: vi.fn(),
    readDirectoryImages: vi.fn(),
    readPdfFile: vi.fn(),
    readMediaFile: vi.fn(),
    selectVideoFile: vi.fn(),
    selectSubtitleFile: vi.fn(),
    selectBookFolder: vi.fn(),
    selectPdfFile: vi.fn(),
    getLocalMediaUrl: vi.fn(),
    getPathForFile: vi.fn(),
    writeToClipboard: vi.fn(),
    changeTrafficLights: vi.fn(),
    resizeWindow: vi.fn(),
    makePiP: vi.fn(),
    unPiP: vi.fn(),
    showCtxMenu: vi.fn(),
    showReaderCtxMenu: vi.fn(),
    showContact: vi.fn(),
    openExternalUrl: vi.fn(),
    openWindow: vi.fn(),
    closeWindow: vi.fn(),
    getWindowContext: vi.fn(),
    onWindowContext: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAside: vi.fn(),
    onContextMenuCommand: vi.fn(),
    onReaderContextMenuCommand: vi.fn(),
    onOpenWordDbEditor: vi.fn(),
    onOpenLevelStudy: vi.fn(),
    onOpenPrompt: vi.fn(),
    onAuthDeepLink: vi.fn(),
    onLookupDeepLink: vi.fn(),
    promptOutput: vi.fn(),
    isLoaded: vi.fn(),
    isSuccess: vi.fn(),
    onServerLoad: vi.fn(),
    onServerStatusUpdate: vi.fn(),
    onServerCriticalError: vi.fn(),
    onAnkiConnectionError: vi.fn(),
    onOcrStatusUpdate: vi.fn(),
    restartApp: vi.fn(),
    forceRestartApp: vi.fn(),
    restartBackend: vi.fn(),
    getVersion: vi.fn(),
    onVersionReceive: vi.fn(),
    startInstall: vi.fn(),
    requestInstallerState: vi.fn(),
    onPythonSuccess: vi.fn(),
    onInstallStarted: vi.fn(),
    onInstallerAwaitingChoice: vi.fn(),
    onInstallerNetworkError: vi.fn(),
    onInstallerState: vi.fn(),
    onPipProgress: vi.fn(),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
    onLLMStreamChunk: vi.fn(),
    llmCheckModel: vi.fn(),
    llmDownloadModel: vi.fn(),
    onLLMDownloadProgress: vi.fn(),
    onLLMModelStatus: vi.fn(),
    llmUnloadModel: vi.fn(),
    ollamaChat: vi.fn(),
    ollamaChatStream: vi.fn(),
    ollamaChatStreamAbort: vi.fn(),
    onOllamaChatStream: vi.fn(),
    ollamaListModels: vi.fn(),
    ollamaCheck: vi.fn(),
    ollamaPullModel: vi.fn(),
    onOllamaPullModelProgress: vi.fn(),
    sttStart: vi.fn(),
    sttStop: vi.fn(),
    onSttResult: vi.fn(),
    ttsSpeak: vi.fn(),
    ttsStop: vi.fn(),
    onTtsStatus: vi.fn(),
    voiceCheckModels: vi.fn(),
    voiceDownloadModels: vi.fn(),
    onVoiceModelProgress: vi.fn(),
    voiceStartSession: vi.fn(),
    voiceStopSession: vi.fn(),
    voiceSendAudioChunk: vi.fn(),
    voiceFlush: vi.fn(),
    voiceUpdateSilenceThreshold: vi.fn(),
    onVoiceSttResult: vi.fn(),
    onVoiceVadEvent: vi.fn(),
    voiceTtsGenerate: vi.fn(),
    voiceTtsStop: vi.fn(),
    onVoiceTtsAudio: vi.fn(),
    onVoiceTtsStatus: vi.fn(),
    onVoiceSessionReady: vi.fn(),
    onVoiceSessionStatus: vi.fn(),
    onVoiceSessionError: vi.fn(),
    voiceSampleList: vi.fn(),
    voiceSampleUpload: vi.fn(),
    voiceSampleDelete: vi.fn(),
    voiceSampleRename: vi.fn(),
    voiceSampleTranscribe: vi.fn(),
    voiceSampleGetPath: vi.fn(),
    saveMediaStats: vi.fn(),
    getMediaStats: vi.fn(),
    onMediaStats: vi.fn(),
    listMediaStats: vi.fn(),
    onMediaStatsList: vi.fn(),
    isWatchingTogether: vi.fn(),
    watchTogetherSend: vi.fn(),
    onWatchTogetherLaunch: vi.fn(),
    onWatchTogetherRequest: vi.fn(),
    onUpdatePills: vi.fn(),
    onUpdateWordAppearance: vi.fn(),
    onUpdateAttemptFlashcardCreation: vi.fn(),
    onUpdateCreateFlashcard: vi.fn(),
    onUpdateLastWatched: vi.fn(),
    getLicenseType: vi.fn(),
    activateLicense: vi.fn(),
    removeLicense: vi.fn(),
    onLicenseGet: vi.fn(),
    onLicenseActivated: vi.fn(),
    getMigratedLocalStorage: vi.fn(),
    getMigratedItem: vi.fn(),
    hasMigrationOccurred: vi.fn(),
    triggerMigration: vi.fn(),
    onLocalStorageMigrationComplete: vi.fn(),
    onFlashcardMigrationComplete: vi.fn(),
    getFlashcardMigrationInfo: vi.fn(),
    sendLS: vi.fn(),
    fetchUrl: vi.fn(),
    dataExport: vi.fn(),
    dataImport: vi.fn(),
    kvGet: vi.fn(),
    kvSet: vi.fn(),
    kvRemove: vi.fn(),
    kvGetAll: vi.fn(),
    kvSetBatch: vi.fn(),
    detectBrowsers: vi.fn(),
    installExtension: vi.fn(),
    uninstallExtension: vi.fn(),
    isExtensionInstalled: vi.fn(),
    openExtensionFolder: vi.fn(),
    runDiagnostics: vi.fn(),
    onDiagnosticsProgress: vi.fn(),
    onDiagnosticsComplete: vi.fn(),
    saveDiagnosticsReport: vi.fn(),
  };
}

type MockIPC = ReturnType<typeof createMockIPC>;

let mockIPC: MockIPC;

const win = window as unknown as Record<string, unknown>;

beforeEach(() => {
  mockIPC = createMockIPC();
  win.mLearnIPC = mockIPC;
});

afterEach(() => {
  delete win.mLearnIPC;
});

import { createElectronBridge } from './electronBridge';

describe('createElectronBridge', () => {
  it('returns an object with all 20 sub-bridge keys', () => {
    const bridge = createElectronBridge();
    expect(bridge).toHaveProperty('settings');
    expect(bridge).toHaveProperty('flashcards');
    expect(bridge).toHaveProperty('localization');
    expect(bridge).toHaveProperty('files');
    expect(bridge).toHaveProperty('window');
    expect(bridge).toHaveProperty('server');
    expect(bridge).toHaveProperty('installer');
    expect(bridge).toHaveProperty('llm');
    expect(bridge).toHaveProperty('speech');
    expect(bridge).toHaveProperty('voice');
    expect(bridge).toHaveProperty('mediaStats');
    expect(bridge).toHaveProperty('watchTogether');
    expect(bridge).toHaveProperty('crossWindow');
    expect(bridge).toHaveProperty('license');
    expect(bridge).toHaveProperty('migration');
    expect(bridge).toHaveProperty('generic');
    expect(bridge).toHaveProperty('data');
    expect(bridge).toHaveProperty('kvStore');
    expect(bridge).toHaveProperty('browser');
    expect(bridge).toHaveProperty('diagnostics');
  });
});

describe('getIPC error case', () => {
  it('throws when window.mLearnIPC is undefined', () => {
    delete win.mLearnIPC;
    const bridge = createElectronBridge();
    expect(() => bridge.settings.getSettings()).toThrow(
      'ElectronBridge: window.mLearnIPC is not available',
    );
  });

  it('throws for any bridge method when window.mLearnIPC is undefined', () => {
    delete win.mLearnIPC;
    const bridge = createElectronBridge();
    expect(() => bridge.kvStore.kvGetAll()).toThrow(
      'ElectronBridge: window.mLearnIPC is not available',
    );
  });
});

describe('settingsBridge', () => {
  it('getSettings delegates to ipc.getSettings', () => {
    const bridge = createElectronBridge();
    bridge.settings.getSettings();
    expect(mockIPC.getSettings).toHaveBeenCalledOnce();
  });

  it('saveSettings passes settings argument to ipc.saveSettings', () => {
    const bridge = createElectronBridge();
    const settings = { theme: 'dark' } as never;
    bridge.settings.saveSettings(settings);
    expect(mockIPC.saveSettings).toHaveBeenCalledWith(settings);
  });

  it('onSettings passes callback to ipc.onSettings and returns its result', () => {
    const cb = vi.fn();
    const cleanup = vi.fn();
    mockIPC.onSettings.mockReturnValue(cleanup);
    const bridge = createElectronBridge();
    const result = bridge.settings.onSettings(cb);
    expect(mockIPC.onSettings).toHaveBeenCalledWith(cb);
    expect(result).toBe(cleanup);
  });

  it('onSettingsSaved passes callback to ipc.onSettingsSaved and returns its result', () => {
    const cb = vi.fn();
    const cleanup = vi.fn();
    mockIPC.onSettingsSaved.mockReturnValue(cleanup);
    const bridge = createElectronBridge();
    const result = bridge.settings.onSettingsSaved(cb);
    expect(mockIPC.onSettingsSaved).toHaveBeenCalledWith(cb);
    expect(result).toBe(cleanup);
  });
});

describe('flashcardBridge', () => {
  it('getFlashcards delegates to ipc.getFlashcards', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.getFlashcards();
    expect(mockIPC.getFlashcards).toHaveBeenCalledOnce();
  });

  it('saveFlashcards passes flashcards to ipc.saveFlashcards', () => {
    const bridge = createElectronBridge();
    const store = { version: 4 } as never;
    bridge.flashcards.saveFlashcards(store);
    expect(mockIPC.saveFlashcards).toHaveBeenCalledWith(store);
  });

  it('onFlashcards passes callback to ipc.onFlashcards', () => {
    const cb = vi.fn();
    const cleanup = vi.fn();
    mockIPC.onFlashcards.mockReturnValue(cleanup);
    const bridge = createElectronBridge();
    const result = bridge.flashcards.onFlashcards(cb);
    expect(mockIPC.onFlashcards).toHaveBeenCalledWith(cb);
    expect(result).toBe(cleanup);
  });

  it('onNewDayFlashcards passes callback to ipc.onNewDayFlashcards', () => {
    const cb = vi.fn();
    const cleanup = vi.fn();
    mockIPC.onNewDayFlashcards.mockReturnValue(cleanup);
    const bridge = createElectronBridge();
    const result = bridge.flashcards.onNewDayFlashcards(cb);
    expect(mockIPC.onNewDayFlashcards).toHaveBeenCalledWith(cb);
    expect(result).toBe(cleanup);
  });

  it('onFlashcardConnectOpen passes callback to ipc.onFlashcardConnectOpen', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.flashcards.onFlashcardConnectOpen(cb);
    expect(mockIPC.onFlashcardConnectOpen).toHaveBeenCalledWith(cb);
  });

  it('onReviewFlashcardRequest passes callback to ipc.onReviewFlashcardRequest', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.flashcards.onReviewFlashcardRequest(cb);
    expect(mockIPC.onReviewFlashcardRequest).toHaveBeenCalledWith(cb);
  });

  it('saveFlashcardImage passes cardId and dataUrl to ipc.saveFlashcardImage', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.saveFlashcardImage('card-1', 'data:image/png;base64,abc');
    expect(mockIPC.saveFlashcardImage).toHaveBeenCalledWith('card-1', 'data:image/png;base64,abc');
  });

  it('resolveFlashcardImage passes imageUrl to ipc.resolveFlashcardImage', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.resolveFlashcardImage('flashcard-image://card-1.png');
    expect(mockIPC.resolveFlashcardImage).toHaveBeenCalledWith('flashcard-image://card-1.png');
  });

  it('deleteFlashcardImage passes cardId to ipc.deleteFlashcardImage', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.deleteFlashcardImage('card-1');
    expect(mockIPC.deleteFlashcardImage).toHaveBeenCalledWith('card-1');
  });

  it('saveFlashcardVideo passes cardId and data to ipc.saveFlashcardVideo', () => {
    const bridge = createElectronBridge();
    const buf = new ArrayBuffer(8);
    bridge.flashcards.saveFlashcardVideo('card-1', buf);
    expect(mockIPC.saveFlashcardVideo).toHaveBeenCalledWith('card-1', buf);
  });

  it('deleteFlashcardVideo passes cardId to ipc.deleteFlashcardVideo', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.deleteFlashcardVideo('card-1');
    expect(mockIPC.deleteFlashcardVideo).toHaveBeenCalledWith('card-1');
  });

  it('getFlashcardTts passes cardId and field to ipc.getFlashcardTts', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.getFlashcardTts('card-1', 'word');
    expect(mockIPC.getFlashcardTts).toHaveBeenCalledWith('card-1', 'word');
  });

  it('generateFlashcardTts passes all arguments to ipc.generateFlashcardTts', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.generateFlashcardTts('card-1', 'hello', 'en', 'word', 'kokoro', 'sample-id', 'token', 'https://api.example.com');
    expect(mockIPC.generateFlashcardTts).toHaveBeenCalledWith('card-1', 'hello', 'en', 'word', 'kokoro', 'sample-id', 'token', 'https://api.example.com');
  });

  it('batchGenerateFlashcardTts passes all arguments to ipc.batchGenerateFlashcardTts', () => {
    const bridge = createElectronBridge();
    const items = [{ cardId: 'c1', text: 'hello', field: 'word' as const }];
    bridge.flashcards.batchGenerateFlashcardTts(items, 'en', 'kokoro', 'sample-id', 'token', 'https://api.example.com');
    expect(mockIPC.batchGenerateFlashcardTts).toHaveBeenCalledWith(items, 'en', 'kokoro', 'sample-id', 'token', 'https://api.example.com');
  });

  it('getFlashcardTtsMeta passes cardId and field to ipc.getFlashcardTtsMeta', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.getFlashcardTtsMeta('card-1', 'example');
    expect(mockIPC.getFlashcardTtsMeta).toHaveBeenCalledWith('card-1', 'example');
  });

  it('deleteFlashcardTts passes cardId to ipc.deleteFlashcardTts', () => {
    const bridge = createElectronBridge();
    bridge.flashcards.deleteFlashcardTts('card-1');
    expect(mockIPC.deleteFlashcardTts).toHaveBeenCalledWith('card-1');
  });
});

describe('localizationBridge', () => {
  it('getLocalization delegates to ipc.getLocalization', () => {
    const bridge = createElectronBridge();
    bridge.localization.getLocalization();
    expect(mockIPC.getLocalization).toHaveBeenCalledOnce();
  });

  it('onLocalization passes callback to ipc.onLocalization', () => {
    const cb = vi.fn();
    const cleanup = vi.fn();
    mockIPC.onLocalization.mockReturnValue(cleanup);
    const bridge = createElectronBridge();
    const result = bridge.localization.onLocalization(cb);
    expect(mockIPC.onLocalization).toHaveBeenCalledWith(cb);
    expect(result).toBe(cleanup);
  });

  it('changeUILanguage passes langCode to ipc.changeUILanguage', () => {
    const bridge = createElectronBridge();
    bridge.localization.changeUILanguage('ja');
    expect(mockIPC.changeUILanguage).toHaveBeenCalledWith('ja');
  });

  it('getLangData delegates to ipc.getLangData', () => {
    const bridge = createElectronBridge();
    bridge.localization.getLangData();
    expect(mockIPC.getLangData).toHaveBeenCalledOnce();
  });

  it('onLangData passes callback to ipc.onLangData', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.localization.onLangData(cb);
    expect(mockIPC.onLangData).toHaveBeenCalledWith(cb);
  });

  it('getLanguageDataCatalog delegates to ipc.getLanguageDataCatalog', () => {
    const bridge = createElectronBridge();
    bridge.localization.getLanguageDataCatalog();
    expect(mockIPC.getLanguageDataCatalog).toHaveBeenCalledOnce();
  });

  it('onLanguageDataCatalog passes callback to ipc.onLanguageDataCatalog', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.localization.onLanguageDataCatalog(cb);
    expect(mockIPC.onLanguageDataCatalog).toHaveBeenCalledWith(cb);
  });

  it('installLanguageData passes language and dictionary target to ipc.installLanguageData', () => {
    const bridge = createElectronBridge();
    bridge.localization.installLanguageData('de', 'fr');
    expect(mockIPC.installLanguageData).toHaveBeenCalledWith('de', 'fr');
  });

  it('onLanguageDataInstalled passes callback to ipc.onLanguageDataInstalled', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.localization.onLanguageDataInstalled(cb);
    expect(mockIPC.onLanguageDataInstalled).toHaveBeenCalledWith(cb);
  });

  it('onLanguageDataInstallError passes callback to ipc.onLanguageDataInstallError', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.localization.onLanguageDataInstallError(cb);
    expect(mockIPC.onLanguageDataInstallError).toHaveBeenCalledWith(cb);
  });

  it('installLanguage passes url to ipc.installLanguage', () => {
    const bridge = createElectronBridge();
    bridge.localization.installLanguage('https://example.com/lang.zip');
    expect(mockIPC.installLanguage).toHaveBeenCalledWith('https://example.com/lang.zip');
  });

  it('onLanguageInstalled passes callback to ipc.onLanguageInstalled', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.localization.onLanguageInstalled(cb);
    expect(mockIPC.onLanguageInstalled).toHaveBeenCalledWith(cb);
  });

  it('onLanguageInstallError passes callback to ipc.onLanguageInstallError', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.localization.onLanguageInstallError(cb);
    expect(mockIPC.onLanguageInstallError).toHaveBeenCalledWith(cb);
  });
});

describe('fileBridge', () => {
  it('readDirectoryImages passes dir to ipc.readDirectoryImages', () => {
    const bridge = createElectronBridge();
    bridge.files.readDirectoryImages('/some/dir');
    expect(mockIPC.readDirectoryImages).toHaveBeenCalledWith('/some/dir');
  });

  it('readPdfFile passes path to ipc.readPdfFile', () => {
    const bridge = createElectronBridge();
    bridge.files.readPdfFile('/some/file.pdf');
    expect(mockIPC.readPdfFile).toHaveBeenCalledWith('/some/file.pdf');
  });

  it('readMediaFile passes path to ipc.readMediaFile', () => {
    const bridge = createElectronBridge();
    bridge.files.readMediaFile('/some/video.mp4');
    expect(mockIPC.readMediaFile).toHaveBeenCalledWith('/some/video.mp4');
  });

  it('selectVideoFile delegates to ipc.selectVideoFile', () => {
    const bridge = createElectronBridge();
    bridge.files.selectVideoFile();
    expect(mockIPC.selectVideoFile).toHaveBeenCalledOnce();
  });

  it('selectSubtitleFile delegates to ipc.selectSubtitleFile', () => {
    const bridge = createElectronBridge();
    bridge.files.selectSubtitleFile();
    expect(mockIPC.selectSubtitleFile).toHaveBeenCalledOnce();
  });

  it('selectBookFolder delegates to ipc.selectBookFolder', () => {
    const bridge = createElectronBridge();
    bridge.files.selectBookFolder();
    expect(mockIPC.selectBookFolder).toHaveBeenCalledOnce();
  });

  it('selectPdfFile delegates to ipc.selectPdfFile', () => {
    const bridge = createElectronBridge();
    bridge.files.selectPdfFile();
    expect(mockIPC.selectPdfFile).toHaveBeenCalledOnce();
  });

  it('getLocalMediaUrl passes path to ipc.getLocalMediaUrl', () => {
    const bridge = createElectronBridge();
    bridge.files.getLocalMediaUrl('/local/video.mp4');
    expect(mockIPC.getLocalMediaUrl).toHaveBeenCalledWith('/local/video.mp4');
  });

  it('getPathForFile passes file to ipc.getPathForFile and returns result', () => {
    mockIPC.getPathForFile.mockReturnValue('/resolved/path.mp4');
    const bridge = createElectronBridge();
    const file = new File([], 'video.mp4');
    const result = bridge.files.getPathForFile(file);
    expect(mockIPC.getPathForFile).toHaveBeenCalledWith(file);
    expect(result).toBe('/resolved/path.mp4');
  });

  it('writeToClipboard passes text to ipc.writeToClipboard', () => {
    const bridge = createElectronBridge();
    bridge.files.writeToClipboard('copied text');
    expect(mockIPC.writeToClipboard).toHaveBeenCalledWith('copied text');
  });
});

describe('windowBridge', () => {
  it('changeTrafficLights passes visibility to ipc.changeTrafficLights', () => {
    const bridge = createElectronBridge();
    bridge.window.changeTrafficLights(true);
    expect(mockIPC.changeTrafficLights).toHaveBeenCalledWith(true);
  });

  it('resizeWindow passes size to ipc.resizeWindow', () => {
    const bridge = createElectronBridge();
    bridge.window.resizeWindow({ width: 800, height: 600 });
    expect(mockIPC.resizeWindow).toHaveBeenCalledWith({ width: 800, height: 600 });
  });

  it('makePiP passes size to ipc.makePiP', () => {
    const bridge = createElectronBridge();
    bridge.window.makePiP({ width: 400, height: 300 });
    expect(mockIPC.makePiP).toHaveBeenCalledWith({ width: 400, height: 300 });
  });

  it('unPiP delegates to ipc.unPiP', () => {
    const bridge = createElectronBridge();
    bridge.window.unPiP();
    expect(mockIPC.unPiP).toHaveBeenCalledOnce();
  });

  it('showCtxMenu passes options to ipc.showCtxMenu', () => {
    const bridge = createElectronBridge();
    bridge.window.showCtxMenu({ isWatchTogether: true });
    expect(mockIPC.showCtxMenu).toHaveBeenCalledWith({ isWatchTogether: true });
  });

  it('showReaderCtxMenu passes options to ipc.showReaderCtxMenu', () => {
    const bridge = createElectronBridge();
    bridge.window.showReaderCtxMenu({ readingAnnotationHiderEnabled: true, hasContextPhrase: false });
    expect(mockIPC.showReaderCtxMenu).toHaveBeenCalledWith({ readingAnnotationHiderEnabled: true, hasContextPhrase: false });
  });

  it('showContact delegates to ipc.showContact', () => {
    const bridge = createElectronBridge();
    bridge.window.showContact();
    expect(mockIPC.showContact).toHaveBeenCalledOnce();
  });

  it('openExternalUrl passes url to ipc.openExternalUrl and returns result', () => {
    mockIPC.openExternalUrl.mockResolvedValue(true);
    const bridge = createElectronBridge();
    bridge.window.openExternalUrl('https://example.com');
    expect(mockIPC.openExternalUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('openWindow passes payload to ipc.openWindow', () => {
    const bridge = createElectronBridge();
    const payload = { type: 'settings' } as never;
    bridge.window.openWindow(payload);
    expect(mockIPC.openWindow).toHaveBeenCalledWith(payload);
  });

  it('closeWindow delegates to ipc.closeWindow', () => {
    const bridge = createElectronBridge();
    bridge.window.closeWindow();
    expect(mockIPC.closeWindow).toHaveBeenCalledOnce();
  });

  it('getWindowContext passes type to ipc.getWindowContext', () => {
    const bridge = createElectronBridge();
    bridge.window.getWindowContext('main');
    expect(mockIPC.getWindowContext).toHaveBeenCalledWith('main');
  });

  it('onWindowContext passes callback to ipc.onWindowContext', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onWindowContext(cb);
    expect(mockIPC.onWindowContext).toHaveBeenCalledWith(cb);
  });

  it('onOpenSettings passes callback to ipc.onOpenSettings', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onOpenSettings(cb);
    expect(mockIPC.onOpenSettings).toHaveBeenCalledWith(cb);
  });

  it('onOpenAside passes callback to ipc.onOpenAside', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onOpenAside(cb);
    expect(mockIPC.onOpenAside).toHaveBeenCalledWith(cb);
  });

  it('onContextMenuCommand passes callback to ipc.onContextMenuCommand', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onContextMenuCommand(cb);
    expect(mockIPC.onContextMenuCommand).toHaveBeenCalledWith(cb);
  });

  it('onReaderContextMenuCommand passes callback to ipc.onReaderContextMenuCommand', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onReaderContextMenuCommand(cb);
    expect(mockIPC.onReaderContextMenuCommand).toHaveBeenCalledWith(cb);
  });

  it('onOpenWordDbEditor passes callback to ipc.onOpenWordDbEditor', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onOpenWordDbEditor(cb);
    expect(mockIPC.onOpenWordDbEditor).toHaveBeenCalledWith(cb);
  });

  it('onOpenLevelStudy passes callback to ipc.onOpenLevelStudy', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onOpenLevelStudy(cb);
    expect(mockIPC.onOpenLevelStudy).toHaveBeenCalledWith(cb);
  });

  it('onOpenPrompt passes callback to ipc.onOpenPrompt', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onOpenPrompt(cb);
    expect(mockIPC.onOpenPrompt).toHaveBeenCalledWith(cb);
  });

  it('onAuthDeepLink passes callback to ipc.onAuthDeepLink', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onAuthDeepLink(cb);
    expect(mockIPC.onAuthDeepLink).toHaveBeenCalledWith(cb);
  });

  it('onLookupDeepLink passes callback to ipc.onLookupDeepLink', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.window.onLookupDeepLink(cb);
    expect(mockIPC.onLookupDeepLink).toHaveBeenCalledWith(cb);
  });

  it('promptOutput passes text to ipc.promptOutput', () => {
    const bridge = createElectronBridge();
    bridge.window.promptOutput('some output');
    expect(mockIPC.promptOutput).toHaveBeenCalledWith('some output');
  });
});

describe('serverBridge', () => {
  it('isLoaded delegates to ipc.isLoaded', () => {
    const bridge = createElectronBridge();
    bridge.server.isLoaded();
    expect(mockIPC.isLoaded).toHaveBeenCalledOnce();
  });

  it('isSuccess delegates to ipc.isSuccess', () => {
    const bridge = createElectronBridge();
    bridge.server.isSuccess();
    expect(mockIPC.isSuccess).toHaveBeenCalledOnce();
  });

  it('onServerLoad passes callback to ipc.onServerLoad', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.server.onServerLoad(cb);
    expect(mockIPC.onServerLoad).toHaveBeenCalledWith(cb);
  });

  it('onServerStatusUpdate passes callback to ipc.onServerStatusUpdate', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.server.onServerStatusUpdate(cb);
    expect(mockIPC.onServerStatusUpdate).toHaveBeenCalledWith(cb);
  });

  it('onServerCriticalError passes callback to ipc.onServerCriticalError', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.server.onServerCriticalError(cb);
    expect(mockIPC.onServerCriticalError).toHaveBeenCalledWith(cb);
  });

  it('onAnkiConnectionError passes callback to ipc.onAnkiConnectionError', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.server.onAnkiConnectionError(cb);
    expect(mockIPC.onAnkiConnectionError).toHaveBeenCalledWith(cb);
  });

  it('onOcrStatusUpdate passes callback to ipc.onOcrStatusUpdate', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.server.onOcrStatusUpdate(cb);
    expect(mockIPC.onOcrStatusUpdate).toHaveBeenCalledWith(cb);
  });

  it('restartApp delegates to ipc.restartApp', () => {
    const bridge = createElectronBridge();
    bridge.server.restartApp();
    expect(mockIPC.restartApp).toHaveBeenCalledOnce();
  });

  it('forceRestartApp delegates to ipc.forceRestartApp', () => {
    const bridge = createElectronBridge();
    bridge.server.forceRestartApp();
    expect(mockIPC.forceRestartApp).toHaveBeenCalledOnce();
  });

  it('restartBackend delegates to ipc.restartBackend', () => {
    const bridge = createElectronBridge();
    bridge.server.restartBackend();
    expect(mockIPC.restartBackend).toHaveBeenCalledOnce();
  });

  it('getVersion delegates to ipc.getVersion', () => {
    const bridge = createElectronBridge();
    bridge.server.getVersion();
    expect(mockIPC.getVersion).toHaveBeenCalledOnce();
  });

  it('onVersionReceive passes callback to ipc.onVersionReceive', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.server.onVersionReceive(cb);
    expect(mockIPC.onVersionReceive).toHaveBeenCalledWith(cb);
  });
});

describe('installerBridge', () => {
  it('startInstall passes options to ipc.startInstall', () => {
    const bridge = createElectronBridge();
    const opts = { pythonPath: '/usr/bin/python3' } as never;
    bridge.installer.startInstall(opts);
    expect(mockIPC.startInstall).toHaveBeenCalledWith(opts);
  });

  it('requestInstallerState delegates to ipc.requestInstallerState', () => {
    const bridge = createElectronBridge();
    bridge.installer.requestInstallerState();
    expect(mockIPC.requestInstallerState).toHaveBeenCalledOnce();
  });

  it('onPythonSuccess passes callback to ipc.onPythonSuccess', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.installer.onPythonSuccess(cb);
    expect(mockIPC.onPythonSuccess).toHaveBeenCalledWith(cb);
  });

  it('onInstallStarted passes callback to ipc.onInstallStarted', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.installer.onInstallStarted(cb);
    expect(mockIPC.onInstallStarted).toHaveBeenCalledWith(cb);
  });

  it('onInstallerAwaitingChoice passes callback to ipc.onInstallerAwaitingChoice', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.installer.onInstallerAwaitingChoice(cb);
    expect(mockIPC.onInstallerAwaitingChoice).toHaveBeenCalledWith(cb);
  });

  it('onInstallerNetworkError passes callback to ipc.onInstallerNetworkError', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.installer.onInstallerNetworkError(cb);
    expect(mockIPC.onInstallerNetworkError).toHaveBeenCalledWith(cb);
  });

  it('onInstallerState passes callback to ipc.onInstallerState', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.installer.onInstallerState(cb);
    expect(mockIPC.onInstallerState).toHaveBeenCalledWith(cb);
  });

  it('onPipProgress passes callback to ipc.onPipProgress', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.installer.onPipProgress(cb);
    expect(mockIPC.onPipProgress).toHaveBeenCalledWith(cb);
  });
});

describe('llmBridge', () => {
  it('llmStream passes messages and tools to ipc.llmStream', () => {
    const bridge = createElectronBridge();
    const msgs = [{ role: 'user' as const, content: 'hello' }];
    const tools = [] as never[];
    bridge.llm.llmStream(msgs, tools);
    expect(mockIPC.llmStream).toHaveBeenCalledWith(msgs, tools, undefined, undefined);
  });

  it('llmStreamAbort delegates to ipc.llmStreamAbort', () => {
    const bridge = createElectronBridge();
    bridge.llm.llmStreamAbort();
    expect(mockIPC.llmStreamAbort).toHaveBeenCalledOnce();
  });

  it('onLLMStreamChunk passes callback to ipc.onLLMStreamChunk', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.llm.onLLMStreamChunk(cb);
    expect(mockIPC.onLLMStreamChunk).toHaveBeenCalledWith(cb);
  });

  it('llmCheckModel passes modelFile to ipc.llmCheckModel', () => {
    const bridge = createElectronBridge();
    bridge.llm.llmCheckModel('model.gguf');
    expect(mockIPC.llmCheckModel).toHaveBeenCalledWith('model.gguf');
  });

  it('llmDownloadModel passes url and file to ipc.llmDownloadModel', () => {
    const bridge = createElectronBridge();
    bridge.llm.llmDownloadModel('https://example.com/model.gguf', 'model.gguf');
    expect(mockIPC.llmDownloadModel).toHaveBeenCalledWith('https://example.com/model.gguf', 'model.gguf');
  });

  it('onLLMDownloadProgress passes callback to ipc.onLLMDownloadProgress', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.llm.onLLMDownloadProgress(cb);
    expect(mockIPC.onLLMDownloadProgress).toHaveBeenCalledWith(cb);
  });

  it('onLLMModelStatus passes callback to ipc.onLLMModelStatus', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.llm.onLLMModelStatus(cb);
    expect(mockIPC.onLLMModelStatus).toHaveBeenCalledWith(cb);
  });

  it('llmUnloadModel delegates to ipc.llmUnloadModel', () => {
    const bridge = createElectronBridge();
    bridge.llm.llmUnloadModel();
    expect(mockIPC.llmUnloadModel).toHaveBeenCalledOnce();
  });

  it('ollamaChat passes messages and tools to ipc.ollamaChat', () => {
    const bridge = createElectronBridge();
    bridge.llm.ollamaChat([{ role: 'user', content: 'hi' }], []);
    expect(mockIPC.ollamaChat).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }], []);
  });

  it('ollamaChatStream passes messages and tools to ipc.ollamaChatStream', () => {
    const bridge = createElectronBridge();
    bridge.llm.ollamaChatStream([{ role: 'user', content: 'hi' }]);
    expect(mockIPC.ollamaChatStream).toHaveBeenCalledWith([{ role: 'user', content: 'hi' }], undefined);
  });

  it('ollamaChatStreamAbort delegates to ipc.ollamaChatStreamAbort', () => {
    const bridge = createElectronBridge();
    bridge.llm.ollamaChatStreamAbort();
    expect(mockIPC.ollamaChatStreamAbort).toHaveBeenCalledOnce();
  });

  it('onOllamaChatStream passes callback to ipc.onOllamaChatStream', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.llm.onOllamaChatStream(cb);
    expect(mockIPC.onOllamaChatStream).toHaveBeenCalledWith(cb);
  });

  it('ollamaListModels delegates to ipc.ollamaListModels', () => {
    const bridge = createElectronBridge();
    bridge.llm.ollamaListModels();
    expect(mockIPC.ollamaListModels).toHaveBeenCalledOnce();
  });

  it('ollamaCheck delegates to ipc.ollamaCheck', () => {
    const bridge = createElectronBridge();
    bridge.llm.ollamaCheck();
    expect(mockIPC.ollamaCheck).toHaveBeenCalledOnce();
  });

  it('ollamaPullModel passes modelName to ipc.ollamaPullModel', () => {
    const bridge = createElectronBridge();
    bridge.llm.ollamaPullModel('qwen3:4b');
    expect(mockIPC.ollamaPullModel).toHaveBeenCalledWith('qwen3:4b');
  });

  it('onOllamaPullModelProgress passes callback to ipc.onOllamaPullModelProgress', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.llm.onOllamaPullModelProgress(cb);
    expect(mockIPC.onOllamaPullModelProgress).toHaveBeenCalledWith(cb);
  });
});

describe('speechBridge', () => {
  it('sttStart passes language to ipc.sttStart', () => {
    const bridge = createElectronBridge();
    bridge.speech.sttStart('en');
    expect(mockIPC.sttStart).toHaveBeenCalledWith('en');
  });

  it('sttStop delegates to ipc.sttStop', () => {
    const bridge = createElectronBridge();
    bridge.speech.sttStop();
    expect(mockIPC.sttStop).toHaveBeenCalledOnce();
  });

  it('onSttResult passes callback to ipc.onSttResult', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.speech.onSttResult(cb);
    expect(mockIPC.onSttResult).toHaveBeenCalledWith(cb);
  });

  it('ttsSpeak passes text and language to ipc.ttsSpeak', () => {
    const bridge = createElectronBridge();
    bridge.speech.ttsSpeak('hello', 'en');
    expect(mockIPC.ttsSpeak).toHaveBeenCalledWith('hello', 'en');
  });

  it('ttsStop delegates to ipc.ttsStop', () => {
    const bridge = createElectronBridge();
    bridge.speech.ttsStop();
    expect(mockIPC.ttsStop).toHaveBeenCalledOnce();
  });

  it('onTtsStatus passes callback to ipc.onTtsStatus', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.speech.onTtsStatus(cb);
    expect(mockIPC.onTtsStatus).toHaveBeenCalledWith(cb);
  });
});

describe('voiceBridge', () => {
  it('voiceCheckModels passes language to ipc.voiceCheckModels', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceCheckModels('ja');
    expect(mockIPC.voiceCheckModels).toHaveBeenCalledWith('ja');
  });

  it('voiceDownloadModels passes language to ipc.voiceDownloadModels', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceDownloadModels('ja');
    expect(mockIPC.voiceDownloadModels).toHaveBeenCalledWith('ja');
  });

  it('onVoiceModelProgress passes callback to ipc.onVoiceModelProgress', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceModelProgress(cb);
    expect(mockIPC.onVoiceModelProgress).toHaveBeenCalledWith(cb);
  });

  it('voiceStartSession passes language, mode, threshold, and provider to ipc.voiceStartSession', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceStartSession('en', 'vad', 0.5, 'qwen3');
    expect(mockIPC.voiceStartSession).toHaveBeenCalledWith('en', 'vad', 0.5, 'qwen3');
  });

  it('voiceStopSession delegates to ipc.voiceStopSession', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceStopSession();
    expect(mockIPC.voiceStopSession).toHaveBeenCalledOnce();
  });

  it('voiceSendAudioChunk passes samples to ipc.voiceSendAudioChunk', () => {
    const bridge = createElectronBridge();
    const samples = new Float32Array([0.1, 0.2]);
    bridge.voice.voiceSendAudioChunk(samples);
    expect(mockIPC.voiceSendAudioChunk).toHaveBeenCalledWith(samples);
  });

  it('voiceFlush delegates to ipc.voiceFlush', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceFlush();
    expect(mockIPC.voiceFlush).toHaveBeenCalledOnce();
  });

  it('voiceUpdateSilenceThreshold passes threshold to ipc.voiceUpdateSilenceThreshold', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceUpdateSilenceThreshold(0.3);
    expect(mockIPC.voiceUpdateSilenceThreshold).toHaveBeenCalledWith(0.3);
  });

  it('onVoiceSttResult passes callback to ipc.onVoiceSttResult', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceSttResult(cb);
    expect(mockIPC.onVoiceSttResult).toHaveBeenCalledWith(cb);
  });

  it('onVoiceVadEvent passes callback to ipc.onVoiceVadEvent', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceVadEvent(cb);
    expect(mockIPC.onVoiceVadEvent).toHaveBeenCalledWith(cb);
  });

  it('voiceTtsGenerate passes all args to ipc.voiceTtsGenerate', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceTtsGenerate('hello', 'en', 1.0, 'sample-id', 'kokoro', 'cloud-token');
    expect(mockIPC.voiceTtsGenerate).toHaveBeenCalledWith('hello', 'en', 1.0, 'sample-id', 'kokoro', 'cloud-token');
  });

  it('voiceTtsStop delegates to ipc.voiceTtsStop', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceTtsStop();
    expect(mockIPC.voiceTtsStop).toHaveBeenCalledOnce();
  });

  it('onVoiceTtsAudio passes callback to ipc.onVoiceTtsAudio', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceTtsAudio(cb);
    expect(mockIPC.onVoiceTtsAudio).toHaveBeenCalledWith(cb);
  });

  it('onVoiceTtsStatus passes callback to ipc.onVoiceTtsStatus', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceTtsStatus(cb);
    expect(mockIPC.onVoiceTtsStatus).toHaveBeenCalledWith(cb);
  });

  it('onVoiceSessionReady passes callback to ipc.onVoiceSessionReady', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceSessionReady(cb);
    expect(mockIPC.onVoiceSessionReady).toHaveBeenCalledWith(cb);
  });

  it('onVoiceSessionStatus passes callback to ipc.onVoiceSessionStatus', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceSessionStatus(cb);
    expect(mockIPC.onVoiceSessionStatus).toHaveBeenCalledWith(cb);
  });

  it('onVoiceSessionError passes callback to ipc.onVoiceSessionError', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.voice.onVoiceSessionError(cb);
    expect(mockIPC.onVoiceSessionError).toHaveBeenCalledWith(cb);
  });

  it('voiceSampleList delegates to ipc.voiceSampleList', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceSampleList();
    expect(mockIPC.voiceSampleList).toHaveBeenCalledOnce();
  });

  it('voiceSampleUpload passes path and name to ipc.voiceSampleUpload', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceSampleUpload('/path/to/sample.wav', 'My Voice');
    expect(mockIPC.voiceSampleUpload).toHaveBeenCalledWith('/path/to/sample.wav', 'My Voice');
  });

  it('voiceSampleDelete passes id to ipc.voiceSampleDelete', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceSampleDelete('sample-id');
    expect(mockIPC.voiceSampleDelete).toHaveBeenCalledWith('sample-id');
  });

  it('voiceSampleRename passes id and name to ipc.voiceSampleRename', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceSampleRename('sample-id', 'New Name');
    expect(mockIPC.voiceSampleRename).toHaveBeenCalledWith('sample-id', 'New Name');
  });

  it('voiceSampleTranscribe passes id and language to ipc.voiceSampleTranscribe', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceSampleTranscribe('sample-id', 'fa');
    expect(mockIPC.voiceSampleTranscribe).toHaveBeenCalledWith('sample-id', 'fa');
  });

  it('voiceSampleGetPath passes id to ipc.voiceSampleGetPath', () => {
    const bridge = createElectronBridge();
    bridge.voice.voiceSampleGetPath('sample-id');
    expect(mockIPC.voiceSampleGetPath).toHaveBeenCalledWith('sample-id');
  });
});

describe('mediaStatsBridge', () => {
  it('saveMediaStats passes hash and stats to ipc.saveMediaStats', () => {
    const bridge = createElectronBridge();
    const stats = { totalTimeSpent: 120 } as never;
    bridge.mediaStats.saveMediaStats('hash-abc', stats);
    expect(mockIPC.saveMediaStats).toHaveBeenCalledWith('hash-abc', stats);
  });

  it('getMediaStats passes hash to ipc.getMediaStats', () => {
    const bridge = createElectronBridge();
    bridge.mediaStats.getMediaStats('hash-abc');
    expect(mockIPC.getMediaStats).toHaveBeenCalledWith('hash-abc');
  });

  it('onMediaStats passes callback to ipc.onMediaStats', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.mediaStats.onMediaStats(cb);
    expect(mockIPC.onMediaStats).toHaveBeenCalledWith(cb);
  });

  it('listMediaStats delegates to ipc.listMediaStats', () => {
    const bridge = createElectronBridge();
    bridge.mediaStats.listMediaStats();
    expect(mockIPC.listMediaStats).toHaveBeenCalledOnce();
  });

  it('onMediaStatsList passes callback to ipc.onMediaStatsList', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.mediaStats.onMediaStatsList(cb);
    expect(mockIPC.onMediaStatsList).toHaveBeenCalledWith(cb);
  });
});

describe('watchTogetherBridge', () => {
  it('isWatchingTogether delegates to ipc.isWatchingTogether', () => {
    const bridge = createElectronBridge();
    bridge.watchTogether.isWatchingTogether();
    expect(mockIPC.isWatchingTogether).toHaveBeenCalledOnce();
  });

  it('watchTogetherSend passes message to ipc.watchTogetherSend', () => {
    const bridge = createElectronBridge();
    bridge.watchTogether.watchTogetherSend({ type: 'play', time: 42 });
    expect(mockIPC.watchTogetherSend).toHaveBeenCalledWith({ type: 'play', time: 42 });
  });

  it('onWatchTogetherLaunch passes callback to ipc.onWatchTogetherLaunch', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.watchTogether.onWatchTogetherLaunch(cb);
    expect(mockIPC.onWatchTogetherLaunch).toHaveBeenCalledWith(cb);
  });

  it('onWatchTogetherRequest passes callback to ipc.onWatchTogetherRequest', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.watchTogether.onWatchTogetherRequest(cb);
    expect(mockIPC.onWatchTogetherRequest).toHaveBeenCalledWith(cb);
  });
});

describe('crossWindowBridge', () => {
  it('onUpdatePills passes callback to ipc.onUpdatePills', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.crossWindow.onUpdatePills(cb);
    expect(mockIPC.onUpdatePills).toHaveBeenCalledWith(cb);
  });

  it('onUpdateWordAppearance passes callback to ipc.onUpdateWordAppearance', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.crossWindow.onUpdateWordAppearance(cb);
    expect(mockIPC.onUpdateWordAppearance).toHaveBeenCalledWith(cb);
  });

  it('onUpdateAttemptFlashcardCreation passes callback to ipc.onUpdateAttemptFlashcardCreation', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.crossWindow.onUpdateAttemptFlashcardCreation(cb);
    expect(mockIPC.onUpdateAttemptFlashcardCreation).toHaveBeenCalledWith(cb);
  });

  it('onUpdateCreateFlashcard passes callback to ipc.onUpdateCreateFlashcard', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.crossWindow.onUpdateCreateFlashcard(cb);
    expect(mockIPC.onUpdateCreateFlashcard).toHaveBeenCalledWith(cb);
  });

  it('onUpdateLastWatched passes callback to ipc.onUpdateLastWatched', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.crossWindow.onUpdateLastWatched(cb);
    expect(mockIPC.onUpdateLastWatched).toHaveBeenCalledWith(cb);
  });
});

describe('licenseBridge', () => {
  it('getLicenseType delegates to ipc.getLicenseType', () => {
    const bridge = createElectronBridge();
    bridge.license.getLicenseType();
    expect(mockIPC.getLicenseType).toHaveBeenCalledOnce();
  });

  it('activateLicense passes key to ipc.activateLicense', () => {
    const bridge = createElectronBridge();
    bridge.license.activateLicense('LICENSE-KEY-123');
    expect(mockIPC.activateLicense).toHaveBeenCalledWith('LICENSE-KEY-123');
  });

  it('removeLicense delegates to ipc.removeLicense', () => {
    const bridge = createElectronBridge();
    bridge.license.removeLicense();
    expect(mockIPC.removeLicense).toHaveBeenCalledOnce();
  });

  it('onLicenseGet passes callback to ipc.onLicenseGet', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.license.onLicenseGet(cb);
    expect(mockIPC.onLicenseGet).toHaveBeenCalledWith(cb);
  });

  it('onLicenseActivated passes callback to ipc.onLicenseActivated', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.license.onLicenseActivated(cb);
    expect(mockIPC.onLicenseActivated).toHaveBeenCalledWith(cb);
  });
});

describe('migrationBridge', () => {
  it('getMigratedLocalStorage delegates to ipc.getMigratedLocalStorage', () => {
    const bridge = createElectronBridge();
    bridge.migration.getMigratedLocalStorage();
    expect(mockIPC.getMigratedLocalStorage).toHaveBeenCalledOnce();
  });

  it('getMigratedItem passes key to ipc.getMigratedItem', () => {
    const bridge = createElectronBridge();
    bridge.migration.getMigratedItem('some-key');
    expect(mockIPC.getMigratedItem).toHaveBeenCalledWith('some-key');
  });

  it('hasMigrationOccurred delegates to ipc.hasMigrationOccurred', () => {
    const bridge = createElectronBridge();
    bridge.migration.hasMigrationOccurred();
    expect(mockIPC.hasMigrationOccurred).toHaveBeenCalledOnce();
  });

  it('triggerMigration delegates to ipc.triggerMigration', () => {
    const bridge = createElectronBridge();
    bridge.migration.triggerMigration();
    expect(mockIPC.triggerMigration).toHaveBeenCalledOnce();
  });

  it('onLocalStorageMigrationComplete passes callback to ipc.onLocalStorageMigrationComplete', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.migration.onLocalStorageMigrationComplete(cb);
    expect(mockIPC.onLocalStorageMigrationComplete).toHaveBeenCalledWith(cb);
  });

  it('onFlashcardMigrationComplete passes callback to ipc.onFlashcardMigrationComplete', () => {
    const cb = vi.fn();
    const bridge = createElectronBridge();
    bridge.migration.onFlashcardMigrationComplete(cb);
    expect(mockIPC.onFlashcardMigrationComplete).toHaveBeenCalledWith(cb);
  });

  it('getFlashcardMigrationInfo delegates to ipc.getFlashcardMigrationInfo', () => {
    const bridge = createElectronBridge();
    bridge.migration.getFlashcardMigrationInfo();
    expect(mockIPC.getFlashcardMigrationInfo).toHaveBeenCalledOnce();
  });
});

describe('genericBridge', () => {
  it('sendLS passes data to ipc.sendLS', () => {
    const bridge = createElectronBridge();
    bridge.generic.sendLS({ key: 'value' });
    expect(mockIPC.sendLS).toHaveBeenCalledWith({ key: 'value' });
  });

  it('fetchUrl passes url to ipc.fetchUrl and returns result', () => {
    mockIPC.fetchUrl.mockResolvedValue({ content: '<html/>' });
    const bridge = createElectronBridge();
    const result = bridge.generic.fetchUrl('https://example.com');
    expect(mockIPC.fetchUrl).toHaveBeenCalledWith('https://example.com');
    expect(result).toEqual(mockIPC.fetchUrl.mock.results[0].value);
  });
});

describe('dataBridge', () => {
  it('dataExport delegates to ipc.dataExport and returns result', () => {
    mockIPC.dataExport.mockResolvedValue({ success: true, filePath: '/export.zip' });
    const bridge = createElectronBridge();
    bridge.data.dataExport();
    expect(mockIPC.dataExport).toHaveBeenCalledOnce();
  });

  it('dataImport delegates to ipc.dataImport and returns result', () => {
    mockIPC.dataImport.mockResolvedValue({ success: true });
    const bridge = createElectronBridge();
    bridge.data.dataImport();
    expect(mockIPC.dataImport).toHaveBeenCalledOnce();
  });
});

describe('kvStoreBridge', () => {
  it('kvGet passes key to ipc.kvGet and returns result', () => {
    mockIPC.kvGet.mockResolvedValue('stored-value');
    const bridge = createElectronBridge();
    const result = bridge.kvStore.kvGet('my-key');
    expect(mockIPC.kvGet).toHaveBeenCalledWith('my-key');
    expect(result).toEqual(mockIPC.kvGet.mock.results[0].value);
  });

  it('kvSet passes key and value to ipc.kvSet', () => {
    const bridge = createElectronBridge();
    bridge.kvStore.kvSet('my-key', 'my-value');
    expect(mockIPC.kvSet).toHaveBeenCalledWith('my-key', 'my-value');
  });

  it('kvRemove passes key to ipc.kvRemove', () => {
    const bridge = createElectronBridge();
    bridge.kvStore.kvRemove('my-key');
    expect(mockIPC.kvRemove).toHaveBeenCalledWith('my-key');
  });

  it('kvGetAll delegates to ipc.kvGetAll and returns result', () => {
    mockIPC.kvGetAll.mockResolvedValue({ a: '1', b: '2' });
    const bridge = createElectronBridge();
    const result = bridge.kvStore.kvGetAll();
    expect(mockIPC.kvGetAll).toHaveBeenCalledOnce();
    expect(result).toEqual(mockIPC.kvGetAll.mock.results[0].value);
  });

  it('kvSetBatch passes entries to ipc.kvSetBatch', () => {
    const bridge = createElectronBridge();
    bridge.kvStore.kvSetBatch({ a: '1', b: '2' });
    expect(mockIPC.kvSetBatch).toHaveBeenCalledWith({ a: '1', b: '2' });
  });
});

describe('browserBridge', () => {
  it('detectBrowsers passes customPaths to ipc.detectBrowsers and returns result', () => {
    mockIPC.detectBrowsers.mockResolvedValue([{ name: 'Chrome', type: 'chrome', path: '/usr/bin/chrome', isInstalled: true }]);
    const bridge = createElectronBridge();
    const customPaths = [{ path: '/custom/chrome', type: 'chrome' as const }];
    const result = bridge.browser.detectBrowsers(customPaths);
    expect(mockIPC.detectBrowsers).toHaveBeenCalledWith(customPaths);
    expect(result).toEqual(mockIPC.detectBrowsers.mock.results[0].value);
  });

  it('installExtension passes browser to ipc.installExtension and returns result', () => {
    mockIPC.installExtension.mockResolvedValue({ success: true, path: '/ext/path' });
    const bridge = createElectronBridge();
    const browser = { name: 'Chrome', type: 'chrome' as const, path: '/usr/bin/chrome', isInstalled: true };
    const result = bridge.browser.installExtension(browser);
    expect(mockIPC.installExtension).toHaveBeenCalledWith(browser);
    expect(result).toEqual(mockIPC.installExtension.mock.results[0].value);
  });

  it('uninstallExtension passes browser to ipc.uninstallExtension and returns result', () => {
    mockIPC.uninstallExtension.mockResolvedValue({ success: true });
    const bridge = createElectronBridge();
    const browser = { name: 'Chrome', type: 'chrome' as const, path: '/usr/bin/chrome', isInstalled: true };
    const result = bridge.browser.uninstallExtension(browser);
    expect(mockIPC.uninstallExtension).toHaveBeenCalledWith(browser);
    expect(result).toEqual(mockIPC.uninstallExtension.mock.results[0].value);
  });

  it('isExtensionInstalled passes browser to ipc.isExtensionInstalled and returns result', () => {
    mockIPC.isExtensionInstalled.mockResolvedValue({ installed: true });
    const bridge = createElectronBridge();
    const browser = { name: 'Chrome', type: 'chrome' as const, path: '/usr/bin/chrome', isInstalled: true };
    const result = bridge.browser.isExtensionInstalled(browser);
    expect(mockIPC.isExtensionInstalled).toHaveBeenCalledWith(browser);
    expect(result).toEqual(mockIPC.isExtensionInstalled.mock.results[0].value);
  });

  it('openExtensionFolder delegates to ipc.openExtensionFolder and returns result', () => {
    mockIPC.openExtensionFolder.mockResolvedValue(true);
    const bridge = createElectronBridge();
    const result = bridge.browser.openExtensionFolder();
    expect(mockIPC.openExtensionFolder).toHaveBeenCalledOnce();
    expect(result).toEqual(mockIPC.openExtensionFolder.mock.results[0].value);
  });
});
