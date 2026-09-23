/** mLearn's narrow adapter for the reusable KikanRuntime protocol. */
import { app } from 'electron';
import { RuntimeClient } from '../kikanRuntime/client';
import { KIKAN_RUNTIME_PUBLIC_KEY } from '../kikanRuntime/trust';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import { compareSemanticVersions } from '../../shared/semanticVersion';
import { createHash } from 'node:crypto';
import { loadSettings } from './settings';
import { DEFAULT_SETTINGS } from '../../shared/types';

const log = getLogger('electron.kikanRuntime');
const DISCOVERY_URL = 'https://mlearn-versioning.kikan.net/runtime/discovery.json';
let runtime: RuntimeClient | undefined;
let diagnosticBudget = 20;

export type OperationalEvent = 'app_start' | 'runtime_rejected' | 'guardian_blocked' | 'update_failed' | 'process_crash';

/** No messages, learner data, URLs, account IDs, or raw stack traces cross this boundary. */
export function recordOperationalEvent(event: OperationalEvent, error?: unknown): void {
  if (diagnosticBudget <= 0 || !runtime) return;
  const settings = loadSettings();
  if (!(settings.operationalTelemetryEnabled ?? DEFAULT_SETTINGS.operationalTelemetryEnabled)) return;
  const policy = runtime.evaluation().telemetry;
  if (!policy) return;
  const sample = createHash('sha256').update(`${runtime.context.installationId}:${event}`).digest().readUInt32BE(0)
    / 0x1_0000_0000 * 100;
  if (sample >= policy.samplePercent) return;
  diagnosticBudget -= 1;
  const name = error instanceof Error ? error.name : 'unknown';
  const fingerprint = error === undefined ? undefined : createHash('sha256').update(name).digest('hex').slice(0, 16);
  const body = { event, version: app.getVersion(), platform: process.platform, ...(fingerprint ? { fingerprint } : {}) };
  void fetch(policy.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  }).catch(() => { /* Operational telemetry cannot affect app availability. */ });
}

export function initializeKikanRuntime(dataSchema = 3): void {
  runtime = new RuntimeClient(getUserDataPath(), DISCOVERY_URL, KIKAN_RUNTIME_PUBLIC_KEY, {
    platform: process.platform, channel: 'stable', appVersion: app.getVersion(), dataSchema,
  });
}

export async function refreshKikanRuntime(): Promise<void> {
  if (!runtime) return;
  await runtime.refresh().then(() => {
    log.info('Applied verified runtime directives', { sequence: runtime?.verifiedSequence });
  }).catch((error) => {
    log.warn('Runtime configuration unavailable or rejected; using verified local state', String(error));
    recordOperationalEvent('runtime_rejected', error);
  });
}

export function runtimeAllows(capability: 'cloud-llm' | 'plugin-install' | 'automatic-updates'): boolean {
  const evaluation = runtime?.evaluation();
  if (!evaluation) return true;
  if (evaluation.switches[capability] === false) return false;
  return !evaluation.patches.some((patch) => patch.capability === capability && patch.operation === 'disable');
}

export function runtimeAutoDownload(defaultValue: boolean): boolean {
  const evaluation = runtime?.evaluation();
  const override = evaluation?.patches.find((patch) => patch.capability === 'automatic-updates'
    && patch.operation === 'parameter' && patch.parameter === 'auto-download'
    && (patch.value === 0 || patch.value === 1));
  if (override) return override.value === 1;
  const variant = evaluation?.experiments['update-download-policy'];
  return variant === 'automatic' ? true : variant === 'manual' ? false : defaultValue;
}

export function runtimeUpdatePolicy(): { autoCheck: boolean; targetVersion?: string; allowDowngrade: boolean; feedUrl?: string } {
  const policy = runtime?.evaluation().update;
  if (!runtimeAllows('automatic-updates') || policy?.autoCheck === false) {
    return { autoCheck: false, allowDowngrade: false };
  }
  const targetVersion = policy?.targetVersion;
  const isDowngrade = targetVersion && compareSemanticVersions(targetVersion, app.getVersion()) === -1;
  return {
    autoCheck: true,
    targetVersion,
    allowDowngrade: Boolean(isDowngrade && policy?.allowReleaseRollback && policy.maxDataSchema !== undefined),
    feedUrl: isDowngrade && policy?.allowReleaseRollback ? policy.feedUrl : undefined,
  };
}
