import policySettings from './policySettings.json';
import { DEFAULT_SETTINGS, type Settings } from './types';

// The same checked-in contract is embedded by Rust. No generated copies.
const settingRegistry = policySettings;
type SettingDescriptor = { kind: string; allowedValues?: readonly string[] };

export type PolicySettingKey = keyof typeof settingRegistry;

export interface ManagedSettingRule<K extends PolicySettingKey> {
  value: Settings[K];
  sourceGroupId: string;
  sourceGroupName: string;
  locked: true;
}

export interface FeatureRule {
  enabled: boolean;
  sourceGroupId: string;
  hard: boolean;
}

export type QuotaMetric =
  | 'requests'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'costMicros';
export type QuotaPeriod = 'daily' | 'weekly' | 'monthly' | 'term';

export interface QuotaRule {
  metric: QuotaMetric;
  limit: number;
  period: QuotaPeriod;
  sourceGroupId: string;
  hard: boolean;
}

export interface EffectiveLlmPolicy {
  enabled: boolean;
  requestsPerMinute: number;
  maxConcurrentStreams: number;
  allowedProviders: string[];
  allowedModels: string[];
  promptProfileId: string | null;
  quotas: QuotaRule[];
}

export interface EffectiveManagementPolicy {
  schemaVersion: 1;
  policyVersionId: string;
  activeGroupId: string;
  ancestry: Array<{ id: string; name: string }>;
  settings: Partial<{ [K in PolicySettingKey]: ManagedSettingRule<K> }>;
  features: Record<string, FeatureRule>;
  llm: EffectiveLlmPolicy;
  governance: {
    activityRetentionDays: number;
    conversationRetentionDays: number;
    teacherAnalyticsExport: boolean;
    teacherConversationExport: boolean;
  };
  issuedAt: string;
  expiresAt: string;
  keyId: string;
  signature: string;
}

export interface ManagementPolicyPublicKey {
  keyId: string;
  algorithm: 'Ed25519';
  publicKey: string;
}

export type PolicyValidationResult =
  | { ok: true; value: EffectiveManagementPolicy }
  | { ok: false; error: string };

export function validateEffectiveManagementPolicy(
  input: unknown,
): PolicyValidationResult {
  const error = validatePolicy(input);
  return error
    ? { ok: false, error }
    : { ok: true, value: input as EffectiveManagementPolicy };
}

function validatePolicy(input: unknown): string | null {
  if (
    !isExactRecord(input, [
      'schemaVersion',
      'policyVersionId',
      'activeGroupId',
      'ancestry',
      'settings',
      'features',
      'llm',
      'governance',
      'issuedAt',
      'expiresAt',
      'keyId',
      'signature',
    ])
  )
    return 'policy has missing or unknown fields';
  if (input.schemaVersion !== 1)
    return 'unsupported management policy schema version';
  for (const key of [
    'policyVersionId',
    'activeGroupId',
    'issuedAt',
    'expiresAt',
    'keyId',
    'signature',
  ] as const) {
    if (!isNonEmptyString(input[key]))
      return `${key} must be a non-empty string`;
  }
  if (
    !Array.isArray(input.ancestry) ||
    !input.ancestry.every(
      (entry) =>
        isExactRecord(entry, ['id', 'name']) &&
        isNonEmptyString(entry.id) &&
        isNonEmptyString(entry.name),
    )
  )
    return 'ancestry is invalid';
  if (!isRecord(input.settings)) return 'settings must be an object';
  for (const [key, rule] of Object.entries(input.settings)) {
    if (!Object.prototype.hasOwnProperty.call(settingRegistry, key))
      return `setting ${key} is not policy-addressable; upgrade to a compatible policy contract`;
    if (
      !isExactRecord(rule, [
        'value',
        'sourceGroupId',
        'sourceGroupName',
        'locked',
      ])
    )
      return `setting ${key} has an invalid rule`;
    if (
      !matchesSettingDescriptor(
        rule.value,
        settingRegistry[key as PolicySettingKey],
      )
    )
      return `setting ${key} has the wrong JSON value type`;
    if (
      !isNonEmptyString(rule.sourceGroupId) ||
      !isNonEmptyString(rule.sourceGroupName) ||
      rule.locked !== true
    )
      return `setting ${key} has invalid provenance`;
  }
  if (!isRecord(input.features)) return 'features must be an object';
  for (const [key, rule] of Object.entries(input.features)) {
    if (
      !isSafeIdentifier(key) ||
      !isExactRecord(rule, ['enabled', 'sourceGroupId', 'hard']) ||
      typeof rule.enabled !== 'boolean' ||
      !isNonEmptyString(rule.sourceGroupId) ||
      typeof rule.hard !== 'boolean'
    )
      return `feature ${key} is invalid`;
  }
  const llmError = validateLlmPolicy(input.llm);
  if (llmError) return llmError;
  if (!isExactRecord(input.governance,['activityRetentionDays','conversationRetentionDays','teacherAnalyticsExport','teacherConversationExport'])) return 'governance policy is invalid';
  if (!isRetentionDays(input.governance.activityRetentionDays) || !isRetentionDays(input.governance.conversationRetentionDays) || typeof input.governance.teacherAnalyticsExport !== 'boolean' || typeof input.governance.teacherConversationExport !== 'boolean') return 'governance policy is invalid';
  return null;
}

