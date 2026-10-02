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
  GraphBridge,
  FileBridge,
  WindowBridge,
  ServerBridge,
  UpdateBridge,
  InstallerBridge,
  LLMBridge,
  SpeechBridge,
  VoiceBridge,
  MediaStatsBridge,
  KnowledgeEventsBridge,
  WatchTogetherBridge,
  OverlayBridge,
  CrossWindowBridge,
  LicenseBridge,
  MigrationBridge,
  GenericIPCBridge,
  DataBridge,
  KVStoreBridge,
  JournalBridge,
  WorldBridge,
  BrowserBridge,
  DiagnosticsBridge,
} from './types';

function getIPC(): MLearnIPC {
  const ipc = window.mLearnIPC;
  if (!ipc) throw new Error('ElectronBridge: window.mLearnIPC is not available');
  return ipc;
}

const settingsBridge: SettingsBridge = {
  getSettings: () => getIPC().getSettings(),
  saveSettings: (s) => getIPC().saveSettings(s),
  awaitSettingsSaved: () => getIPC().awaitSettingsSaved(),
  onSettings: (cb) => getIPC().onSettings(cb),
  onSettingsSaved: (cb) => getIPC().onSettingsSaved(cb),
};

const flashcardBridge: FlashcardBridge = {
  commitFlashcardRating: command => getIPC().commitFlashcardRating(command),
  enqueueFlashcardRating: command => getIPC().enqueueFlashcardRating(command),
  flushFlashcardRatings: () => getIPC().flushFlashcardRatings(),
  onFlashcardRatingsCommitted: callback => getIPC().onFlashcardRatingsCommitted(callback),
  getFlashcards: (knownRev?: number) => getIPC().getFlashcards(knownRev),
  saveFlashcards: (fc, removedCardIds, resetReviewProgress, authorization) => removedCardIds === undefined && resetReviewProgress === undefined && authorization === undefined
    ? getIPC().saveFlashcards(fc)
    : getIPC().saveFlashcards(fc, removedCardIds, resetReviewProgress, authorization),
  saveFlashcardPatch: (patch, removedCardIds, resetReviewProgress, authorization) => removedCardIds === undefined && resetReviewProgress === undefined && authorization === undefined
    ? getIPC().saveFlashcardPatch(patch)
    : getIPC().saveFlashcardPatch(patch, removedCardIds, resetReviewProgress, authorization),
  onFlashcards: (cb) => getIPC().onFlashcards(cb),
  onFlashcardLoadError: (cb) => getIPC().onFlashcardLoadError(cb),
  onNewDayFlashcards: (cb) => getIPC().onNewDayFlashcards(cb),
  onFlashcardConnectOpen: (cb) => getIPC().onFlashcardConnectOpen(cb),
  onReviewFlashcardRequest: (cb) => getIPC().onReviewFlashcardRequest(cb),
  saveFlashcardImage: (cardId, dataUrl) => getIPC().saveFlashcardImage(cardId, dataUrl),
  resolveFlashcardImage: (imageUrl) => getIPC().resolveFlashcardImage(imageUrl),
  deleteFlashcardImage: (cardId) => getIPC().deleteFlashcardImage(cardId),
  saveFlashcardVideo: (cardId, data) => getIPC().saveFlashcardVideo(cardId, data),
  deleteFlashcardVideo: (cardId) => getIPC().deleteFlashcardVideo(cardId),
  getFlashcardTts: (cardId, field) => getIPC().getFlashcardTts(cardId, field),
  generateFlashcardTts: (cardId, text, language, field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl, preset) => getIPC().generateFlashcardTts(cardId, text, language, field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl, preset),
  batchGenerateFlashcardTts: (items, language, provider, voiceSampleId, cloudAuthToken, cloudApiUrl, preset) => getIPC().batchGenerateFlashcardTts(items, language, provider, voiceSampleId, cloudAuthToken, cloudApiUrl, preset),
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
  getLanguageDataCatalog: () => getIPC().getLanguageDataCatalog(),
  onLanguageDataCatalog: (cb) => getIPC().onLanguageDataCatalog(cb),
  installLanguageData: (language, dictionaryTargetLanguage, installOptions) => getIPC().installLanguageData(language, dictionaryTargetLanguage, installOptions),
  onLanguageDataInstalled: (cb) => getIPC().onLanguageDataInstalled(cb),
  onLanguageDataInstallError: (cb) => getIPC().onLanguageDataInstallError(cb),
};

