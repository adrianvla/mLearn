import { DEFAULT_SETTINGS, type Settings, type SystemMemoryInfo } from './types';

const BYTES_PER_GIB = 1024 ** 3;

export type SettingRequirementRoute = 'reader';

export type SettingRequirementCondition = {
  kind: 'settingEquals';
  settingKey: keyof Settings;
  value: unknown;
};

export type SoftHostRequirement = {
  kind: 'maxTotalRamGb';
  value: number;
};

export interface SettingRequirementWarningConfig {
  id: string;
  route: SettingRequirementRoute;
  conditions: readonly SettingRequirementCondition[];
  softRequirement: SoftHostRequirement;
  titleKey: string;
  messageKey: string;
}

export interface EvaluatedSettingRequirementWarning {
  config: SettingRequirementWarningConfig;
  totalRamGb: number;
}

export const SETTING_REQUIREMENT_WARNINGS: readonly SettingRequirementWarningConfig[] = [
] as const;

export function getTotalRamGb(memoryInfo: SystemMemoryInfo): number {
  return memoryInfo.totalRamBytes / BYTES_PER_GIB;
}

function getSettingValue(settings: Settings, settingKey: keyof Settings): unknown {
  const value = settings[settingKey];
  return value === undefined ? DEFAULT_SETTINGS[settingKey] : value;
}

function settingConditionMatches(settings: Settings, condition: SettingRequirementCondition): boolean {
  switch (condition.kind) {
    case 'settingEquals':
      return Object.is(getSettingValue(settings, condition.settingKey), condition.value);
  }
}

function softHostRequirementMatches(memoryInfo: SystemMemoryInfo, requirement: SoftHostRequirement): boolean {
  switch (requirement.kind) {
    case 'maxTotalRamGb': {
      const totalRamGb = getTotalRamGb(memoryInfo);
      return Number.isFinite(totalRamGb) && totalRamGb > 0 && totalRamGb <= requirement.value;
    }
  }
}

export function evaluateSettingRequirementWarnings(
  settings: Settings,
  route: SettingRequirementRoute,
  memoryInfo: SystemMemoryInfo
): EvaluatedSettingRequirementWarning[] {
  return getActiveSettingRequirementWarningConfigs(settings, route)
    .filter((config) => softHostRequirementMatches(memoryInfo, config.softRequirement))
    .map((config) => ({
      config,
      totalRamGb: getTotalRamGb(memoryInfo),
    }));
}

export function getActiveSettingRequirementWarningConfigs(
  settings: Settings,
  route: SettingRequirementRoute
): SettingRequirementWarningConfig[] {
  return SETTING_REQUIREMENT_WARNINGS
    .filter((config) => config.route === route)
    .filter((config) => config.conditions.every((condition) => settingConditionMatches(settings, condition)));
}

export function formatRamGb(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

export function getSettingRequirementWarningParams(
  warning: EvaluatedSettingRequirementWarning
): Record<string, string | number> {
  switch (warning.config.softRequirement.kind) {
    case 'maxTotalRamGb':
      return {
        ram: formatRamGb(warning.totalRamGb),
        limit: warning.config.softRequirement.value,
      };
  }
}
