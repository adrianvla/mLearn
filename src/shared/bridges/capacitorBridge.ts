/**
 * Capacitor Bridge Implementation
 *
 * Implements PlatformBridge for mobile (Capacitor) and web (tethered) platforms.
 * Uses @capacitor/preferences for storage, HTTP for backend communication,
 * and Web APIs for speech. Methods not applicable on mobile return no-ops.
 */

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
  DiagnosticsBridge,
} from './types';
import type {
  PluginBusEnvelope,
  PluginBusJSONValue,
} from '../pluginBus';
import type {
  Settings,
  FlashcardStore,
  LanguageData,
  MediaStats,
  LLMModelStatus,
  VoiceModelStatus,
  VoiceSample,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { PYTHON_BACKEND_PORT, PROXY_SERVER_PORT } from '../constants';
import { isCapacitor } from '../platform';
import { loadBundledLanguageData, loadBundledLocaleStrings } from './bundledLanguageAssets';
import { getLogger } from '../utils/logger';

const log = getLogger("shared.bridges.capacitor");

// ============================================================================
// Simple Event Emitter for local pub/sub
// ============================================================================

type Listener = (...args: unknown[]) => void;

class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach(fn => fn(...args));
  }
}

const emitter = new EventEmitter();

// ============================================================================
// Storage helpers (Capacitor Preferences or localStorage fallback)
// ============================================================================

// Cache the module promise — never expose the Preferences proxy object directly
// from an async function, because Capacitor plugin proxies intercept `.then`
// access, which triggers automatic thenable unwrapping and causes
// "Preferences.then() is not implemented" errors.
let prefsModulePromise: Promise<typeof import('@capacitor/preferences') | null> | null = null;

function getPreferencesModule(): Promise<typeof import('@capacitor/preferences') | null> {
  if (!prefsModulePromise) {
    prefsModulePromise = import('@capacitor/preferences').catch(() => null);
  }
  return prefsModulePromise;
}

async function storageGet(key: string): Promise<string | null> {
  try {
    const mod = await getPreferencesModule();
    if (mod) {
      const result = await mod.Preferences.get({ key });
      return result.value;
    }
  } catch (e) {
    log.error("error", e);
    log.info('[CapacitorBridge] Preferences.get failed, falling back to localStorage:', e);
  }
  return localStorage.getItem(key);
}

async function storageSet(key: string, value: string): Promise<void> {
  // Always write to localStorage as a fast sync cache
  localStorage.setItem(key, value);
  try {
    const mod = await getPreferencesModule();
    if (mod) {
      await mod.Preferences.set({ key, value });
    }
  } catch (e) {
    log.error("error", e);
    log.info('[CapacitorBridge] Preferences.set failed, data saved to localStorage only:', e);
  }
}

// ============================================================================
// Filesystem helpers for flashcard media (images/videos)
// ============================================================================

const FLASHCARD_IMAGES_DIR = 'flashcard-images';
const FLASHCARD_VIDEOS_DIR = 'flashcard-videos';

let filesystemModulePromise: Promise<typeof import('@capacitor/filesystem') | null> | null = null;

function getFilesystemModule(): Promise<typeof import('@capacitor/filesystem') | null> {
  if (!filesystemModulePromise) {
    filesystemModulePromise = import('@capacitor/filesystem').catch(() => null);
  }
  return filesystemModulePromise;
}

/**
 * Convert a native file:// URI to a web view-renderable URL using
 * Capacitor.convertFileSrc. On native platforms this maps to the local
 * server URL (capacitor://localhost/_capacitor_file_/ on iOS, etc.).
 */
function convertToWebViewUrl(fileUri: string): string {
  if (!isCapacitor()) return fileUri;
  try {
    const cap = (globalThis as Record<string, unknown>).Capacitor as
      { convertFileSrc?: (path: string) => string } | undefined;
    if (cap?.convertFileSrc) {
      return cap.convertFileSrc(fileUri);
    }
  } catch (e) {
    log.error("error", e);
    // Fall through
  }
  return fileUri;
}

function extensionFromDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/(\w+)/);
  if (!match) return 'jpg';
  const mime = match[1].toLowerCase();
  if (mime === 'jpeg') return 'jpg';
  return mime;
}

function base64FromDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : null;
}

function isBase64DataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Ensure a directory exists under Directory.Data.
 */
async function ensureDir(dirPath: string): Promise<void> {
  const mod = await getFilesystemModule();
  if (!mod) return;
  try {
    await mod.Filesystem.mkdir({
      path: dirPath,
      directory: mod.Directory.Data,
      recursive: true,
    });
  } catch (e) {
    log.error("error", e);
    // Directory may already exist — ignore
  }
}

/**
 * Save a base64 data URL as a file. Returns web-view-renderable URL.
 */
async function saveImageFile(cardId: string, dataUrl: string): Promise<string | null> {
  if (!isBase64DataUrl(dataUrl)) return dataUrl;
  const mod = await getFilesystemModule();
  if (!mod) return dataUrl;

  const ext = extensionFromDataUrl(dataUrl);
  const base64 = base64FromDataUrl(dataUrl);
  if (!base64) return dataUrl;

  await ensureDir(FLASHCARD_IMAGES_DIR);
  const filePath = `${FLASHCARD_IMAGES_DIR}/${cardId}.${ext}`;
  await mod.Filesystem.writeFile({
    path: filePath,
    data: base64,
    directory: mod.Directory.Data,
  });

  const { uri } = await mod.Filesystem.getUri({
    path: filePath,
    directory: mod.Directory.Data,
  });
  return convertToWebViewUrl(uri);
}

/**
 * Save an ArrayBuffer as an mp4 video file. Returns web-view-renderable URL.
 */
async function saveVideoFile(cardId: string, data: ArrayBuffer): Promise<string | null> {
  const mod = await getFilesystemModule();
  if (!mod) return null;

  await ensureDir(FLASHCARD_VIDEOS_DIR);
  const filePath = `${FLASHCARD_VIDEOS_DIR}/${cardId}.mp4`;

  // Convert ArrayBuffer to base64 for Capacitor Filesystem
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  await mod.Filesystem.writeFile({
    path: filePath,
    data: base64,
    directory: mod.Directory.Data,
  });

  const { uri } = await mod.Filesystem.getUri({
    path: filePath,
    directory: mod.Directory.Data,
  });
  return convertToWebViewUrl(uri);
}

