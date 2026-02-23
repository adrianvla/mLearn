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
  CrossWindowBridge,
  LicenseBridge,
  MigrationBridge,
  GenericIPCBridge,
} from './types';
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
    console.log('[CapacitorBridge] Preferences.get failed, falling back to localStorage:', e);
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
    console.log('[CapacitorBridge] Preferences.set failed, data saved to localStorage only:', e);
  }
}

// ============================================================================
// Backend URL helper
// ============================================================================

function getBackendUrl(): string {
  // Read from stored settings or use default
  const stored = localStorage.getItem('mlearn-backend-url');
  return stored || 'http://127.0.0.1:7752';
}

function getNodeServerUrl(): string {
  const stored = localStorage.getItem('mlearn-node-server-url');
  return stored || 'http://127.0.0.1:7753';
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
        console.error('[CapacitorBridge] Failed to load settings, using defaults:', e);
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
        console.error('[CapacitorBridge] Failed to save settings:', e);
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
// Flashcard Bridge
// ============================================================================

const flashcardBridge: FlashcardBridge = {
  getFlashcards() {
    storageGet('flashcards')
      .then(raw => {
        const data = raw ? JSON.parse(raw) : { flashcards: {}, wordCandidates: {} };
        emitter.emit('flashcards', data);
      })
      .catch(e => {
        console.error('[CapacitorBridge] Failed to load flashcards, using empty store:', e);
        emitter.emit('flashcards', { flashcards: {}, wordCandidates: {} });
      });
  },

  saveFlashcards(flashcards: FlashcardStore) {
    storageSet('flashcards', JSON.stringify(flashcards))
      .catch(e => console.error('[CapacitorBridge] Failed to save flashcards:', e));
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

  async saveFlashcardImage(_cardId: string, dataUrl: string) {
    // On mobile, keep base64 inline — no file extraction
    return dataUrl;
  },

  async resolveFlashcardImage(imageUrl: string) {
    // On mobile, imageUrl is already usable (base64 or http)
    return imageUrl;
  },

  async deleteFlashcardImage() {
    // No-op on mobile - images stay inline
  },

  async getFlashcardTts() {
    return null;
  },

  async generateFlashcardTts() {
    return null;
  },

  async batchGenerateFlashcardTts() {
    return {};
  },

  async getFlashcardTtsMeta() {
    return null;
  },
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
        const mod = await import(`../../root-of-app/locales/lang.${lang}.json`);
        emitter.emit('localization', { locale: lang, strings: mod.default || mod });
      } catch {
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
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        const lang = settings.language || 'ja';
        const mod = await import(`../../root-of-app/languages/${lang}.json`);
        emitter.emit('lang-data', mod.default || mod);
      } catch {
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
    } catch {
      return { files: [] };
    }
  },

  async readPdfFile(_filePath: string) {
    // Stub — PDF reading on mobile would need a separate plugin
    return { data: new ArrayBuffer(0) };
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

  openWindow(payload) {
    // On mobile, navigate via router instead of opening windows
    const routeMap: Record<string, string> = {
      settings: '/settings',
      flashcards: '/flashcards',
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
        console.error('[CapacitorBridge] Failed to store window context:', e);
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
      console.error('[CapacitorBridge] Failed to read window context:', e);
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

  onOcrStatusUpdate(callback) {
    return emitter.on('ocr-status-update', callback as Listener);
  },

  restartApp() {
    window.location.reload();
  },

  forceRestartApp() {
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

const llmBridge: LLMBridge = {
  llmStream(messages, tools) {
    // On mobile, stream via HTTP to tethered desktop or cloud endpoint
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    const cloudUrl = settings.cloudLLMUrl;
    const cloudToken = settings.cloudLLMToken;
    const nodeUrl = getNodeServerUrl();

    const url = cloudUrl
      ? `${cloudUrl}/llm/stream`
      : `${nodeUrl}/forward/llm/stream`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cloudToken) headers['Authorization'] = `Bearer ${cloudToken}`;

    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages, tools }),
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
              } catch { /* skip malformed */ }
            }
          }
        }
        emitter.emit('llm-stream-chunk', { done: true });
      })
      .catch(err => {
        emitter.emit('llm-stream-chunk', { done: true, error: String(err) });
      });
  },

  llmStreamAbort() {
    // Abort would require an AbortController — simplified for now
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
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';

    fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ollamaModel || 'qwen3:4b',
        messages,
        tools,
        stream: true,
      }),
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
              } catch { /* skip */ }
            }
          }
        }
      })
      .catch(err => {
        emitter.emit('ollama-chat-stream', { done: true, error: String(err) });
      });
  },

  ollamaChatStreamAbort: noop,

  onOllamaChatStream(callback) {
    return emitter.on('ollama-chat-stream', callback as Listener);
  },

  async ollamaListModels(): Promise<unknown[]> {
    try {
      const settings = JSON.parse(localStorage.getItem('settings') || '{}');
      const res = await fetch(`${settings.ollamaUrl || 'http://localhost:11434'}/api/tags`);
      const data = await res.json();
      return data.models || [];
    } catch {
      return [];
    }
  },

  async ollamaCheck(): Promise<boolean> {
    try {
      const settings = JSON.parse(localStorage.getItem('settings') || '{}');
      const res = await fetch(`${settings.ollamaUrl || 'http://localhost:11434'}/api/tags`);
      return res.ok;
    } catch {
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
        onresult: (event: Event) => void; start: () => void;
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

      recognition.start();
      (window as unknown as Record<string, unknown>).__mlearnSpeechRecognition = recognition;
    } catch { /* Speech not supported */ }
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
  send(channel, data) {
    emitter.emit(channel, data);
  },

  on(channel, callback) {
    return emitter.on(channel, callback);
  },

  removeListener(channel, callback) {
    // EventEmitter doesn't expose remove by ref — use the cleanup from on()
    // This is a best-effort no-op for compatibility
    void channel;
    void callback;
  },

  sendLS: noop,

  async fetchUrl(url: string) {
    try {
      const res = await fetch(url);
      const content = await res.text();
      return { content };
    } catch (err) {
      return { content: '', error: String(err) };
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
    crossWindow: crossWindowBridge,
    license: licenseBridge,
    migration: migrationBridge,
    generic: genericBridge,
  };
}
