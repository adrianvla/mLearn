/**
 * Electron Bridge Implementation
 *
 * Pass-through wrapper around `window.mLearnIPC` that implements the
 * PlatformBridge interface. Every method delegates directly to the
 * preload-exposed IPC API.
 */

import type { MLearnIPC } from '../global.d';
import type {
  PlatformBridge,
  SettingsBridge,
  FlashcardBridge,
  PluginBridge,
  LocalizationBridge,
  FileBridge,
  WindowBridge,
  ServerBridge,
  InstallerBridge,
  LLMBridge,
  SpeechBridge,
  VoiceBridge,
  MediaStatsBridge,
  WatchTogetherBridge,
  OverlayBridge,
  CrossWindowBridge,
  LicenseBridge,
  MigrationBridge,
  GenericIPCBridge,
  DataBridge,
  KVStoreBridge,
  BrowserBridge,
} from './types';

function getIPC(): MLearnIPC {
  const ipc = window.mLearnIPC;
  if (!ipc) throw new Error('ElectronBridge: window.mLearnIPC is not available');
  return ipc;
}

const settingsBridge: SettingsBridge = {
  getSettings: () => getIPC().getSettings(),
  saveSettings: (s) => getIPC().saveSettings(s),
  onSettings: (cb) => getIPC().onSettings(cb),
  onSettingsSaved: (cb) => getIPC().onSettingsSaved(cb),
};

const flashcardBridge: FlashcardBridge = {
  getFlashcards: () => getIPC().getFlashcards(),
  saveFlashcards: (fc) => getIPC().saveFlashcards(fc),
  onFlashcards: (cb) => getIPC().onFlashcards(cb),
  onNewDayFlashcards: (cb) => getIPC().onNewDayFlashcards(cb),
  onFlashcardConnectOpen: (cb) => getIPC().onFlashcardConnectOpen(cb),
  onReviewFlashcardRequest: (cb) => getIPC().onReviewFlashcardRequest(cb),
  saveFlashcardImage: (cardId, dataUrl) => getIPC().saveFlashcardImage(cardId, dataUrl),
  resolveFlashcardImage: (imageUrl) => getIPC().resolveFlashcardImage(imageUrl),
  deleteFlashcardImage: (cardId) => getIPC().deleteFlashcardImage(cardId),
  saveFlashcardVideo: (cardId, data) => getIPC().saveFlashcardVideo(cardId, data),
  deleteFlashcardVideo: (cardId) => getIPC().deleteFlashcardVideo(cardId),
  getFlashcardTts: (cardId, field) => getIPC().getFlashcardTts(cardId, field),
  generateFlashcardTts: (cardId, text, language, field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl) => getIPC().generateFlashcardTts(cardId, text, language, field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl),
  batchGenerateFlashcardTts: (items, language, provider, voiceSampleId, cloudAuthToken, cloudApiUrl) => getIPC().batchGenerateFlashcardTts(items, language, provider, voiceSampleId, cloudAuthToken, cloudApiUrl),
  getFlashcardTtsMeta: (cardId, field) => getIPC().getFlashcardTtsMeta(cardId, field),
  deleteFlashcardTts: (cardId) => getIPC().deleteFlashcardTts(cardId),
};

const pluginBridge: PluginBridge = {
  getPluginValue: (channel) => getIPC().getPluginValue(channel),
  setPluginValue: (channel, value) => getIPC().setPluginValue(channel, value),
  emitPluginEvent: (channel, payload) => getIPC().emitPluginEvent(channel, payload),
  onPluginValue: (channel, cb) => getIPC().onPluginValue(channel, cb),
  onPluginEvent: (channel, cb) => getIPC().onPluginEvent(channel, cb),
  pluginGetList: () => getIPC().pluginGetList(),
  pluginEnable: (pluginId) => getIPC().pluginEnable(pluginId),
  pluginDisable: (pluginId) => getIPC().pluginDisable(pluginId),
  pluginGrantPermissions: (pluginId) => getIPC().pluginGrantPermissions(pluginId),
  pluginInstallFromPath: (sourcePath) => getIPC().pluginInstallFromPath(sourcePath),
  pluginSelectAndInstall: () => getIPC().pluginSelectAndInstall(),
  pluginUninstall: (pluginId) => getIPC().pluginUninstall(pluginId),
  pluginKVGet: (pluginId, key) => getIPC().pluginKVGet(pluginId, key),
  pluginKVSet: (pluginId, key, value) => getIPC().pluginKVSet(pluginId, key, value),
  pluginKVRemove: (pluginId, key) => getIPC().pluginKVRemove(pluginId, key),
  pluginOpenWindow: (payload) => getIPC().pluginOpenWindow(payload),
  onPluginList: (cb) => getIPC().onPluginList(cb),
  onPluginStatusUpdate: (cb) => getIPC().onPluginStatusUpdate(cb),
  onPluginInstallResult: (cb) => getIPC().onPluginInstallResult(cb),
};