/**
 * Delete a flashcard image file.
 */
async function deleteImageFile(cardId: string): Promise<void> {
  const mod = await getFilesystemModule();
  if (!mod) return;

  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    try {
      await mod.Filesystem.deleteFile({
        path: `${FLASHCARD_IMAGES_DIR}/${cardId}.${ext}`,
        directory: mod.Directory.Data,
      });
    } catch (e) {
      log.error("error", e);
      // File may not exist with this extension — ignore
    }
  }
}

/**
 * Delete a flashcard video file.
 */
async function deleteVideoFile(cardId: string): Promise<void> {
  const mod = await getFilesystemModule();
  if (!mod) return;

  try {
    await mod.Filesystem.deleteFile({
      path: `${FLASHCARD_VIDEOS_DIR}/${cardId}.mp4`,
      directory: mod.Directory.Data,
    });
  } catch (e) {
    log.error("error", e);
    // File may not exist — ignore
  }
}

/**
 * Migrate inline base64 images in a flashcard store to filesystem files.
 * Modifies the store in place and returns whether any changes were made.
 */
async function extractBase64ImagesToFiles(store: FlashcardStore): Promise<boolean> {
  let modified = false;
  for (const [cardId, card] of Object.entries(store.flashcards)) {
    if (!card.content) continue;
    if (isBase64DataUrl(card.content.imageUrl)) {
      const url = await saveImageFile(cardId, card.content.imageUrl);
      if (url && url !== card.content.imageUrl) {
        card.content.imageUrl = url;
        modified = true;
      }
    }
    if (isBase64DataUrl(card.content.screenshotUrl)) {
      const url = await saveImageFile(cardId, card.content.screenshotUrl);
      if (url && url !== card.content.screenshotUrl) {
        card.content.screenshotUrl = url;
        modified = true;
      }
    }
  }

  if (store.suggestedFlashcards) {
    for (const [key, suggestion] of Object.entries(store.suggestedFlashcards)) {
      if (!suggestion || !isBase64DataUrl(suggestion.imageUrl)) continue;
      const fileKey = `suggested-${suggestion.id || key}`;
      const url = await saveImageFile(fileKey, suggestion.imageUrl);
      if (url && url !== suggestion.imageUrl) {
        suggestion.imageUrl = url;
        modified = true;
      }
    }
  }

  return modified;
}

// ============================================================================
// Backend URL helper
// ============================================================================

function getBackendUrl(): string {
  // Read from stored settings or use default
  const stored = localStorage.getItem('mlearn-backend-url');
  return stored || `http://127.0.0.1:${PYTHON_BACKEND_PORT}`;
}

function getNodeServerUrl(): string {
  const stored = localStorage.getItem('mlearn-node-server-url');
  return stored || `http://127.0.0.1:${PROXY_SERVER_PORT}`;
}

// ============================================================================
// No-op helper
// ============================================================================

const noop = () => {};
const noopCleanup = () => noop;

// ============================================================================
// Settings Bridge
// ============================================================================

const settingsBridge: SettingsBridge = {
  getSettings() {
    storageGet('settings')
      .then(raw => {
        const settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
        emitter.emit('settings', settings);
      })
      .catch(e => {
        log.error('[CapacitorBridge] Failed to load settings, using defaults:', e);
        emitter.emit('settings', { ...DEFAULT_SETTINGS });
      });
  },

  saveSettings(settings: Settings) {
    storageSet('settings', JSON.stringify(settings))
      .then(() => {
        emitter.emit('settings', settings);
        emitter.emit('settings-saved');
      })
      .catch(e => {
        log.error('[CapacitorBridge] Failed to save settings:', e);
      });
  },

  onSettings(callback) {
    return emitter.on('settings', callback as Listener);
  },

  onSettingsSaved(callback) {
    return emitter.on('settings-saved', callback as Listener);
  },
};

// ============================================================================
// Flashcard sharded storage helpers
// ============================================================================

const FLASHCARD_SHARD_COUNT = 16;
const FLASHCARD_META_KEY = 'flashcards_meta';
const FLASHCARD_CARDS_SHARD_PREFIX = 'flashcards_cards_shard_';
const FLASHCARD_STATS_SHARD_PREFIX = 'flashcards_stats_shard_';
const FLASHCARD_LEGACY_KEY = 'flashcards';

function getShardIndex(hexKey: string): number {
  return parseInt(hexKey.substring(0, 2), 16) % FLASHCARD_SHARD_COUNT;
}

function splitIntoShards<T>(map: Record<string, T>): Record<string, T>[] {
  const shards: Record<string, T>[] = Array.from({ length: FLASHCARD_SHARD_COUNT }, () => ({}));
  for (const [key, value] of Object.entries(map)) {
    shards[getShardIndex(key)][key] = value;
  }
  return shards;
}

interface FlashcardShardMeta {
  version: number;
  shardCount: number;
  lastUpdated: string;
  flashcards: FlashcardStore['flashcards'];
  wordCandidates: FlashcardStore['wordCandidates'];
  knownUntracked: FlashcardStore['knownUntracked'];
  ignoredWords: FlashcardStore['ignoredWords'];
  wordKnowledge: FlashcardStore['wordKnowledge'];
  grammarKnowledge: FlashcardStore['grammarKnowledge'];
  suggestedFlashcards: FlashcardStore['suggestedFlashcards'];
  wordSyncSeen: FlashcardStore['wordSyncSeen'];
  dailyStats: FlashcardStore['dailyStats'];
  storeMeta: FlashcardStore['meta'];
  storeVersion: FlashcardStore['version'];
}