const graphBridge: GraphBridge = {
  getGraphMeta: (language) => getIPC().getGraphMeta(language),
  lookupGraphWord: (language, input) => getIPC().lookupGraphWord(language, input),
  getGraphRelated: (language, entityId, relationTypes) => getIPC().getGraphRelated(language, entityId, relationTypes),
  getGraphTargetsForSurfaces: (language, inputs) => getIPC().getGraphTargetsForSurfaces(language, inputs),
  getGraphNeighborhood: (language, query) => getIPC().getGraphNeighborhood(language, query),
  getEvidenceLinkedSurfaces: (language, surfaces, keys) => getIPC().getEvidenceLinkedSurfaces(language, surfaces, keys),
  getKnowledgeProjection: (language, surface, thresholds) => getIPC().getKnowledgeProjection(language, surface, thresholds),
};

const fileBridge: FileBridge = {
  readDirectoryImages: (dir) => getIPC().readDirectoryImages(dir),
  readPdfFile: (path) => getIPC().readPdfFile(path),
  readMediaFile: (path) => getIPC().readMediaFile(path),
  readMediaFileChunk: (path, offset, length) => getIPC().readMediaFileChunk(path, offset, length),
  getFileSize: (path) => getIPC().getFileSize(path),
  selectVideoFile: () => getIPC().selectVideoFile(),
  selectSubtitleFile: () => getIPC().selectSubtitleFile(),
  selectBookFolder: () => getIPC().selectBookFolder(),
  selectPdfFile: () => getIPC().selectPdfFile(),
  selectBrowserFile: () => getIPC().selectBrowserFile(),
  getPathForFile: (file) => getIPC().getPathForFile(file),
  removeLegacyLanguageData: (paths) => getIPC().removeLegacyLanguageData(paths),
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
  reportStartupState: (state) => getIPC().reportStartupState(state),
  minimizeWindow: () => getIPC().minimizeWindow(),
  maximizeWindow: () => getIPC().maximizeWindow(),
  restoreWindow: () => getIPC().restoreWindow(),
  popupMenu: (menuId) => getIPC().popupMenu(menuId),
  setTitleBarOverlay: (options) => getIPC().setTitleBarOverlay(options),
  onWindowFullscreenChange: (cb) => getIPC().onWindowFullscreenChange(cb),
  getWindowContext: (type) => getIPC().getWindowContext(type),
  onWindowContext: (cb) => getIPC().onWindowContext(cb),
  onOpenSettings: (cb) => getIPC().onOpenSettings(cb),
  onOpenAside: (cb) => getIPC().onOpenAside(cb),
  onContextMenuCommand: (cb) => getIPC().onContextMenuCommand(cb),
  onReaderContextMenuCommand: (cb) => getIPC().onReaderContextMenuCommand(cb),
  onOpenWordDbEditor: (cb) => getIPC().onOpenWordDbEditor(cb),
  onOpenLevelStudy: (cb) => getIPC().onOpenLevelStudy(cb),
  onOpenPrompt: (cb) => getIPC().onOpenPrompt(cb),
  onAuthDeepLink: (cb) => getIPC().onAuthDeepLink(cb),
  onLookupDeepLink: (cb) => getIPC().onLookupDeepLink(cb),
  onOpenRoomEvent: (cb) => getIPC().onOpenRoomEvent(cb),
  promptOutput: (text) => getIPC().promptOutput(text),
};

