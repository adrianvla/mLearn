import { verifyAsync } from '@noble/ed25519';

import { resolveCloudApiUrl } from '../../shared/backends';
import {
  type EffectiveManagementPolicy,
  type ManagementPolicyPublicKey,
  type ManagedSettingRule,
  type PolicySettingKey,
  validateEffectiveManagementPolicy,
} from '../../shared/managementPolicy';
import { canonicalizePolicyJson } from '../../shared/policyCanonicalization';
import type { Settings } from '../../shared/types';
import {
  loadCachedPolicy,
  loadTrustedPublicKey,
  ManagementPolicyKeyChangeError,
  normalizeManagementOrigin,
} from './managementPolicyCache';

const MAX_POLICY_LIFETIME_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

export interface VerifyEffectivePolicyOptions {
  expectedActiveGroupId: string;
  now?: number;
  requireFresh?: boolean;
}

export interface LoadedManagementPolicy {
  policy: EffectiveManagementPolicy;
  fresh: boolean;
  source: 'cache' | 'network';
}

export interface FetchedManagementPolicy extends LoadedManagementPolicy {
  fresh: true;
  source: 'network';
  publicKey: ManagementPolicyPublicKey;
  origin: string;
  userId: string;
}

function decodeBase64Url(value: string, expectedLength: number, label: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} is not valid base64url`);
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new Error(`${label} is not valid base64url`);
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length !== expectedLength) throw new Error(`${label} has the wrong length`);
  return bytes;
}

function validatePublicKey(input: unknown): ManagementPolicyPublicKey {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Management policy public key response is invalid');
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 3
    || typeof record.keyId !== 'string' || !record.keyId.trim()
    || record.algorithm !== 'Ed25519'
    || typeof record.publicKey !== 'string') {
    throw new Error('Management policy public key response is invalid');
  }
  decodeBase64Url(record.publicKey, 32, 'Management policy public key');
  return {
    keyId: record.keyId,
    algorithm: 'Ed25519',
    publicKey: record.publicKey,
  };
}

function parsePolicyTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Management policy ${label} is invalid`);
  return parsed;
}

export function hasFreshPolicy(
  policy: EffectiveManagementPolicy | null,
  now: number = Date.now(),
): boolean {
  if (!policy) return false;
  const issuedAt = Date.parse(policy.issuedAt);
  const expiresAt = Date.parse(policy.expiresAt);
  return Number.isFinite(issuedAt)
    && Number.isFinite(expiresAt)
    && issuedAt <= now + MAX_CLOCK_SKEW_MS
    && expiresAt > now;
}

export async function verifyEffectivePolicy(
  input: unknown,
  publicKey: ManagementPolicyPublicKey,
  options: VerifyEffectivePolicyOptions,
): Promise<EffectiveManagementPolicy> {
  const validation = validateEffectiveManagementPolicy(input);
  if (!validation.ok) throw new Error(`Invalid management policy: ${validation.error}`);
  const policy = validation.value;
  if (publicKey.algorithm !== 'Ed25519') throw new Error('Unsupported management policy key algorithm');
  if (policy.keyId !== publicKey.keyId) throw new Error('Management policy key ID does not match the trusted key');
  if (policy.activeGroupId !== options.expectedActiveGroupId) {
    throw new Error('Management policy active group does not match the activated group');
  }

  const issuedAt = parsePolicyTime(policy.issuedAt, 'issuedAt');
  const expiresAt = parsePolicyTime(policy.expiresAt, 'expiresAt');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_POLICY_LIFETIME_MS) {
    throw new Error('Management policy validity interval is invalid');
  }
  const now = options.now ?? Date.now();
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) throw new Error('Management policy was issued in the future');
  if (options.requireFresh !== false && expiresAt <= now) throw new Error('Management policy has expired');

  const { signature, ...unsigned } = policy;
  const message = new TextEncoder().encode(canonicalizePolicyJson(unsigned));
  const signatureBytes = decodeBase64Url(signature, 64, 'Management policy signature');
  const publicKeyBytes = decodeBase64Url(publicKey.publicKey, 32, 'Management policy public key');
  if (!await verifyAsync(signatureBytes, message, publicKeyBytes, { zip215: false })) {
    throw new Error('Management policy signature is invalid');
  }
  return policy;
}