async function loadShardedFlashcards(): Promise<FlashcardStore> {
  const metaRaw = await storageGet(FLASHCARD_META_KEY);

  if (!metaRaw) {
    const legacyRaw = await storageGet(FLASHCARD_LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as FlashcardStore;
      await saveShardedFlashcards(legacy);
      try {
        const mod = await getPreferencesModule();
        if (mod) await mod.Preferences.remove({ key: FLASHCARD_LEGACY_KEY });
        localStorage.removeItem(FLASHCARD_LEGACY_KEY);
      } catch (e) {
        log.error("error", e);
      }
      return legacy;
    }
    return { flashcards: {}, wordCandidates: {} } as FlashcardStore;
  }

  const meta = JSON.parse(metaRaw) as FlashcardShardMeta;

  const allShardRaws = await Promise.all(
    Array.from({ length: FLASHCARD_SHARD_COUNT * 2 }, (_, idx) => {
      const i = idx % FLASHCARD_SHARD_COUNT;
      const prefix = idx < FLASHCARD_SHARD_COUNT ? FLASHCARD_CARDS_SHARD_PREFIX : FLASHCARD_STATS_SHARD_PREFIX;
      return storageGet(`${prefix}${i}`);
    })
  );

  const wordToCardMap: FlashcardStore['wordToCardMap'] = {};
  const wordStatsMap: FlashcardStore['wordStatsMap'] = {};

  for (let i = 0; i < FLASHCARD_SHARD_COUNT; i++) {
    const cardRaw = allShardRaws[i];
    const statsRaw = allShardRaws[FLASHCARD_SHARD_COUNT + i];
    if (cardRaw) Object.assign(wordToCardMap, JSON.parse(cardRaw) as FlashcardStore['wordToCardMap']);
    if (statsRaw) Object.assign(wordStatsMap, JSON.parse(statsRaw) as FlashcardStore['wordStatsMap']);
  }

  return {
    flashcards: meta.flashcards ?? {},
    wordCandidates: meta.wordCandidates ?? {},
    wordToCardMap,
    wordStatsMap,
    knownUntracked: meta.knownUntracked ?? {},
    ignoredWords: meta.ignoredWords ?? {},
    wordKnowledge: meta.wordKnowledge ?? {},
    grammarKnowledge: meta.grammarKnowledge ?? {},
    suggestedFlashcards: meta.suggestedFlashcards ?? {},
    wordSyncSeen: meta.wordSyncSeen ?? {},
    dailyStats: meta.dailyStats ?? {},
    meta: meta.storeMeta ?? ({} as FlashcardStore['meta']),
    version: meta.storeVersion ?? 0,
  };
}

let cachedCardShards: Record<string, string[]>[] | null = null;
let cachedStatsShards: Record<string, FlashcardStore['wordStatsMap'][string]>[] | null = null;

async function saveShardedFlashcards(store: FlashcardStore): Promise<void> {
  const newCardShards = splitIntoShards(store.wordToCardMap);
  const newStatsShards = splitIntoShards(store.wordStatsMap);

  const changedCardShards = new Set<number>();
  const changedStatsShards = new Set<number>();

  for (let i = 0; i < FLASHCARD_SHARD_COUNT; i++) {
    const newCardJson = JSON.stringify(newCardShards[i]);
    const newStatsJson = JSON.stringify(newStatsShards[i]);

    if (!cachedCardShards || JSON.stringify(cachedCardShards[i]) !== newCardJson) {
      changedCardShards.add(i);
    }
    if (!cachedStatsShards || JSON.stringify(cachedStatsShards[i]) !== newStatsJson) {
      changedStatsShards.add(i);
    }
  }

  cachedCardShards = newCardShards;
  cachedStatsShards = newStatsShards;

  const shardMeta: FlashcardShardMeta = {
    version: 1,
    shardCount: FLASHCARD_SHARD_COUNT,
    lastUpdated: new Date().toISOString(),
    flashcards: store.flashcards,
    wordCandidates: store.wordCandidates,
    knownUntracked: store.knownUntracked,
    ignoredWords: store.ignoredWords,
    wordKnowledge: store.wordKnowledge,
    grammarKnowledge: store.grammarKnowledge,
    suggestedFlashcards: store.suggestedFlashcards,
    wordSyncSeen: store.wordSyncSeen,
    dailyStats: store.dailyStats,
    storeMeta: store.meta,
    storeVersion: store.version,
  };

  const writes: Promise<void>[] = [storageSet(FLASHCARD_META_KEY, JSON.stringify(shardMeta))];

  for (const i of changedCardShards) {
    writes.push(storageSet(`${FLASHCARD_CARDS_SHARD_PREFIX}${i}`, JSON.stringify(newCardShards[i])));
  }
  for (const i of changedStatsShards) {
    writes.push(storageSet(`${FLASHCARD_STATS_SHARD_PREFIX}${i}`, JSON.stringify(newStatsShards[i])));
  }

  await Promise.all(writes);
}

// ============================================================================
// Flashcard Bridge
// ============================================================================

const flashcardBridge: FlashcardBridge = {
  getFlashcards() {
    loadShardedFlashcards()
      .then(async data => {
        const migrated = await extractBase64ImagesToFiles(data);
        if (migrated) {
          saveShardedFlashcards(data)
            .catch(e => log.error('[CapacitorBridge] Failed to save migrated flashcards:', e));
        }
        emitter.emit('flashcards', data);
      })
      .catch(e => {
        log.error('[CapacitorBridge] Failed to load flashcards, using empty store:', e);
        emitter.emit('flashcards', { flashcards: {}, wordCandidates: {} });
      });
  },

  saveFlashcards(flashcards: FlashcardStore) {
    saveShardedFlashcards(flashcards)
      .catch(e => log.error('[CapacitorBridge] Failed to save flashcards:', e));
  },

  onFlashcards(callback) {
    return emitter.on('flashcards', callback as Listener);
  },

  onNewDayFlashcards(callback) {
    return emitter.on('new-day-flashcards', callback as Listener);
  },

  onFlashcardConnectOpen(callback) {
    return emitter.on('flashcard-connect-open', callback as Listener);
  },

  onReviewFlashcardRequest(callback) {
    return emitter.on('review-flashcard-request', callback as Listener);
  },

  async saveFlashcardImage(cardId: string, dataUrl: string) {
    return saveImageFile(cardId, dataUrl) ?? dataUrl;
  },

  async resolveFlashcardImage(imageUrl: string) {
    // flashcard-image:// is an Electron-only custom protocol — not resolvable on mobile
    if (imageUrl.startsWith('flashcard-image://')) return null;
    return imageUrl;
  },

  async deleteFlashcardImage(cardId: string) {
    await deleteImageFile(cardId);
  },

  async saveFlashcardVideo(cardId: string, data: ArrayBuffer) {
    return saveVideoFile(cardId, data);
  },

  async deleteFlashcardVideo(cardId: string) {
    await deleteVideoFile(cardId);
  },

  async getFlashcardTts() {
    return null;
  },

  async generateFlashcardTts(_cardId: string, _text: string, _language: string, _field: 'word' | 'example', _provider: string, _voiceSampleId?: string, _cloudAuthToken?: string, _cloudApiUrl?: string) {
    return null;
  },

  async batchGenerateFlashcardTts(_items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>, _language: string, _provider: string, _voiceSampleId?: string, _cloudAuthToken?: string, _cloudApiUrl?: string): Promise<Record<string, string>> {
    return {};
  },

  async getFlashcardTtsMeta() {
    return null;
  },

  async deleteFlashcardTts(_cardId: string) {
    return undefined;
  },
};