const serverBridge: ServerBridge = {
  isLoaded: () => getIPC().isLoaded(),
  isSuccess: () => getIPC().isSuccess(),
  getBackendToken: () => getIPC().getBackendToken(),
  onBackendTokenChanged: (cb) => getIPC().onBackendTokenChanged(cb),
  onServerLoad: (cb) => getIPC().onServerLoad(cb),
  onServerStatusUpdate: (cb) => getIPC().onServerStatusUpdate(cb),
  onServerCriticalError: (cb) => getIPC().onServerCriticalError(cb),
  onAnkiConnectionError: (cb) => getIPC().onAnkiConnectionError(cb),
  onOcrStatusUpdate: (cb) => getIPC().onOcrStatusUpdate(cb),
  sendLogRecord: (record) => getIPC().sendLogRecord(record),
  restartApp: () => getIPC().restartApp(),
  forceRestartApp: () => getIPC().forceRestartApp(),
  restartBackend: () => getIPC().restartBackend(),
  completeInitialSetup: () => getIPC().completeInitialSetup(),
  getVersion: () => getIPC().getVersion(),
  onVersionReceive: (cb) => getIPC().onVersionReceive(cb),
  getLegalDocument: (name) => getIPC().getLegalDocument(name),
  onLegalDocumentReceive: (cb) => getIPC().onLegalDocumentReceive(cb),
};

const updateBridge: UpdateBridge = {
  getUpdateState: () => getIPC().getUpdateState(),
  checkForUpdates: (autoDownload) => getIPC().checkForUpdates(autoDownload),
  downloadUpdate: () => getIPC().downloadUpdate(),
  installUpdate: () => getIPC().installUpdate(),
  onUpdateStateChanged: (cb) => getIPC().onUpdateStateChanged(cb),
};

const installerBridge: InstallerBridge = {
  startInstall: (opts) => getIPC().startInstall(opts),
  cancelInstall: () => getIPC().cancelInstall(),
  requestInstallerState: () => getIPC().requestInstallerState(),
  onPythonSuccess: (cb) => getIPC().onPythonSuccess(cb),
  onInstallStarted: (cb) => getIPC().onInstallStarted(cb),
  onInstallerAwaitingChoice: (cb) => getIPC().onInstallerAwaitingChoice(cb),
  onInstallerNetworkError: (cb) => getIPC().onInstallerNetworkError(cb),
  onInstallerState: (cb) => getIPC().onInstallerState(cb),
  onPipProgress: (cb) => getIPC().onPipProgress(cb),
  getComponentsState: () => getIPC().getComponentsState(),
  uninstallComponents: (ids) => getIPC().uninstallComponents(ids),
  onComponentsState: (cb) => getIPC().onComponentsState(cb),
  onComponentsUninstalled: (cb) => getIPC().onComponentsUninstalled(cb),
};

const llmBridge: LLMBridge = {
  llmStream: (msgs, tools, tier, think, traceContext) => getIPC().llmStream(msgs, tools, tier, think, traceContext),
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
  supportsCalls: true,
  voiceCheckModels: (lang) => getIPC().voiceCheckModels(lang),
  voiceDownloadModels: (lang) => getIPC().voiceDownloadModels(lang),
  onVoiceModelProgress: (cb) => getIPC().onVoiceModelProgress(cb),
  voiceStartSession: (lang, mode, threshold, provider, request) => getIPC().voiceStartSession(lang, mode, threshold, provider, request),
  voiceStopSession: (scope) => getIPC().voiceStopSession(scope),
  voiceSendAudioChunk: (samples, scope) => getIPC().voiceSendAudioChunk(samples, scope),
  voiceFlush: (scope) => getIPC().voiceFlush(scope),
  voiceUpdateSilenceThreshold: (t, scope) => getIPC().voiceUpdateSilenceThreshold(t, scope),
  onVoiceSttResult: (cb) => getIPC().onVoiceSttResult(cb),
  onVoiceVadEvent: (cb) => getIPC().onVoiceVadEvent(cb),
  voiceTtsGenerate: (text, lang, speed, sampleId, provider, cloudAuthToken, request) => getIPC().voiceTtsGenerate(text, lang, speed, sampleId, provider, cloudAuthToken, request),
  voiceTtsStop: (scope) => getIPC().voiceTtsStop(scope),
  voiceSendTtsState: (active, scope) => getIPC().voiceTtsState(active, scope),
  onVoiceTtsAudio: (cb) => getIPC().onVoiceTtsAudio(cb),
  onVoiceTtsStatus: (cb) => getIPC().onVoiceTtsStatus(cb),
  onVoiceSessionReady: (cb) => getIPC().onVoiceSessionReady(cb),
  onVoiceSessionStatus: (cb) => getIPC().onVoiceSessionStatus(cb),
  onVoiceSessionError: (cb) => getIPC().onVoiceSessionError(cb),
  voiceSampleList: () => getIPC().voiceSampleList(),
  voiceSampleUpload: (path, name) => getIPC().voiceSampleUpload(path, name),
  voiceSampleDelete: (id) => getIPC().voiceSampleDelete(id),
  voiceSampleRename: (id, name) => getIPC().voiceSampleRename(id, name),
  voiceSampleTranscribe: (id, language) => getIPC().voiceSampleTranscribe(id, language),
  voiceSampleGetPath: (id) => getIPC().voiceSampleGetPath(id),
};

