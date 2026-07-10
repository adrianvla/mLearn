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
  saveCachedPolicy,
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
});