const pluginBridge: PluginBridge = {
  async getPluginValue(): Promise<PluginBusEnvelope> {
    return { hasValue: false, value: null };
  },
  async setPluginValue(_channel: string, _value: PluginBusJSONValue) {
    return undefined;
  },
  async emitPluginEvent(_channel: string, _payload: PluginBusJSONValue) {
    return undefined;
  },
  onPluginValue: noopCleanup,
  onPluginEvent: noopCleanup,
  async pluginGetList() {
    return [];
  },
  async pluginEnable() {
    return null;
  },
  async pluginDisable() {
    return null;
  },
  async pluginGrantPermissions() {
    return null;
  },
  async pluginInstallFromPath() {
    return { success: false, error: 'Plugins are not supported on mobile' };
  },
  async pluginSelectAndInstall() {
    return { success: false, error: 'Plugins are not supported on mobile' };
  },
  async pluginUninstall() {
    return false;
  },
  async pluginKVGet() {
    return { value: null };
  },
  async pluginKVSet() {
    return undefined;
  },
  async pluginKVRemove() {
    return undefined;
  },
  async pluginOpenWindow() {
    return false;
  },
  onPluginList: noopCleanup,
  onPluginStatusUpdate: noopCleanup,
  onPluginInstallResult: noopCleanup,
};

// ============================================================================
// Localization Bridge
// ============================================================================

const localizationBridge: LocalizationBridge = {
  getLocalization() {
    const lang = localStorage.getItem('mlearn-ui-language') || 'en';

    // Load bundled locale data (always works offline)
    const loadBundled = async () => {
      try {
        const strings = await loadBundledLocaleStrings(lang) ?? await loadBundledLocaleStrings('en') ?? {};
        const locale = Object.keys(strings).length > 0 ? lang : 'en';
        emitter.emit('localization', { locale, strings });
      } catch (e) {
        log.error("error", e);
        emitter.emit('localization', { locale: 'en', strings: {} });
      }
    };

    // Check if a tethered/cloud server URL has been explicitly configured
    const serverUrl = localStorage.getItem('mlearn-node-server-url');
    if (!serverUrl) {
      // No server configured — load bundled directly (default on mobile)
      loadBundled();
      return;
    }

    // Try Node server with a short timeout; fall back to bundled
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    fetch(`${serverUrl}/api/localization/${lang}`, { signal: controller.signal })
      .then(res => { clearTimeout(timeout); return res.json(); })
      .then(data => emitter.emit('localization', data))
      .catch(() => { clearTimeout(timeout); loadBundled(); });
  },

  onLocalization(callback) {
    return emitter.on('localization', callback as Listener);
  },

  changeUILanguage(langCode: string) {
    localStorage.setItem('mlearn-ui-language', langCode);
    localizationBridge.getLocalization();
  },

  getLangData() {
    // Load bundled language data (always works offline)
    const loadBundled = async () => {
      try {
        const langData = await loadBundledLanguageData();
        emitter.emit('lang-data', langData as unknown as LanguageData);
      } catch (e) {
        log.error("error", e);
        emitter.emit('lang-data', {} as LanguageData);
      }
    };

    // Check if a tethered/cloud server URL has been explicitly configured
    const serverUrl = localStorage.getItem('mlearn-node-server-url');
    if (!serverUrl) {
      // No server configured — load bundled directly (default on mobile)
      loadBundled();
      return;
    }

    // Try Node server with a short timeout; fall back to bundled
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    fetch(`${serverUrl}/api/lang-data`, { signal: controller.signal })
      .then(res => { clearTimeout(timeout); return res.json(); })
      .then(data => emitter.emit('lang-data', data))
      .catch(() => { clearTimeout(timeout); loadBundled(); });
  },

  onLangData(callback) {
    return emitter.on('lang-data', callback as Listener);
  },

  installLanguage(_url: string) {
    // Language installation not supported on mobile
    emitter.emit('lang-install-error', 'Language installation is not supported on mobile');
  },

  onLanguageInstalled(callback) {
    return emitter.on('lang-installed', callback as Listener);
  },

  onLanguageInstallError(callback) {
    return emitter.on('lang-install-error', callback as Listener);
  },
};

// ============================================================================
// File Bridge
// ============================================================================