const mediaStatsBridge: MediaStatsBridge = {
  saveMediaStats: (hash, stats) => getIPC().saveMediaStats(hash, stats),
  getMediaStats: (hash) => getIPC().getMediaStats(hash),
  onMediaStats: (cb) => getIPC().onMediaStats(cb),
  listMediaStats: () => getIPC().listMediaStats(),
  onMediaStatsList: (cb) => getIPC().onMediaStatsList(cb),
};

const knowledgeEventsBridge: KnowledgeEventsBridge = {
  recordLearningDecision: (decision) => getIPC().recordLearningDecision(decision),
  getLearningDecisionRecord: (id) => getIPC().getLearningDecisionRecord(id),
  getRatingUndoHistory: (surface) => getIPC().getRatingUndoHistory(surface),
  appendKnowledgeEvents: (eventsByKey) => getIPC().appendKnowledgeEvents(eventsByKey),
  queryKnowledgeEvents: (keys) => getIPC().queryKnowledgeEvents(keys),
  queryKnowledgeItemEvents: (keys) => getIPC().queryKnowledgeItemEvents(keys),
  queryKnowledgeEventsForLanguage: (language) => getIPC().queryKnowledgeEventsForLanguage(language),
  getKnowledgeEvents: (key) => getIPC().getKnowledgeEvents(key),
  getGrammarProjections: (language) => getIPC().getGrammarProjections(language),
  onKnowledgeEventsChanged: (callback) => getIPC().onKnowledgeEventsChanged(callback),
  getKnowledgeStates: (keys) => getIPC().getKnowledgeStates(keys),
  getKnowledgeRows: (keys) => getIPC().getKnowledgeRows(keys),
  getKnowledgeArchive: (key) => getIPC().getKnowledgeArchive(key),
  queryKnowledgeSummaries: (language) => getIPC().queryKnowledgeSummaries(language),
  queryAnkiReviewIds: (language, ids) => getIPC().queryAnkiReviewIds(language, ids),
  queryAnkiReviewIdSets: (keys) => getIPC().queryAnkiReviewIdSets(keys),
  queryLanguageKeys: (language, prefix) => getIPC().queryLanguageKeys(language, prefix),
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
  onOverlayVideoScreenshot: (cb) => getIPC().onOverlayVideoScreenshot(cb),
  requestOverlaySync: () => getIPC().requestOverlaySync(),
  onOverlayRequestSync: (cb) => getIPC().onOverlayRequestSync(cb),
  launchOverlay: () => getIPC().launchOverlay(),
  onOverlayLaunch: (cb) => getIPC().onOverlayLaunch(cb),
  onOverlayGeometry: (cb) => getIPC().onOverlayGeometry(cb),
  setOverlayIgnoreMouseEvents: (ignore) => getIPC().setOverlayIgnoreMouseEvents(ignore),
  sendOverlayCommand: (cmd) => getIPC().sendOverlayCommand(cmd),
  sendOverlaySubtitleTracks: (tracks) => getIPC().sendOverlaySubtitleTracks(tracks),
  onOverlaySubtitleTracks: (cb) => getIPC().onOverlaySubtitleTracks(cb),
  overlayMoveBy: (delta) => getIPC().overlayMoveBy(delta),
  overlayResizeBy: (delta) => getIPC().overlayResizeBy(delta),
  overlayGetBounds: () => getIPC().overlayGetBounds(),
  overlaySetAutoPosition: (enabled) => getIPC().overlaySetAutoPosition(enabled),
  overlaySetGeometryLocked: (locked) => getIPC().overlaySetGeometryLocked(locked),
  onOverlayAutoPositionChanged: (cb) => getIPC().onOverlayAutoPositionChanged(cb),
  sendOverlayTextModeLookup: (payload) => getIPC().sendOverlayTextModeLookup(payload),
  onOverlayTextModeLookup: (cb) => getIPC().onOverlayTextModeLookup(cb),
  onOverlayTextModeConnected: (cb) => getIPC().onOverlayTextModeConnected(cb),
  overlaySaveSiteState: (payload) => getIPC().overlaySaveSiteState(payload),
  overlayLoadSiteState: (url) => getIPC().overlayLoadSiteState(url),
  overlayClearSiteState: (url) => getIPC().overlayClearSiteState(url),
  overlaySetBounds: (bounds) => getIPC().overlaySetBounds(bounds),
  onOverlayActiveUrlChanged: (cb) => getIPC().onOverlayActiveUrlChanged(cb),
  onOverlayCloseHover: (cb) => getIPC().onOverlayCloseHover(cb),
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
  onFlashcardMigrationComplete: (cb) => getIPC().onFlashcardMigrationComplete(cb),
};

