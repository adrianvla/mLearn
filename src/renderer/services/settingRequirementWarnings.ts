import { getBridge } from '../../shared/bridges';
import {
  evaluateSettingRequirementWarnings,
  getActiveSettingRequirementWarningConfigs,
  type EvaluatedSettingRequirementWarning,
  type SettingRequirementRoute,
} from '../../shared/settingRequirements';
import type { Settings, SystemMemoryInfo } from '../../shared/types';
import { getLogger } from '../../shared/utils/logger';

const STORAGE_PREFIX = 'mlearn:setting-requirement-warning';
const BYTES_PER_GIB = 1024 ** 3;
const log = getLogger('renderer.services.settingRequirementWarnings');

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

export function getSettingRequirementWarningStorageKey(route: SettingRequirementRoute, warningId: string): string {
  return `${STORAGE_PREFIX}:${route}:${warningId}`;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch (error) {
    log.warn('Session storage unavailable for setting requirement warnings:', error);
    return null;
  }
}

export function hasSeenSettingRequirementWarning(route: SettingRequirementRoute, warningId: string): boolean {
  const storage = getSessionStorage();
  return storage?.getItem(getSettingRequirementWarningStorageKey(route, warningId)) === '1';
}

export function markSettingRequirementWarningSeen(route: SettingRequirementRoute, warningId: string): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(getSettingRequirementWarningStorageKey(route, warningId), '1');
  } catch (error) {
    log.warn('Failed to store setting requirement warning state:', error);
  }
}

async function getSystemMemoryInfo(): Promise<SystemMemoryInfo | null> {
  const readSystemMemory = getBridge().llm.llmGetSystemMemory;
  if (readSystemMemory) {
    try {
      return await readSystemMemory();
    } catch (error) {
      log.warn('Failed to read system memory for setting requirement warnings:', error);
    }
  }

  if (typeof navigator === 'undefined') {
    return null;
  }

  const deviceMemoryGb = (navigator as NavigatorWithDeviceMemory).deviceMemory;
  if (typeof deviceMemoryGb === 'number' && Number.isFinite(deviceMemoryGb) && deviceMemoryGb > 0) {
    return {
      hasDiscreteGpu: false,
      dedicatedVramBytes: 0,
      totalRamBytes: deviceMemoryGb * BYTES_PER_GIB,
    };
  }

  return null;
}

export async function getUnseenSettingRequirementWarnings(
  settings: Settings,
  route: SettingRequirementRoute
): Promise<EvaluatedSettingRequirementWarning[]> {
  const activeConfigs = getActiveSettingRequirementWarningConfigs(settings, route)
    .filter((config) => !hasSeenSettingRequirementWarning(route, config.id));
  if (activeConfigs.length === 0) {
    return [];
  }

  const memoryInfo = await getSystemMemoryInfo();
  if (!memoryInfo) {
    return [];
  }

  return evaluateSettingRequirementWarnings(settings, route, memoryInfo)
    .filter((warning) => !hasSeenSettingRequirementWarning(route, warning.config.id));
}