const fileBridge: FileBridge = {
  async readDirectoryImages(_directoryPath: string) {
    // On mobile, use Capacitor Filesystem
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const result = await Filesystem.readdir({ path: _directoryPath, directory: Directory.Documents });
      const imageFiles = result.files.filter(f =>
        /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f.name)
      );
      const files = await Promise.all(
        imageFiles.map(async (f) => {
          const content = await Filesystem.readFile({ path: `${_directoryPath}/${f.name}`, directory: Directory.Documents });
          const binary = atob(content.data as string);
          const buffer = new ArrayBuffer(binary.length);
          const view = new Uint8Array(buffer);
          for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
          return { name: f.name, path: `${_directoryPath}/${f.name}`, data: buffer };
        })
      );
      return { files };
    } catch (e) {
      log.error("error", e);
      return { files: [] };
    }
  },

  async readPdfFile(_filePath: string) {
    return { data: new ArrayBuffer(0) };
  },

  async readMediaFile(_filePath: string) {
    return null;
  },

  async readMediaFileChunk(_filePath: string, _offset: number, _length: number) {
    return null;
  },

  async getFileSize(_filePath: string) {
    return null;
  },

  async selectVideoFile() {
    // Use HTML file input for video selection
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) {
          resolve(URL.createObjectURL(file));
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  },

  async selectSubtitleFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.srt,.vtt,.ass,.ssa';
      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? URL.createObjectURL(file) : null);
      };
      input.click();
    });
  },

  async selectBookFolder() {
    // Folder selection not natively supported — use file input with webkitdirectory
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
      input.onchange = () => {
        const files = input.files;
        if (files && files.length > 0) {
          // Return the common parent path
          const path = (files[0] as File & { webkitRelativePath: string }).webkitRelativePath;
          resolve(path.split('/')[0] || null);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  },

  async selectPdfFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf';
      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? URL.createObjectURL(file) : null);
      };
      input.click();
    });
  },

  async selectBrowserFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? URL.createObjectURL(file) : null);
      };
      input.click();
    });
  },

  async getLocalMediaUrl(filePath: string) {
    // On mobile, blob URLs are the media URLs
    return filePath;
  },

  getPathForFile(_file: File) {
    // File.path not available on web/mobile — return name
    return _file.name;
  },

  writeToClipboard(text: string) {
    import('@capacitor/clipboard')
      .then(({ Clipboard }) => Clipboard.write({ string: text }))
      .catch(() => navigator.clipboard?.writeText(text));
  },
};

// ============================================================================
// Window Bridge (mostly no-ops on mobile)
// ============================================================================

/** Registered callbacks for window context delivery on Capacitor */
const windowContextCallbacks = new Set<(context: Record<string, unknown> | null) => void>();

const windowBridge: WindowBridge = {
  changeTrafficLights: noop,
  resizeWindow: noop,
  makePiP: noop,
  unPiP: noop,

  showCtxMenu(options) {
    // Dispatch a custom event so the mobile UI can show a bottom-sheet menu
    window.dispatchEvent(new CustomEvent('mlearn-ctx-menu', { detail: { type: 'video', options } }));
  },
  showReaderCtxMenu(options) {
    window.dispatchEvent(new CustomEvent('mlearn-ctx-menu', { detail: { type: 'reader', options } }));
  },
  showContact: noop,
  openExternalUrl: async (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  },

  openWindow(payload) {
    // On mobile, navigate via router instead of opening windows
    const routeMap: Record<string, string> = {
      settings: '/settings',
      flashcards: '/flashcards',
      statistics: '/statistics',
      'conversation-agent': '/conversation-agent',
      'word-db-editor': '/word-db-editor',
      'kanji-grid': '/kanji-grid',
      licenses: '/licenses',
      'connect-qr': '/connect-qr',
    };

    // Store context in sessionStorage so the target route can retrieve it
    if (payload.context) {
      try {
        sessionStorage.setItem(`mlearn_window_ctx_${payload.type}`, JSON.stringify(payload.context));
      } catch (e) {
        log.error('[CapacitorBridge] Failed to store window context:', e);
      }
    }

    const route = routeMap[payload.type];
    if (route) {
      window.location.hash = `#${route}`;
    }
  },

  closeWindow() {
    // Navigate back on mobile
    window.history.back();
  },

  getWindowContext(windowType: string) {
    // Read context stored by openWindow and emit to registered callbacks
    try {
      const key = `mlearn_window_ctx_${windowType}`;
      const raw = sessionStorage.getItem(key);
      if (raw) {
        sessionStorage.removeItem(key);
        const ctx = JSON.parse(raw) as Record<string, unknown>;
        // Emit asynchronously so listeners registered after getWindowContext are called
        queueMicrotask(() => {
          windowContextCallbacks.forEach(cb => cb(ctx));
        });
        return;
      }
    } catch (e) {
      log.error('[CapacitorBridge] Failed to read window context:', e);
    }
    queueMicrotask(() => {
      windowContextCallbacks.forEach(cb => cb(null));
    });
  },

  onWindowContext(callback: (context: Record<string, unknown> | null) => void) {
    windowContextCallbacks.add(callback);
    return () => { windowContextCallbacks.delete(callback); };
  },
  onOpenSettings: noopCleanup,
  onOpenAside: noopCleanup,
  onContextMenuCommand: (callback: (command: string) => void) => {
    const handler = (e: Event) => callback((e as CustomEvent).detail);
    window.addEventListener('mlearn-ctx-command', handler);
    return () => window.removeEventListener('mlearn-ctx-command', handler);
  },
  onReaderContextMenuCommand: (callback: (command: string) => void) => {
    const handler = (e: Event) => callback((e as CustomEvent).detail);
    window.addEventListener('mlearn-reader-ctx-command', handler);
    return () => window.removeEventListener('mlearn-reader-ctx-command', handler);
  },
  onOpenWordDbEditor: noopCleanup,
  onOpenKanjiGrid: noopCleanup,
  onOpenPrompt: noopCleanup,
  onAuthDeepLink: noopCleanup,
  onLookupDeepLink: noopCleanup,
  promptOutput: noop,
};

// ============================================================================
// Server Bridge
// ============================================================================

const serverBridge: ServerBridge = {
  isLoaded() {
    // On mobile, ping the backend to check if it's loaded
    fetch(`${getBackendUrl()}/control`)
      .then(res => {
        if (res.ok) emitter.emit('server-load', 'loaded');
      })
      .catch(() => {
        // Backend not available — emit status
        emitter.emit('server-status-update', 'Backend not reachable');
      });
  },

  isSuccess() {
    // Check Python backend health
    fetch(`${getBackendUrl()}/control`)
      .then(res => {
        emitter.emit('python-success', res.ok);
      })
      .catch(() => emitter.emit('python-success', false));
  },

  onServerLoad(callback) {
    return emitter.on('server-load', callback as Listener);
  },

  onServerStatusUpdate(callback) {
    return emitter.on('server-status-update', callback as Listener);
  },

  onServerCriticalError(callback) {
    return emitter.on('server-critical-error', callback as Listener);
  },

  onAnkiConnectionError(callback) {
    return emitter.on('anki-connection-error', callback as Listener);
  },

  restartBackendAnkiOverride() {
    // No-op on Capacitor — Anki is only available on desktop
  },

  onOcrStatusUpdate(callback) {
    return emitter.on('ocr-status-update', callback as Listener);
  },

  sendLogRecord() {
    /* logs surface via console on capacitor; no IPC sink available */
  },

  restartApp() {
    window.location.reload();
  },

  forceRestartApp() {
    window.location.reload();
  },

  restartBackend() {
    window.location.reload();
  },

  getVersion() {
    import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then(info => emitter.emit('version', info.version))
      .catch(() => emitter.emit('version', '0.0.0'));
  },

  onVersionReceive(callback) {
    return emitter.on('version', callback as Listener);
  },
};