const genericBridge: GenericIPCBridge = {
  fetchUrl: (url) => getIPC().fetchUrl(url),
};

const dataBridge: DataBridge = {
  dataExport: () => getIPC().dataExport(),
  dataImport: () => getIPC().dataImport(),
  getProtectionStatus: () => getIPC().getProtectionStatus(),
  listRecoveryPoints: () => getIPC().listRecoveryPoints(),
  restoreRecoveryPoint: (id) => getIPC().restoreRecoveryPoint(id),
};

const kvStoreBridge: KVStoreBridge = {
  kvGet: (key) => getIPC().kvGet(key),
  kvSet: (key, value) => getIPC().kvSet(key, value),
  kvRemove: (key) => getIPC().kvRemove(key),
  kvGetAll: () => getIPC().kvGetAll(),
  kvSetBatch: (entries) => getIPC().kvSetBatch(entries),
};

const journalBridge: JournalBridge = {
  appendEvent: (roomId, draft) => getIPC().appendEvent(roomId, draft),
  subscribeRoom: (roomId, limit) => getIPC().subscribeRoom(roomId, limit),
  queryEvents: (roomId, opts) => getIPC().queryEvents(roomId, opts),
  readSeaProjection: (roomId, limit) => getIPC().readSeaProjection(roomId, limit),
  readThread: (roomId, threadId) => getIPC().readThread(roomId, threadId),
  eraseThread: (roomId, threadId) => getIPC().eraseThread(roomId, threadId),
};