function isRetentionDays(value:unknown):value is number{return Number.isInteger(value)&&typeof value==='number'&&value>=1&&value<=90;}

function validateLlmPolicy(input: unknown): string | null {
  if (
    !isExactRecord(input, [
      'enabled',
      'requestsPerMinute',
      'maxConcurrentStreams',
      'allowedProviders',
      'allowedModels',
      'promptProfileId',
      'quotas',
    ])
  )
    return 'llm policy is invalid';
  if (typeof input.enabled !== 'boolean') return 'llm.enabled must be boolean';
  if (typeof input.requestsPerMinute !== 'number' || !Number.isSafeInteger(input.requestsPerMinute) || input.requestsPerMinute < 1 || input.requestsPerMinute > 10_000)
    return 'llm.requestsPerMinute is invalid';
  if (typeof input.maxConcurrentStreams !== 'number' || !Number.isSafeInteger(input.maxConcurrentStreams) || input.maxConcurrentStreams < 1 || input.maxConcurrentStreams > 1_000)
    return 'llm.maxConcurrentStreams is invalid';
  if (
    !isStringArray(input.allowedProviders) ||
    !input.allowedProviders.every(isSafeIdentifier)
  )
    return 'llm.allowedProviders is invalid';
  if (
    !isStringArray(input.allowedModels) ||
    !input.allowedModels.every(isNonEmptyString)
  )
    return 'llm.allowedModels is invalid';
  if (
    input.promptProfileId !== null &&
    !isSafeIdentifier(input.promptProfileId)
  )
    return 'llm.promptProfileId is invalid';
  if (!Array.isArray(input.quotas) || !input.quotas.every(isQuotaRule))
    return 'llm.quotas is invalid';
  return null;
}

function isQuotaRule(input: unknown): boolean {
  return (
    isExactRecord(input, [
      'metric',
      'limit',
      'period',
      'sourceGroupId',
      'hard',
    ]) &&
    typeof input.metric === 'string' &&
    [
      'requests',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'costMicros',
    ].includes(input.metric) &&
    typeof input.limit === 'number' &&
    Number.isSafeInteger(input.limit) &&
    input.limit >= 0 &&
    typeof input.period === 'string' &&
    ['daily', 'weekly', 'monthly', 'term'].includes(input.period) &&
    isNonEmptyString(input.sourceGroupId) &&
    typeof input.hard === 'boolean'
  );
}

function matchesSettingDescriptor(
  value: unknown,
  descriptor: (typeof settingRegistry)[PolicySettingKey],
): boolean {
  const { kind, allowedValues } = descriptor as SettingDescriptor;
  if (allowedValues) return typeof value === 'string' && allowedValues.includes(value);
  if (kind === 'stringOrNull') return value === null || typeof value === 'string';
  if (kind === 'number') return isIJsonPolicyNumber(value);
  return typeof value === kind;
}

function isIJsonPolicyNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value !== '__proto__' &&
    value !== 'constructor' &&
    value !== 'prototype'
  );
}

// Keep the runtime registry anchored to the application's canonical settings object.
for (const key of Object.keys(settingRegistry) as PolicySettingKey[]) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key))
    throw new Error(`Policy setting ${key} has no default`);
  if (!matchesSettingDescriptor(DEFAULT_SETTINGS[key], settingRegistry[key]))
    throw new Error(`Policy setting ${key} disagrees with its application default`);
}