// ============================================================================
// Installer Bridge (no-ops on mobile — no Python install)
// ============================================================================

const installerBridge: InstallerBridge = {
  startInstall: noop,
  cancelInstall: noop,
  requestInstallerState: noop,
  onPythonSuccess: noopCleanup,
  onInstallStarted: noopCleanup,
  onInstallerAwaitingChoice: noopCleanup,
  onInstallerNetworkError: noopCleanup,
  onInstallerState: noopCleanup,
  onPipProgress: noopCleanup,
};

// ============================================================================
// LLM Bridge
// ============================================================================

/** Active LLM stream abort controller — allows cancellation of in-flight requests */
let llmAbortController: AbortController | null = null;

/** Active Ollama stream abort controller — allows cancellation of in-flight Ollama requests */
let ollamaAbortController: AbortController | null = null;

const llmBridge: LLMBridge = {
  llmStream(messages, tools) {
    // Abort any previous stream
    llmAbortController?.abort();
    llmAbortController = new AbortController();
    const { signal } = llmAbortController;

    // On mobile, stream via HTTP to tethered desktop or cloud endpoint
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    const cloudToken = settings.cloudAuthAccessToken || settings.cloudAuthToken;
    const nodeUrl = getNodeServerUrl();

    // Resolve cloud API URL: use override if set, otherwise default
    const overrideCloudEndpoint = settings.overrideCloudEndpointUrl && settings.cloudApiUrl;
    const cloudApiUrl = overrideCloudEndpoint
      ? settings.cloudApiUrl.replace(/\/+$/, '')
      : 'https://mlearn-cloud.kikan.net';
    const isCloudMode = settings.llmProvider === 'cloud';

    const url = isCloudMode
      ? `${cloudApiUrl}/api/llm/stream`
      : `${nodeUrl}/forward/llm/stream`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cloudToken) headers['Authorization'] = `Bearer ${cloudToken}`;

    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, tools }),
      signal,
    })
      .then(async res => {
        const reader = res.body?.getReader();
        if (!reader) {
          emitter.emit('llm-stream-chunk', { done: true, error: 'No stream body' });
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const chunk = JSON.parse(line.slice(6));
                emitter.emit('llm-stream-chunk', chunk);
              } catch (e) {
                log.error("error", e);
              }
            }
          }
        }
        emitter.emit('llm-stream-chunk', { done: true });
      })
      .catch(err => {
        if (signal.aborted) return;
        emitter.emit('llm-stream-chunk', { done: true, error: String(err) });
      });
  },

  llmStreamAbort() {
    llmAbortController?.abort();
    llmAbortController = null;
    emitter.emit('llm-stream-chunk', { done: true });
  },

  onLLMStreamChunk(callback) {
    return emitter.on('llm-stream-chunk', callback as Listener);
  },

  async llmCheckModel(): Promise<LLMModelStatus> {
    return { downloaded: false, downloading: false, progress: 0, downloadedBytes: 0, expectedBytes: 0, loaded: false };
  },

  llmDownloadModel: noop,
  onLLMDownloadProgress: noopCleanup,
  onLLMModelStatus: noopCleanup,
  llmUnloadModel: noop,

  // Ollama — proxy through Node server
  ollamaChat: noop,

  ollamaChatStream(messages, tools) {
    ollamaAbortController?.abort();
    ollamaAbortController = new AbortController();
    const { signal } = ollamaAbortController;

    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    const ollamaUrl = settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;

    fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ollamaModel || 'qwen3.5:9b',
        messages,
        tools,
        stream: true,
      }),
      signal,
    })
      .then(async res => {
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line);
                emitter.emit('ollama-chat-stream', {
                  content: data.message?.content,
                  done: data.done,
                  tool_calls: data.message?.tool_calls,
                  eval_count: data.eval_count,
                  eval_duration: data.eval_duration,
                  prompt_eval_duration: data.prompt_eval_duration,
                  total_duration: data.total_duration,
                });
              } catch (e) {
                log.error("error", e);
              }
            }
          }
        }
      })
      .catch(err => {
        if (signal.aborted) return;
        emitter.emit('ollama-chat-stream', { done: true, error: String(err) });
      });
  },

  ollamaChatStreamAbort() {
    ollamaAbortController?.abort();
    ollamaAbortController = null;
  },

  onOllamaChatStream(callback) {
    return emitter.on('ollama-chat-stream', callback as Listener);
  },

  async ollamaListModels(): Promise<unknown[]> {
    try {
      const settings = JSON.parse(localStorage.getItem('settings') || '{}');
      const res = await fetch(`${settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl}/api/tags`);
      const data = await res.json();
      return data.models || [];
    } catch (e) {
      log.error("error", e);
      return [];
    }
  },

  async ollamaCheck(): Promise<boolean> {
    try {
      const settings = JSON.parse(localStorage.getItem('settings') || '{}');
      const res = await fetch(`${settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl}/api/tags`);
      return res.ok;
    } catch (e) {
      log.error("error", e);
      return false;
    }
  },

  ollamaPullModel: noop,
  onOllamaPullModelProgress: noopCleanup,
};

// ============================================================================
// Speech Bridge (Web Speech API fallbacks)
// ============================================================================