export function applyManagedSettings(
  base: Settings,
  policy: EffectiveManagementPolicy | null,
): Settings {
  if (!policy) return base;
  const next = { ...base };
  for (const [key, rule] of Object.entries(policy.settings)) {
    if (rule) {
      (next as unknown as Record<string, unknown>)[key] = rule.value;
    }
  }
  return next;
}

export function getManagedSettingRule<K extends PolicySettingKey>(
  policy: EffectiveManagementPolicy | null,
  key: K,
): ManagedSettingRule<K> | null {
  return (policy?.settings[key] as ManagedSettingRule<K> | undefined) ?? null;
}

function requireManagementScope(settings: Settings): {
  origin: string;
  userId: string;
  activeGroupId: string;
} {
  if (settings.cloudAuthStatus !== 'signed-in') throw new Error('A signed-in management session is required');
  const userId = settings.cloudAuthUserId.trim();
  const activeGroupId = settings.cloudAuthActiveGroupId.trim();
  if (!userId) throw new Error('Management policy requires an authenticated user identity');
  if (!activeGroupId) throw new Error('Management policy requires an active group');
  return {
    origin: normalizeManagementOrigin(resolveCloudApiUrl(settings)),
    userId,
    activeGroupId,
  };
}

async function jsonResponse(response: Response, label: string): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  return payload;
}

export async function fetchEffectivePolicy(
  settings: Settings,
  accessToken: string,
  now?: number,
  signal?: AbortSignal,
): Promise<FetchedManagementPolicy> {
  const scope = requireManagementScope(settings);
  const token = accessToken.trim();
  if (!token) throw new Error('Management policy request requires an access token');
  const headers = { Authorization: `Bearer ${token}` };
  const [keyResponse, policyResponse] = await Promise.all([
    fetch(`${scope.origin}/api/policy/public-key`, { method: 'GET', headers, signal }),
    fetch(`${scope.origin}/api/policy/me`, { method: 'GET', headers, signal }),
  ]);
  const publicKey = validatePublicKey(await jsonResponse(keyResponse, 'Management policy key request'));
  const trustedPublicKey = await loadTrustedPublicKey(scope.origin);
  if (trustedPublicKey && (
    trustedPublicKey.keyId !== publicKey.keyId
    || trustedPublicKey.algorithm !== publicKey.algorithm
    || trustedPublicKey.publicKey !== publicKey.publicKey
  )) {
    throw new ManagementPolicyKeyChangeError(scope.origin);
  }
  const policy = await verifyEffectivePolicy(
    await jsonResponse(policyResponse, 'Management policy request'),
    publicKey,
    { expectedActiveGroupId: scope.activeGroupId, now: now ?? Date.now() },
  );
  return {
    policy,
    fresh: true,
    source: 'network',
    publicKey,
    origin: scope.origin,
    userId: scope.userId,
  };
}

export async function loadCachedEffectivePolicy(
  settings: Settings,
  now: number = Date.now(),
): Promise<LoadedManagementPolicy | null> {
  const scope = requireManagementScope(settings);
  const [publicKey, cachedPolicy] = await Promise.all([
    loadTrustedPublicKey(scope.origin),
    loadCachedPolicy(scope.origin, scope.userId),
  ]);
  if (!publicKey || !cachedPolicy) return null;
  const policy = await verifyEffectivePolicy(cachedPolicy, publicKey, {
    expectedActiveGroupId: scope.activeGroupId,
    now,
    requireFresh: false,
  });
  return { policy, fresh: hasFreshPolicy(policy, now), source: 'cache' };
}