const localizationBridge: LocalizationBridge = {
  getLocalization: () => getIPC().getLocalization(),
  onLocalization: (cb) => getIPC().onLocalization(cb),
  changeUILanguage: (code) => getIPC().changeUILanguage(code),
  getLangData: () => getIPC().getLangData(),
  onLangData: (cb) => getIPC().onLangData(cb),
  installLanguage: (url) => getIPC().installLanguage(url),
  onLanguageInstalled: (cb) => getIPC().onLanguageInstalled(cb),
  onLanguageInstallError: (cb) => getIPC().onLanguageInstallError(cb),
};

const fileBridge: FileBridge = {
  readDirectoryImages: (dir) => getIPC().readDirectoryImages(dir),
  readPdfFile: (path) => getIPC().readPdfFile(path),
  readMediaFile: (path) => getIPC().readMediaFile(path),
  selectVideoFile: () => getIPC().selectVideoFile(),
  selectSubtitleFile: () => getIPC().selectSubtitleFile(),
  selectBookFolder: () => getIPC().selectBookFolder(),
  selectPdfFile: () => getIPC().selectPdfFile(),
  selectBrowserFile: () => getIPC().selectBrowserFile(),
  getLocalMediaUrl: (path) => getIPC().getLocalMediaUrl(path),
  getPathForFile: (file) => getIPC().getPathForFile(file),
  writeToClipboard: (text) => getIPC().writeToClipboard(text),
};

const windowBridge: WindowBridge = {
  changeTrafficLights: (v) => getIPC().changeTrafficLights(v),
  resizeWindow: (s) => getIPC().resizeWindow(s),
  makePiP: (s) => getIPC().makePiP(s),
  unPiP: () => getIPC().unPiP(),
  showCtxMenu: (opts) => getIPC().showCtxMenu(opts),
  showReaderCtxMenu: (opts) => getIPC().showReaderCtxMenu(opts),
  showContact: () => getIPC().showContact(),
  openExternalUrl: (url) => getIPC().openExternalUrl(url),
  openWindow: (payload) => getIPC().openWindow(payload),
  closeWindow: () => getIPC().closeWindow(),
  getWindowContext: (type) => getIPC().getWindowContext(type),
  onWindowContext: (cb) => getIPC().onWindowContext(cb),
  onOpenSettings: (cb) => getIPC().onOpenSettings(cb),
  onOpenAside: (cb) => getIPC().onOpenAside(cb),
  onContextMenuCommand: (cb) => getIPC().onContextMenuCommand(cb),
  onReaderContextMenuCommand: (cb) => getIPC().onReaderContextMenuCommand(cb),
  onOpenWordDbEditor: (cb) => getIPC().onOpenWordDbEditor(cb),
  onOpenKanjiGrid: (cb) => getIPC().onOpenKanjiGrid(cb),
  onOpenPrompt: (cb) => getIPC().onOpenPrompt(cb),
  onAuthDeepLink: (cb) => getIPC().onAuthDeepLink(cb),
  onLookupDeepLink: (cb) => getIPC().onLookupDeepLink(cb),
  promptOutput: (text) => getIPC().promptOutput(text),
};

const serverBridge: ServerBridge = {
  isLoaded: () => getIPC().isLoaded(),
  isSuccess: () => getIPC().isSuccess(),
  onServerLoad: (cb) => getIPC().onServerLoad(cb),
  onServerStatusUpdate: (cb) => getIPC().onServerStatusUpdate(cb),
  onServerCriticalError: (cb) => getIPC().onServerCriticalError(cb),
  onAnkiConnectionError: (cb) => getIPC().onAnkiConnectionError(cb),
  restartBackendAnkiOverride: (disableAnki) => getIPC().restartBackendAnkiOverride(disableAnki),
  onOcrStatusUpdate: (cb) => getIPC().onOcrStatusUpdate(cb),
  sendLogRecord: (record) => getIPC().sendLogRecord(record),
  restartApp: () => getIPC().restartApp(),
  forceRestartApp: () => getIPC().forceRestartApp(),
  restartBackend: () => getIPC().restartBackend(),
  getVersion: () => getIPC().getVersion(),
  onVersionReceive: (cb) => getIPC().onVersionReceive(cb),
};

const installerBridge: InstallerBridge = {
  startInstall: (opts) => getIPC().startInstall(opts),
  requestInstallerState: () => getIPC().requestInstallerState(),
  onPythonSuccess: (cb) => getIPC().onPythonSuccess(cb),
  onInstallStarted: (cb) => getIPC().onInstallStarted(cb),
  onInstallerAwaitingChoice: (cb) => getIPC().onInstallerAwaitingChoice(cb),
  onInstallerNetworkError: (cb) => getIPC().onInstallerNetworkError(cb),
  onInstallerState: (cb) => getIPC().onInstallerState(cb),
  onPipProgress: (cb) => getIPC().onPipProgress(cb),
};

