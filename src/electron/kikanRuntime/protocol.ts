/** Reusable signed runtime-control protocol. No mLearn storage or UI imports. */
import { createHash, createPublicKey, verify } from 'node:crypto';

export const PROTOCOL = 'kikan-runtime/v1';
const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface Target {
  platforms?: string[];
  channels?: string[];
  minVersion?: string;
  maxVersion?: string;
  rolloutPercent?: number;
}
export interface SwitchDirective { id: string; enabled: boolean; target?: Target }
export interface ExperimentDirective { id: string; variants: Array<{ id: string; weight: number }>; target?: Target }
export interface PatchDirective { id: string; capability: string; operation: 'disable' | 'parameter'; parameter?: string; value?: number; target?: Target }
export interface UpdateDirective {
  autoCheck: boolean;
  targetVersion?: string;
  allowReleaseRollback?: boolean;
  maxDataSchema?: number;
  feedUrl?: string;
  target?: Target;
}
export interface RuntimeDocument {
  protocol: typeof PROTOCOL;
  sequence: number;
  issuedAt: number;
  expiresAt: number;
  switches: SwitchDirective[];
  experiments: ExperimentDirective[];
  patches: PatchDirective[];
  update?: UpdateDirective;
  telemetry?: { endpoint: string; samplePercent: number };
}
export interface SignedRuntimeDocument { document: RuntimeDocument; signature: string }
export interface RuntimeContext { installationId: string; platform: string; channel: string; appVersion: string; dataSchema: number }
export interface RuntimeEvaluation {
  switches: Record<string, boolean>;
  experiments: Record<string, string>;
  patches: PatchDirective[];
  update?: UpdateDirective;
  telemetry?: RuntimeDocument['telemetry'];
  sequence: number;
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Canonical JSON bytes shared by client and publisher; no wire-order trust. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error('Non-JSON runtime document value');
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9.-]{0,79}$/.test(value);
}

function validVersion(version: unknown): version is string {
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

function validateTarget(value: unknown): asserts value is Target {
  if (!plain(value)) throw new Error('Invalid targeting rule');
  exactKeys(value, ['platforms', 'channels', 'minVersion', 'maxVersion', 'rolloutPercent'], 'target');
  for (const key of ['platforms', 'channels'] as const) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || !value[key].every(identifier))) {
      throw new Error(`Invalid target ${key}`);
    }
  }
  for (const key of ['minVersion', 'maxVersion'] as const) {
    if (value[key] !== undefined && !validVersion(value[key])) throw new Error(`Invalid target ${key}`);
  }
  if (value.rolloutPercent !== undefined && (typeof value.rolloutPercent !== 'number'
    || value.rolloutPercent < 0 || value.rolloutPercent > 100)) throw new Error('Invalid rollout percentage');
}

function validateDirective(value: unknown, kind: 'switch' | 'experiment' | 'patch'): void {
  if (!plain(value) || !identifier(value.id)) throw new Error(`Invalid ${kind} directive`);
  if (value.target !== undefined) validateTarget(value.target);
  if (kind === 'switch') {
    exactKeys(value, ['id', 'enabled', 'target'], kind);
    if (typeof value.enabled !== 'boolean') throw new Error('Invalid switch value');
  } else if (kind === 'experiment') {
    exactKeys(value, ['id', 'variants', 'target'], kind);
    if (!Array.isArray(value.variants) || value.variants.length < 2 || value.variants.length > 8
      || !value.variants.every((variant) => plain(variant) && identifier(variant.id)
        && typeof variant.weight === 'number' && variant.weight >= 0 && variant.weight <= 100
        && Object.keys(variant).every((key) => ['id', 'weight'].includes(key)))) throw new Error('Invalid experiment variants');
    const weight = value.variants.reduce((sum: number, variant: { weight: number }) => sum + variant.weight, 0);
    if (Math.abs(weight - 100) > 0.001) throw new Error('Experiment weights must total 100');
    if (new Set(value.variants.map((variant: { id: string }) => variant.id)).size !== value.variants.length) throw new Error('Duplicate experiment variant');
  } else {
    exactKeys(value, ['id', 'capability', 'operation', 'parameter', 'value', 'target'], kind);
    if (!identifier(value.capability) || !['disable', 'parameter'].includes(String(value.operation))) throw new Error('Invalid patch operation');
    if (value.operation === 'parameter' && (!identifier(value.parameter) || typeof value.value !== 'number' || !Number.isFinite(value.value))) {
      throw new Error('Invalid patch parameter');
    }
    if (value.operation === 'disable' && (value.parameter !== undefined || value.value !== undefined)) throw new Error('Invalid disable patch');
  }
}