const worldBridge: WorldBridge = {
  onChanged: (callback) => getIPC().onWorldChanged(callback),
  getWorldState: () => getIPC().getWorldState(),
  createRoom: (title) => getIPC().createRoom(title),
  applyMembership: (roomId, participantId, kind) => getIPC().applyMembership(roomId, participantId, kind),
  prepareScenario: (input) => getIPC().prepareScenario(input),
  activateScenario: (id) => getIPC().activateScenario(id),
  cancelScenario: (id) => getIPC().cancelScenario(id),
  createSandbox: (input) => getIPC().createSandbox(input),
  createPersistentRoom: (input) => getIPC().createPersistentRoom(input),
  updateThread: (thread) => getIPC().updateThread(thread),
  deleteThread: (roomId, threadId) => getIPC().deleteThread(roomId, threadId),
  rememberThis: (input) => getIPC().rememberThis(input),
  triggerReflection: (input) => getIPC().triggerReflection(input),
  retryMaintenance: (reflectionId) => getIPC().retryMaintenance(reflectionId),
  activateContact: (contactId) => getIPC().activateContact(contactId),
  respondToContact: (contactId, response) => getIPC().respondToContact(contactId, response),
  integrateThread: (input) => getIPC().integrateThread(input),
  previewIntegration: (input) => getIPC().previewIntegration(input),
  createParticipant: (input) => getIPC().createParticipant(input),
  updateParticipant: (participant, threadId) => getIPC().updateParticipant(participant, threadId),
  deleteParticipant: (participantId) => getIPC().deleteParticipant(participantId),
  clearRoomUnread: (roomId) => getIPC().clearRoomUnread(roomId),
  saveStoryTrack: (input) => getIPC().saveStoryTrack(input),
  setStoryProgress: (input) => getIPC().setStoryProgress(input),
  updateStoryBranch: (input) => getIPC().updateStoryBranch(input),
  researchCharacter: (input) => getIPC().researchCharacter(input),
  cancelCharacterResearch: (operationId) => getIPC().cancelCharacterResearch(operationId),
  prepareStoryAdvance: (input) => getIPC().prepareStoryAdvance(input),
  applyStoryAdvance: (id) => getIPC().applyStoryAdvance(id),
  cancelStoryAdvance: (id) => getIPC().cancelStoryAdvance(id),
  reviewConversationTurn: (input) => getIPC().reviewConversationTurn(input),
  cancelConversationReview: (operationId) => getIPC().cancelConversationReview(operationId),
  getLocalGuardStatus: () => getIPC().getLocalGuardStatus(),
  installLocalGuard: () => getIPC().installLocalGuard(),
};

const browserBridge: BrowserBridge = {
  detectBrowsers: (customPaths) => getIPC().detectBrowsers(customPaths),
  installExtension: (browser) => getIPC().installExtension(browser),
  uninstallExtension: (browser) => getIPC().uninstallExtension(browser),
  isExtensionInstalled: (browser) => getIPC().isExtensionInstalled(browser),
  openExtensionFolder: () => getIPC().openExtensionFolder(),
};

const diagnosticsBridge: DiagnosticsBridge = {
  getRuntimeTraces: () => getIPC().getRuntimeTraces(),
  getRuntimeTrace: (id) => getIPC().getRuntimeTrace(id),
  clearRuntimeTraces: () => getIPC().clearRuntimeTraces(),
  onRuntimeTraceChanged: (callback) => getIPC().onRuntimeTraceChanged(callback),
  recordRuntimeTool: (observation) => getIPC().recordRuntimeTool(observation),
  getRuntimeWorld: () => getIPC().getRuntimeWorld(),
  runDiagnostics: () => getIPC().runDiagnostics(),
  onDiagnosticsProgress: (cb) => getIPC().onDiagnosticsProgress(cb),
  onDiagnosticsComplete: (cb) => getIPC().onDiagnosticsComplete(cb),
  saveDiagnosticsReport: (reportJson) => getIPC().saveDiagnosticsReport(reportJson),
};

export function createElectronBridge(): PlatformBridge {
  return {
    settings: settingsBridge,
    flashcards: flashcardBridge,
    plugins: pluginBridge,
    localization: localizationBridge,
    graph: graphBridge,
    files: fileBridge,
    window: windowBridge,
    server: serverBridge,
    updates: updateBridge,
    installer: installerBridge,
    llm: llmBridge,
    speech: speechBridge,
    voice: voiceBridge,
    mediaStats: mediaStatsBridge,
    knowledgeEvents: knowledgeEventsBridge,
    watchTogether: watchTogetherBridge,
    overlay: overlayBridge,
    crossWindow: crossWindowBridge,
    license: licenseBridge,
    migration: migrationBridge,
    generic: genericBridge,
    data: dataBridge,
    kvStore: kvStoreBridge,
    journal: journalBridge,
    world: worldBridge,
    browser: browserBridge,
    diagnostics: diagnosticsBridge,
  };
}