const llmBridge: LLMBridge = {
  llmStream: (msgs, tools) => getIPC().llmStream(msgs, tools),
  llmStreamAbort: () => getIPC().llmStreamAbort(),
  onLLMStreamChunk: (cb) => getIPC().onLLMStreamChunk(cb),
  llmCheckModel: (f) => getIPC().llmCheckModel(f),
  llmDownloadModel: (url, file) => getIPC().llmDownloadModel(url, file),
  onLLMDownloadProgress: (cb) => getIPC().onLLMDownloadProgress(cb),
  onLLMModelStatus: (cb) => getIPC().onLLMModelStatus(cb),
  llmUnloadModel: () => getIPC().llmUnloadModel(),
  llmGetSystemMemory: () => getIPC().llmGetSystemMemory!(),
  llmListDownloadedModels: () => getIPC().llmListDownloadedModels!(),
  llmDeleteModel: (file) => getIPC().llmDeleteModel!(file),

  ollamaChat: (msgs, tools) => getIPC().ollamaChat(msgs, tools),
  ollamaChatStream: (msgs, tools) => getIPC().ollamaChatStream(msgs, tools),
  ollamaChatStreamAbort: () => getIPC().ollamaChatStreamAbort(),
  onOllamaChatStream: (cb) => getIPC().onOllamaChatStream(cb),
  ollamaListModels: () => getIPC().ollamaListModels(),
  ollamaCheck: () => getIPC().ollamaCheck(),
  ollamaPullModel: (name) => getIPC().ollamaPullModel(name),
  onOllamaPullModelProgress: (cb) => getIPC().onOllamaPullModelProgress(cb),
};

const speechBridge: SpeechBridge = {
  sttStart: (lang) => getIPC().sttStart(lang),
  sttStop: () => getIPC().sttStop(),
  onSttResult: (cb) => getIPC().onSttResult(cb),
  ttsSpeak: (text, lang) => getIPC().ttsSpeak(text, lang),
  ttsStop: () => getIPC().ttsStop(),
  onTtsStatus: (cb) => getIPC().onTtsStatus(cb),
};

const voiceBridge: VoiceBridge = {
  voiceCheckModels: (lang) => getIPC().voiceCheckModels(lang),
  voiceDownloadModels: (lang) => getIPC().voiceDownloadModels(lang),
  onVoiceModelProgress: (cb) => getIPC().onVoiceModelProgress(cb),
  voiceStartSession: (lang, mode, threshold) => getIPC().voiceStartSession(lang, mode, threshold),
  voiceStopSession: () => getIPC().voiceStopSession(),
  voiceSendAudioChunk: (samples) => getIPC().voiceSendAudioChunk(samples),
  voiceFlush: () => getIPC().voiceFlush(),
  voiceUpdateSilenceThreshold: (t) => getIPC().voiceUpdateSilenceThreshold(t),
  onVoiceSttResult: (cb) => getIPC().onVoiceSttResult(cb),
  onVoiceVadEvent: (cb) => getIPC().onVoiceVadEvent(cb),
  voiceTtsGenerate: (text, lang, speed, sampleId, provider) => getIPC().voiceTtsGenerate(text, lang, speed, sampleId, provider),
  voiceTtsStop: () => getIPC().voiceTtsStop(),
  onVoiceTtsAudio: (cb) => getIPC().onVoiceTtsAudio(cb),
  onVoiceTtsStatus: (cb) => getIPC().onVoiceTtsStatus(cb),
  onVoiceSessionReady: (cb) => getIPC().onVoiceSessionReady(cb),
  onVoiceSessionError: (cb) => getIPC().onVoiceSessionError(cb),
  voiceSampleList: () => getIPC().voiceSampleList(),
  voiceSampleUpload: (path, name) => getIPC().voiceSampleUpload(path, name),
  voiceSampleDelete: (id) => getIPC().voiceSampleDelete(id),
  voiceSampleRename: (id, name) => getIPC().voiceSampleRename(id, name),
  voiceSampleTranscribe: (id) => getIPC().voiceSampleTranscribe(id),
  voiceSampleGetPath: (id) => getIPC().voiceSampleGetPath(id),
};

const mediaStatsBridge: MediaStatsBridge = {
  saveMediaStats: (hash, stats) => getIPC().saveMediaStats(hash, stats),
  getMediaStats: (hash) => getIPC().getMediaStats(hash),
  onMediaStats: (cb) => getIPC().onMediaStats(cb),
  listMediaStats: () => getIPC().listMediaStats(),
  onMediaStatsList: (cb) => getIPC().onMediaStatsList(cb),
};