export function validateRuntimeDocument(value: unknown, now = Date.now()): RuntimeDocument {
  if (!plain(value)) throw new Error('Runtime document must be an object');
  if (Buffer.byteLength(canonicalJson(value)) > MAX_DOCUMENT_BYTES) throw new Error('Runtime document is too large');
  exactKeys(value, ['protocol', 'sequence', 'issuedAt', 'expiresAt', 'switches', 'experiments', 'patches', 'update', 'telemetry'], 'document');
  if (value.protocol !== PROTOCOL || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) throw new Error('Invalid protocol or sequence');
  if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
    || (value.expiresAt as number) <= (value.issuedAt as number)
    || (value.expiresAt as number) - (value.issuedAt as number) > MAX_LIFETIME_MS
    || (value.issuedAt as number) > now + 5 * 60_000
    || (value.expiresAt as number) <= now) throw new Error('Expired or invalid runtime document');
  for (const [key, kind] of [['switches', 'switch'], ['experiments', 'experiment'], ['patches', 'patch']] as const) {
    if (!Array.isArray(value[key]) || value[key].length > 100) throw new Error(`Invalid ${key}`);
    value[key].forEach((directive) => validateDirective(directive, kind));
    if (new Set(value[key].map((directive: { id: string }) => directive.id)).size !== value[key].length) throw new Error(`Duplicate ${key} ID`);
  }
  if (value.update !== undefined) {
    if (!plain(value.update)) throw new Error('Invalid update policy');
    exactKeys(value.update, ['autoCheck', 'targetVersion', 'allowReleaseRollback', 'maxDataSchema', 'feedUrl', 'target'], 'update');
    if (typeof value.update.autoCheck !== 'boolean') throw new Error('Invalid update autoCheck');
    if (value.update.targetVersion !== undefined && !validVersion(value.update.targetVersion)) throw new Error('Invalid update target version');
    if (value.update.allowReleaseRollback !== undefined && typeof value.update.allowReleaseRollback !== 'boolean') throw new Error('Invalid rollback authorization');
    if (value.update.maxDataSchema !== undefined && (!Number.isSafeInteger(value.update.maxDataSchema) || (value.update.maxDataSchema as number) < 0)) throw new Error('Invalid data schema bound');
    if (value.update.feedUrl !== undefined) {
      if (typeof value.update.feedUrl !== 'string') throw new Error('Invalid update feed URL');
      const feed = new URL(value.update.feedUrl);
      if (feed.protocol !== 'https:' || feed.username || feed.password || feed.hash) throw new Error('Update feed requires HTTPS');
    }
    if (value.update.target !== undefined) validateTarget(value.update.target);
    if (value.update.allowReleaseRollback && (!value.update.targetVersion || value.update.maxDataSchema === undefined)) {
      throw new Error('Release rollback requires target and data schema bound');
    }
    if (value.update.feedUrl && (!value.update.allowReleaseRollback || !value.update.targetVersion
      || !new URL(value.update.feedUrl).pathname.includes(value.update.targetVersion))) {
      throw new Error('Rollback feed must match the signed target version');
    }
  }
  if (value.telemetry !== undefined) {
    if (!plain(value.telemetry)) throw new Error('Invalid telemetry policy');
    exactKeys(value.telemetry, ['endpoint', 'samplePercent'], 'telemetry');
    if (typeof value.telemetry.endpoint !== 'string' || !value.telemetry.endpoint.startsWith('https://')
      || typeof value.telemetry.samplePercent !== 'number' || value.telemetry.samplePercent < 0
      || value.telemetry.samplePercent > 100) throw new Error('Invalid telemetry endpoint or sampling');
  }
  return value as unknown as RuntimeDocument;
}

export function verifySignedDocument(envelope: unknown, publicKeyPem: string, now = Date.now()): RuntimeDocument {
  if (!plain(envelope)) throw new Error('Invalid signed envelope');
  exactKeys(envelope, ['document', 'signature'], 'envelope');
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature)) throw new Error('Invalid signature encoding');
  const document = validateRuntimeDocument(envelope.document, now);
  const bytes = Buffer.from(canonicalJson(document));
  if (!verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Runtime signature verification failed');
  }
  return document;
}

function compareVersions(a: string, b: string): number {
  const first = a.split(/[.-]/).slice(0, 3).map(Number);
  const second = b.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i += 1) if (first[i] !== second[i]) return first[i] - second[i];
  return 0;
}

function bucket(context: RuntimeContext, id: string): number {
  const hash = createHash('sha256').update(`${context.installationId}:${id}`).digest();
  return hash.readUInt32BE(0) / 0x1_0000_0000 * 100;
}

function applies(target: Target | undefined, context: RuntimeContext, id: string): boolean {
  if (!target) return true;
  if (target.platforms && !target.platforms.includes(context.platform)) return false;
  if (target.channels && !target.channels.includes(context.channel)) return false;
  if (target.minVersion && compareVersions(context.appVersion, target.minVersion) < 0) return false;
  if (target.maxVersion && compareVersions(context.appVersion, target.maxVersion) > 0) return false;
  return target.rolloutPercent === undefined || bucket(context, id) < target.rolloutPercent;
}

export function evaluateRuntime(document: RuntimeDocument, context: RuntimeContext): RuntimeEvaluation {
  const switches: Record<string, boolean> = {};
  const experiments: Record<string, string> = {};
  for (const directive of document.switches) if (applies(directive.target, context, directive.id)) switches[directive.id] = directive.enabled;
  for (const experiment of document.experiments) {
    if (!applies(experiment.target, context, experiment.id)) continue;
    const position = bucket(context, experiment.id);
    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.weight;
      if (position < cumulative) { experiments[experiment.id] = variant.id; break; }
    }
  }
  return {
    switches, experiments,
    patches: document.patches.filter((patch) => applies(patch.target, context, patch.id)),
    update: document.update && applies(document.update.target, context, 'update')
      && (!document.update.allowReleaseRollback || context.dataSchema <= document.update.maxDataSchema!)
      ? document.update : undefined,
    telemetry: document.telemetry,
    sequence: document.sequence,
  };
}
