import { createRuntimeTraceStore } from './runtimeTraceStore';
import { loadSettings } from './settings';
import { getUserDataPath } from '../utils/platform';
import { DEFAULT_SETTINGS, type Settings, type LLMStreamChunk } from '../../shared/types';
import { subscribeSettingsCommitted } from './settingsChanges';
const store = createRuntimeTraceStore();
function configure(settings: Settings, profile: string): void {
  store.configure(settings.devMode ?? DEFAULT_SETTINGS.devMode, profile,
    [settings.cloudAuthAccessToken, settings.cloudAuthToken, settings.compatibleApiKey]
      .filter((value): value is string => Boolean(value)));
}
subscribeSettingsCommitted(configure);
/** Synchronize at observation/read boundaries; no capture is written to disk. */
export function runtimeTrace() {
  const settings = loadSettings();
  configure(settings, getUserDataPath());
  return store;
}
export function clearRuntimeCapture(): void { store.clear(); }
export function subscribeRuntimeCapture(listener: () => void): () => void { return store.subscribe(listener); }

/** Hot streaming path must never reload settings or language assets. */
export function recordRuntimeChunk(id: string | undefined, chunk: LLMStreamChunk): void { store.chunk(id, chunk); }
export function finishRuntimeTrace(id: string | undefined, status: 'completed' | 'failed' | 'cancelled', error?: string): void { store.finish(id, status, error ? { error } : undefined); }