const watchTogetherBridge: WatchTogetherBridge = {
  isWatchingTogether: () => getIPC().isWatchingTogether(),
  watchTogetherSend: (msg) => getIPC().watchTogetherSend(msg),
  onWatchTogetherLaunch: (cb) => getIPC().onWatchTogetherLaunch(cb),
  onWatchTogetherRequest: (cb) => getIPC().onWatchTogetherRequest(cb),
};

const overlayBridge: OverlayBridge = {
  sendOverlayVideoState: (state) => getIPC().sendOverlayVideoState(state),
  onOverlayVideoState: (cb) => getIPC().onOverlayVideoState(cb),
  requestOverlaySync: () => getIPC().requestOverlaySync(),
  onOverlayRequestSync: (cb) => getIPC().onOverlayRequestSync(cb),
  launchOverlay: () => getIPC().launchOverlay(),
  onOverlayLaunch: (cb) => getIPC().onOverlayLaunch(cb),
  onOverlayGeometry: (cb) => getIPC().onOverlayGeometry(cb),
  setOverlayIgnoreMouseEvents: (ignore) => getIPC().setOverlayIgnoreMouseEvents(ignore),
  sendOverlayCommand: (cmd) => getIPC().sendOverlayCommand(cmd),
  onOverlaySubtitleTracks: (cb) => getIPC().onOverlaySubtitleTracks(cb),
};

const crossWindowBridge: CrossWindowBridge = {
  onUpdatePills: (cb) => getIPC().onUpdatePills(cb),
  onUpdateWordAppearance: (cb) => getIPC().onUpdateWordAppearance(cb),
  onUpdateAttemptFlashcardCreation: (cb) => getIPC().onUpdateAttemptFlashcardCreation(cb),
  onUpdateCreateFlashcard: (cb) => getIPC().onUpdateCreateFlashcard(cb),
  onUpdateLastWatched: (cb) => getIPC().onUpdateLastWatched(cb),
};

const licenseBridge: LicenseBridge = {
  getLicenseType: () => getIPC().getLicenseType(),
  activateLicense: (key) => getIPC().activateLicense(key),
  removeLicense: () => getIPC().removeLicense(),
  onLicenseGet: (cb) => getIPC().onLicenseGet(cb),
  onLicenseActivated: (cb) => getIPC().onLicenseActivated(cb),
};

const migrationBridge: MigrationBridge = {
  getMigratedLocalStorage: () => getIPC().getMigratedLocalStorage(),
  getMigratedItem: (key) => getIPC().getMigratedItem(key),
  hasMigrationOccurred: () => getIPC().hasMigrationOccurred(),
  triggerMigration: () => getIPC().triggerMigration(),
  onLocalStorageMigrationComplete: (cb) => getIPC().onLocalStorageMigrationComplete(cb),
  onFlashcardMigrationComplete: (cb) => getIPC().onFlashcardMigrationComplete(cb),
  getFlashcardMigrationInfo: () => getIPC().getFlashcardMigrationInfo(),
};

const genericBridge: GenericIPCBridge = {
  sendLS: (data) => getIPC().sendLS(data),
  fetchUrl: (url) => getIPC().fetchUrl(url),
};

const dataBridge: DataBridge = {
  dataExport: () => getIPC().dataExport(),
  dataImport: () => getIPC().dataImport(),
};

const kvStoreBridge: KVStoreBridge = {
  kvGet: (key) => getIPC().kvGet(key),
  kvSet: (key, value) => getIPC().kvSet(key, value),
  kvRemove: (key) => getIPC().kvRemove(key),
  kvGetAll: () => getIPC().kvGetAll(),
  kvSetBatch: (entries) => getIPC().kvSetBatch(entries),
};

const browserBridge: BrowserBridge = {
  detectBrowsers: (customPaths) => getIPC().detectBrowsers(customPaths),
  installExtension: (browser) => getIPC().installExtension(browser),
  uninstallExtension: (browser) => getIPC().uninstallExtension(browser),
  isExtensionInstalled: (browser) => getIPC().isExtensionInstalled(browser),
};

export function createElectronBridge(): PlatformBridge {
  return {
    settings: settingsBridge,
    flashcards: flashcardBridge,
    plugins: pluginBridge,
    localization: localizationBridge,
    files: fileBridge,
    window: windowBridge,
    server: serverBridge,
    installer: installerBridge,
    llm: llmBridge,
    speech: speechBridge,
    voice: voiceBridge,
    mediaStats: mediaStatsBridge,
    watchTogether: watchTogetherBridge,
    overlay: overlayBridge,
    crossWindow: crossWindowBridge,
    license: licenseBridge,
    migration: migrationBridge,
    generic: genericBridge,
    data: dataBridge,
    kvStore: kvStoreBridge,
    browser: browserBridge,
  };
}
