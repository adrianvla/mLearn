/**
 * Bridge Factory
 *
 * Returns a singleton PlatformBridge based on detected platform.
 * - Electron → pass-through to window.mLearnIPC
 * - Capacitor → native plugin adapters
 * - Web → HTTP/tethered fallbacks
 */

import type { PlatformBridge } from './types';
import { getPlatform } from '../platform';
import { createElectronBridge } from './electronBridge';
import { createCapacitorBridge } from './capacitorBridge';

let bridge: PlatformBridge | null = null;

/**
 * Get the singleton PlatformBridge instance.
 * Initializes on first call based on detected platform.
 */
export function getBridge(): PlatformBridge {
  if (bridge) return bridge;

  const platform = getPlatform();

  switch (platform) {
    case 'electron': {
      bridge = createElectronBridge();
      break;
    }
    case 'capacitor':
    case 'web': {
      bridge = createCapacitorBridge();
      break;
    }
  }

  return bridge;
}

export type { PlatformBridge } from './types';
export type {
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
