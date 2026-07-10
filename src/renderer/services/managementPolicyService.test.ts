import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../test/fixtures/management-policy-v1.json';
import type {
  EffectiveManagementPolicy,
  ManagementPolicyPublicKey,
} from '../../shared/managementPolicy';
import { canonicalizePolicyJson } from '../../shared/policyCanonicalization';
import { DEFAULT_SETTINGS } from '../../shared/types';
import {
  applyManagedSettings,
  fetchEffectivePolicy,
  hasFreshPolicy,
  verifyEffectivePolicy,
} from './managementPolicyService';
import {
  loadCachedPolicy,
  resetManagementPolicyCacheConnectionForTests,
} from './managementPolicyCache';

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function signedPolicy(overrides: Partial<EffectiveManagementPolicy> = {}): Promise<{
  policy: EffectiveManagementPolicy;
  publicKey: ManagementPolicyPublicKey;
  now: number;
}> {
  const now = Date.parse('2026-07-10T08:05:00Z');
  const secretKey = new Uint8Array(32).fill(7);
  const publicKeyBytes = await getPublicKeyAsync(secretKey);
  const unsigned = {
    ...fixture,
    issuedAt: '2026-07-10T08:00:00Z',
    expiresAt: '2026-07-10T08:15:00Z',
    keyId: 'test-key',
    ...overrides,
  } as EffectiveManagementPolicy;
  unsigned.signature = '';
  const { signature: _, ...payload } = unsigned;
  const signatureBytes = await signAsync(
    new TextEncoder().encode(canonicalizePolicyJson(payload)),
    secretKey,
  );
  return {
    policy: { ...unsigned, signature: base64Url(signatureBytes) },
    publicKey: {
      algorithm: 'Ed25519',
      keyId: 'test-key',
      publicKey: base64Url(publicKeyBytes),
    },
    now,
  };
}

describe('management policy service', () => {
  beforeEach(() => {
    resetManagementPolicyCacheConnectionForTests();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies managed setting values without mutating the base settings', () => {
    const base = { ...DEFAULT_SETTINGS, llmEnabled: true, theme: 'light' as const };
    const next = applyManagedSettings(base, fixture as EffectiveManagementPolicy);

    expect(next.llmEnabled).toBe(false);
    expect(next.theme).toBe('dark');
    expect(base.llmEnabled).toBe(true);
  });

  it('verifies an RFC 8785 Ed25519 snapshot and rejects managed-value tampering', async () => {
    const { policy, publicKey, now } = await signedPolicy();
    await expect(verifyEffectivePolicy(policy, publicKey, {
      expectedActiveGroupId: 'german-a',
      now,
    })).resolves.toEqual(policy);

    await expect(verifyEffectivePolicy({
      ...policy,
      settings: {
        ...policy.settings,
        llmEnabled: { ...policy.settings.llmEnabled!, value: true },
      },
    }, publicKey, {
      expectedActiveGroupId: 'german-a',
      now,
    })).rejects.toThrow('signature');
  });

  it('rejects wrong group, key ID, schema, future issuance, and excessive lifetime', async () => {
    const { policy, publicKey, now } = await signedPolicy();
    await expect(verifyEffectivePolicy(policy, publicKey, {
      expectedActiveGroupId: 'different-group',
      now,
    })).rejects.toThrow('active group');
    await expect(verifyEffectivePolicy(policy, { ...publicKey, keyId: 'other' }, {
      expectedActiveGroupId: 'german-a',
      now,
    })).rejects.toThrow('key ID');
    await expect(verifyEffectivePolicy({ ...policy, schemaVersion: 2 }, publicKey, {
      expectedActiveGroupId: 'german-a',
      now,
    })).rejects.toThrow('schema');

    const future = await signedPolicy({
      issuedAt: '2026-07-10T08:07:00Z',
      expiresAt: '2026-07-10T08:15:00Z',
    });
    await expect(verifyEffectivePolicy(future.policy, future.publicKey, {
      expectedActiveGroupId: 'german-a',
      now,
    })).rejects.toThrow('future');

    const excessive = await signedPolicy({ expiresAt: '2026-07-10T08:15:01Z' });
    await expect(verifyEffectivePolicy(excessive.policy, excessive.publicKey, {
      expectedActiveGroupId: 'german-a',
      now,
    })).rejects.toThrow('validity interval');
  });

  it('keeps a verified stale policy available for restrictions but not network authorization', async () => {
    const { policy, publicKey } = await signedPolicy();
    const expiredAt = Date.parse(policy.expiresAt);
    await expect(verifyEffectivePolicy(policy, publicKey, {
      expectedActiveGroupId: 'german-a',
      now: expiredAt,
      requireFresh: false,
    })).resolves.toEqual(policy);
    expect(hasFreshPolicy(policy, expiredAt)).toBe(false);
    await expect(verifyEffectivePolicy(policy, publicKey, {
      expectedActiveGroupId: 'german-a',
      now: expiredAt,
    })).rejects.toThrow('expired');
  });

  it('fetches from the normalized origin with auth, pins the key, and caches by user identity', async () => {
    const { policy, publicKey, now } = await signedPolicy();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = url.endsWith('/public-key') ? publicKey : policy;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const settings = {
      ...DEFAULT_SETTINGS,
      cloudAuthStatus: 'signed-in' as const,
      cloudAuthUserId: 'learner-1',
      cloudAuthActiveGroupId: 'german-a',
      overrideCloudEndpointUrl: true,
      cloudApiUrl: 'https://School.Example:443/nested/path',
    };

    await expect(fetchEffectivePolicy(settings, 'secret-token', now)).resolves.toEqual({
      policy,
      fresh: true,
      source: 'network',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/school\.example\/api\/policy\//);
      expect(init?.headers).toEqual({ Authorization: 'Bearer secret-token' });
    }
    expect(await loadCachedPolicy('https://school.example', 'learner-1')).toEqual(policy);
    expect(await loadCachedPolicy('https://school.example', 'secret-token')).toBeNull();

    const rotatedKey = {
      ...publicKey,
      keyId: 'rotated',
      publicKey: base64Url(new Uint8Array(32).fill(9)),
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/public-key') ? rotatedKey : policy,
    ), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(fetchEffectivePolicy(settings, 'new-token', now)).rejects.toThrow('re-enrollment');
  });
});