const speechBridge: SpeechBridge = {
  sttStart(language: string) {
    try {
      const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition
        || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      const recognition = new (SpeechRecognition as new () => Record<string, unknown>)() as {
        lang: string; continuous: boolean; interimResults: boolean;
        onresult: (event: Event) => void; onerror: (event: Event) => void; onend: () => void; onnomatch: () => void;
        start: () => void; stop: () => void;
      };
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: Event) => {
        const e = event as unknown as { results: { isFinal: boolean; 0: { transcript: string } }[] };
        const result = e.results[e.results.length - 1];
        emitter.emit('stt-result', {
          transcript: result[0].transcript,
          isFinal: result.isFinal,
        });
      };

      recognition.onerror = (event: Event) => {
        const e = event as unknown as { error: string; message: string };
        log.error('[CapacitorBridge] SpeechRecognition error:', e.error, e.message);
        emitter.emit('stt-result', { transcript: '', isFinal: true, error: e.error });
      };

      recognition.onnomatch = () => {
        emitter.emit('stt-result', { transcript: '', isFinal: true });
      };

      recognition.onend = () => {
        (window as unknown as Record<string, unknown>).__mlearnSpeechRecognition = undefined;
      };

      recognition.start();
      (window as unknown as Record<string, unknown>).__mlearnSpeechRecognition = recognition;
    } catch (e) {
      log.error("error", e);
    }
  },

  sttStop() {
    const recognition = (window as unknown as Record<string, unknown>).__mlearnSpeechRecognition as { stop: () => void } | undefined;
    recognition?.stop();
  },

  onSttResult(callback) {
    return emitter.on('stt-result', callback as Listener);
  },

  ttsSpeak(text: string, language: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.onend = () => emitter.emit('tts-status', { speaking: false, progress: 1 });
    utterance.onerror = (event) => {
      log.error('[CapacitorBridge] SpeechSynthesis error:', event);
      emitter.emit('tts-status', { speaking: false, progress: 0, error: String(event) });
    };
    emitter.emit('tts-status', { speaking: true, progress: 0 });
    speechSynthesis.speak(utterance);
  },

  ttsStop() {
    speechSynthesis.cancel();
    emitter.emit('tts-status', { speaking: false, progress: 0 });
  },

  onTtsStatus(callback) {
    return emitter.on('tts-status', callback as Listener);
  },
};

// ============================================================================
// Voice Bridge (limited on mobile — Web Speech API fallbacks)
// ============================================================================

const voiceBridge: VoiceBridge = {
  async voiceCheckModels(): Promise<VoiceModelStatus> {
    return {
      sttDownloaded: false,
      ttsDownloaded: false,
      vadDownloaded: false,
      downloading: false,
      progress: 0,
      statusMessage: 'Voice models not available on mobile — using Web Speech API',
    };
  },
  voiceDownloadModels: noop,
  onVoiceModelProgress: noopCleanup,
  voiceStartSession: noop,
  voiceStopSession: noop,
  voiceSendAudioChunk: noop,
  voiceFlush: noop,
  voiceUpdateSilenceThreshold: noop,
  onVoiceSttResult: noopCleanup,
  onVoiceVadEvent: noopCleanup,
  voiceTtsGenerate: noop,
  voiceTtsStop: noop,
  onVoiceTtsAudio: noopCleanup,
  onVoiceTtsStatus: noopCleanup,
  onVoiceSessionReady: noopCleanup,
  onVoiceSessionError: noopCleanup,
  async voiceSampleList(): Promise<VoiceSample[]> { return []; },
  async voiceSampleUpload(): Promise<VoiceSample> { throw new Error('Not supported on mobile'); },
  async voiceSampleDelete(): Promise<boolean> { return false; },
  async voiceSampleRename(): Promise<boolean> { return false; },
  async voiceSampleTranscribe(): Promise<{ text: string; language: string }> { throw new Error('Not supported on mobile'); },
  async voiceSampleGetPath(): Promise<string | null> { return null; },
};

// ============================================================================
// Media Stats Bridge
// ============================================================================

const mediaStatsBridge: MediaStatsBridge = {
  saveMediaStats(mediaHash: string, stats: MediaStats) {
    storageGet('mediaStats').then(raw => {
      const all: Record<string, MediaStats> = raw ? JSON.parse(raw) : {};
      all[mediaHash] = stats;
      storageSet('mediaStats', JSON.stringify(all));
    });
  },

  getMediaStats(mediaHash: string) {
    storageGet('mediaStats').then(raw => {
      const all: Record<string, MediaStats> = raw ? JSON.parse(raw) : {};
      emitter.emit('media-stats', all[mediaHash] || null);
    });
  },

  onMediaStats(callback) {
    return emitter.on('media-stats', callback as Listener);
  },

  listMediaStats() {
    storageGet('mediaStats').then(raw => {
      const all: Record<string, MediaStats> = raw ? JSON.parse(raw) : {};
      emitter.emit('media-stats-list', Object.values(all));
    });
  },

  onMediaStatsList(callback) {
    return emitter.on('media-stats-list', callback as Listener);
  },
};

// ============================================================================
// Watch Together Bridge
// ============================================================================

const watchTogetherBridge: WatchTogetherBridge = {
  isWatchingTogether: noop,
  watchTogetherSend(message) {
    // Send via WebSocket to desktop Node server
    const ws = (window as unknown as Record<string, unknown>).__mlearnWatchWS as WebSocket | undefined;
    ws?.send(JSON.stringify(message));
  },
  onWatchTogetherLaunch: noopCleanup,
  onWatchTogetherRequest: noopCleanup,
};

// ============================================================================
// Overlay Bridge (not supported on mobile)
// ============================================================================

const overlayBridge: OverlayBridge = {
  sendOverlayVideoState: noop,
  onOverlayVideoState: noopCleanup,
  requestOverlaySync: noop,
  onOverlayRequestSync: noopCleanup,
  launchOverlay: noop,
  onOverlayLaunch: noopCleanup,
  onOverlayGeometry: noopCleanup,
  setOverlayIgnoreMouseEvents: noop,
  sendOverlayCommand: noop,
  sendOverlaySubtitleTracks: noop,
  onOverlaySubtitleTracks: noopCleanup,
  overlayMoveBy: async () => {},
  overlayResizeBy: async () => {},
  overlayGetBounds: async () => null,
  overlaySetAutoPosition: async () => {},
  overlaySetGeometryLocked: noop,
  onOverlayAutoPositionChanged: noopCleanup,
  sendOverlayTextModeLookup: noop,
  onOverlayTextModeLookup: noopCleanup,
  onOverlayTextModeConnected: noopCleanup,
  overlaySaveSiteState: noop,
  overlayLoadSiteState: async () => null,
  overlayClearSiteState: noop,
  overlaySetBounds: async () => {},
  onOverlayActiveUrlChanged: noopCleanup,
};

