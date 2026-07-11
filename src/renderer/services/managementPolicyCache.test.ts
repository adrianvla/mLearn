import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../test/fixtures/management-policy-v1.json';
import type {
  EffectiveManagementPolicy,
  ManagementPolicyPublicKey,
} from '../../shared/managementPolicy';
import {
  enrollTrustedPublicKey,
  loadCachedPolicy,
  loadTrustedPublicKey,
  managementPolicyCacheKey,
  ManagementPolicyKeyChangeError,
  normalizeManagementOrigin,
  resetManagementPolicyCacheConnectionForTests,
  resetManagementPolicyTrust,
  saveCachedPolicy,
  saveCachedPolicyMonotonic,
} from './managementPolicyCache';

const origin = 'https://school.example';
const publicKey: ManagementPolicyPublicKey = {
  keyId: 'key-1',
  algorithm: 'Ed25519',
  publicKey: 'public-key-1',
};

describe('management policy cache', () => {
  beforeEach(() => {
    resetManagementPolicyCacheConnectionForTests();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  it('normalizes deployment origins and scopes snapshots by stable user identity', () => {
    expect(normalizeManagementOrigin('HTTPS://School.Example:443/api/')).toBe(origin);
    expect(managementPolicyCacheKey(origin, 'learner-1')).toBe(`${origin}\u0000learner-1`);
    expect(() => normalizeManagementOrigin('file:///tmp/policy')).toThrow('HTTP');
  });

  it('persists trusted keys and policies by origin plus authenticated user, never token', async () => {
    await enrollTrustedPublicKey(origin, publicKey);
    await saveCachedPolicy(origin, 'learner-1', fixture as EffectiveManagementPolicy);

    expect(await loadTrustedPublicKey(`${origin}/api`)).toEqual(publicKey);
    expect(await loadCachedPolicy(origin, 'learner-1')).toEqual(fixture);
    expect(await loadCachedPolicy(origin, 'learner-2')).toBeNull();
  });

  it('rejects an unexpected deployment key change while accepting repeat enrollment', async () => {
    await enrollTrustedPublicKey(origin, publicKey);
    await expect(enrollTrustedPublicKey(`${origin}/v1`, publicKey)).resolves.toBeUndefined();
    await expect(enrollTrustedPublicKey(origin, {
      ...publicKey,
      keyId: 'rotated-key',
    })).rejects.toBeInstanceOf(ManagementPolicyKeyChangeError);
    expect(await loadTrustedPublicKey(origin)).toEqual(publicKey);
  });

  it('resets trust and every cached user snapshot for only the confirmed origin', async () => {
    const otherOrigin = 'https://other-school.example';
    await enrollTrustedPublicKey(origin, publicKey);
    await enrollTrustedPublicKey(otherOrigin, { ...publicKey, keyId: 'other-key' });
    await saveCachedPolicy(origin, 'learner-1', fixture as EffectiveManagementPolicy);
    await saveCachedPolicy(origin, 'learner-2', fixture as EffectiveManagementPolicy);
    await saveCachedPolicy(otherOrigin, 'learner-1', fixture as EffectiveManagementPolicy);

    await resetManagementPolicyTrust(`${origin}/nested/path`, origin);

    expect(await loadTrustedPublicKey(origin)).toBeNull();
    expect(await loadCachedPolicy(origin, 'learner-1')).toBeNull();
    expect(await loadCachedPolicy(origin, 'learner-2')).toBeNull();
    expect(await loadTrustedPublicKey(otherOrigin)).not.toBeNull();
    expect(await loadCachedPolicy(otherOrigin, 'learner-1')).not.toBeNull();
    await expect(resetManagementPolicyTrust(origin, otherOrigin)).rejects.toThrow('confirmation');
  });

  it('atomically chooses one concurrent first-use key candidate', async () => {
    const candidateA = publicKey;
    const candidateB = { ...publicKey, keyId: 'key-2', publicKey: 'public-key-2' };
    const results = await Promise.allSettled([
      enrollTrustedPublicKey(origin, candidateA),
      enrollTrustedPublicKey(origin, candidateB),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect([candidateA, candidateB]).toContainEqual(await loadTrustedPublicKey(origin));
  });

  it('never lets an older same-user response replace a newer cached snapshot', async () => {
    const newer = {
      ...fixture,
      policyVersionId: 'policy-version-newer',
      issuedAt: '2026-07-10T08:10:00Z',
      expiresAt: '2026-07-10T08:15:00Z',
    } as EffectiveManagementPolicy;
    const older = {
      ...fixture,
      policyVersionId: 'policy-version-older',
      issuedAt: '2026-07-10T08:00:00Z',
      expiresAt: '2026-07-10T08:15:00Z',
    } as EffectiveManagementPolicy;

    await expect(saveCachedPolicyMonotonic(origin, 'learner-1', newer)).resolves.toBe(true);
    await expect(saveCachedPolicyMonotonic(origin, 'learner-1', older)).resolves.toBe(false);
    expect(await loadCachedPolicy(origin, 'learner-1')).toEqual(newer);
  });

  it('breaks equal issuedAt ties deterministically by policyVersionId', async () => {
    const lower = { ...fixture, policyVersionId: 'policy-a' } as EffectiveManagementPolicy;
    const higher = { ...fixture, policyVersionId: 'policy-b' } as EffectiveManagementPolicy;
    await expect(saveCachedPolicyMonotonic(origin, 'learner-1', higher)).resolves.toBe(true);
    await expect(saveCachedPolicyMonotonic(origin, 'learner-1', lower)).resolves.toBe(false);
    expect(await loadCachedPolicy(origin, 'learner-1')).toEqual(higher);
  });
});