// ============================================================================
// Cross-Window Bridge (no-ops on single-window mobile)
// ============================================================================

const crossWindowBridge: CrossWindowBridge = {
  onUpdatePills: noopCleanup,
  onUpdateWordAppearance: noopCleanup,
  onUpdateAttemptFlashcardCreation: noopCleanup,
  onUpdateCreateFlashcard: noopCleanup,
  onUpdateLastWatched: noopCleanup,
};

// ============================================================================
// License Bridge
// ============================================================================

const licenseBridge: LicenseBridge = {
  getLicenseType() {
    const type = localStorage.getItem('mlearn-license') || 'free';
    emitter.emit('license-get', type);
  },
  activateLicense(key: string) {
    // Stub — license validation would go through an API
    localStorage.setItem('mlearn-license', key ? 'pro' : 'free');
    emitter.emit('license-activated', true);
  },
  removeLicense() {
    localStorage.removeItem('mlearn-license');
  },
  onLicenseGet(callback) {
    return emitter.on('license-get', callback as Listener);
  },
  onLicenseActivated(callback) {
    return emitter.on('license-activated', callback as Listener);
  },
};

// ============================================================================
// Migration Bridge (no-ops on mobile)
// ============================================================================

const migrationBridge: MigrationBridge = {
  async getMigratedLocalStorage() { return null; },
  async getMigratedItem() { return null; },
  async hasMigrationOccurred() { return false; },
  async triggerMigration() { return { success: true, migratedKeys: [] }; },
  onLocalStorageMigrationComplete: noopCleanup,
  onFlashcardMigrationComplete: noopCleanup,
  getFlashcardMigrationInfo: noop,
};

// ============================================================================
// Generic IPC Bridge
// ============================================================================

const genericBridge: GenericIPCBridge = {
  sendLS: noop,

  async fetchUrl(url: string) {
    try {
      const res = await fetch(url);
      const content = await res.text();
      return { content };
    } catch (err) {
      log.error("error", err);
      return { content: '', error: String(err) };
    }
  },
};

// ============================================================================
// Data Export/Import Bridge (JSON-based on mobile)
// ============================================================================

const browserBridge: BrowserBridge = {
  async detectBrowsers() {
    return [];
  },
  async installExtension() {
    return { success: false, error: 'Browser extensions are not supported on mobile' };
  },
  async uninstallExtension() {
    return { success: false, error: 'Browser extensions are not supported on mobile' };
  },
  async isExtensionInstalled() {
    return { installed: false };
  },
  async openExtensionFolder() {
    return false;
  },
};

const diagnosticsBridge: DiagnosticsBridge = {
  runDiagnostics: async () => ({ timestamp: new Date().toISOString(), appVersion: '0.0.0', platform: 'capacitor', suites: [], summary: { passed: 0, failed: 0, skipped: 0, total: 0, durationMs: 0 } }),
  onDiagnosticsProgress: () => () => {},
  onDiagnosticsComplete: () => () => {},
  saveDiagnosticsReport: async () => '',
};

const dataBridge: DataBridge = {
  async dataExport() {
    try {
      const [settingsRaw, flashcardStore, mediaStatsRaw] = await Promise.all([
        storageGet('settings'),
        loadShardedFlashcards(),
        storageGet('mediaStats'),
      ]);

      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        platform: 'mobile',
        settings: settingsRaw ? JSON.parse(settingsRaw) : null,
        flashcards: flashcardStore,
        mediaStats: mediaStatsRaw ? JSON.parse(mediaStatsRaw) : null,
      };

      const json = JSON.stringify(exportData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `mlearn-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return { success: true };
    } catch (e) {
      log.error("error", e);
      return { success: false, error: String(e) };
    }
  },

  async dataImport() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve({ success: false }); return; }

        try {
          const text = await file.text();
          const data = JSON.parse(text);

          if (typeof data !== 'object' || data === null) {
            resolve({ success: false, error: 'Invalid backup file format' });
            return;
          }

          if (!data.settings && !data.flashcards) {
            resolve({ success: false, error: 'Backup must contain settings or flashcards' });
            return;
          }

          if (data.settings && typeof data.settings === 'object') {
            await storageSet('settings', JSON.stringify(data.settings));
          }
          if (data.flashcards && typeof data.flashcards === 'object') {
            await saveShardedFlashcards(data.flashcards as FlashcardStore);
          }
          if (data.mediaStats && typeof data.mediaStats === 'object') {
            await storageSet('mediaStats', JSON.stringify(data.mediaStats));
          }

          resolve({ success: true });
        } catch (e) {
          log.error("error", e);
          resolve({ success: false, error: String(e) });
        }
      };
      input.addEventListener('cancel', () => resolve({ success: false }));
      input.click();
    });
  },
};

// ============================================================================
// KV Store Bridge (delegates to storageGet/storageSet helpers)
// ============================================================================

const kvStoreBridge: KVStoreBridge = {
  kvGet: (key) => storageGet(key),
  kvSet: (key, value) => storageSet(key, value),
  kvRemove: async (key) => {
    localStorage.removeItem(key);
    try {
      const mod = await getPreferencesModule();
      if (mod) await mod.Preferences.remove({ key });
    } catch (e) {
      log.error("error", e);
    }
  },
  kvGetAll: async () => {
    const result: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) result[key] = localStorage.getItem(key) ?? '';
    }
    return result;
  },
  kvSetBatch: async (entries) => {
    for (const [key, value] of Object.entries(entries)) {
      await storageSet(key, value);
    }
  },
};

// ============================================================================
// Factory
// ============================================================================

export function createCapacitorBridge(): PlatformBridge {
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
    diagnostics: diagnosticsBridge,
  };
}
