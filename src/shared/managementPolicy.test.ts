import { describe, expect, it } from 'vitest';

import fixture from '../../test/fixtures/management-policy-v1.json';
import { validateEffectiveManagementPolicy } from './managementPolicy';

describe('management policy contract', () => {
  it('rejects executable or unknown policy fields', () => {
    expect(
      validateEffectiveManagementPolicy({
        version: 1,
        settings: { unknown: { value: true } },
      }).ok,
    ).toBe(false);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { customThemeCSS: { value: 'body {}' } },
      }).ok,
    ).toBe(false);
  });

  it('rejects secret and auth settings', () => {
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { cloudAuthAccessToken: { value: 'secret' } },
      }).ok,
    ).toBe(false);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { cloudAuthRefreshToken: { value: 'secret' } },
      }).ok,
    ).toBe(false);
  });

  it('parses the shared version 1 fixture with exact public field names', () => {
    const result = validateEffectiveManagementPolicy(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.policyVersionId).toBe('policy-version-1');
    expect(result.value.settings.llmEnabled?.value).toBe(false);
  });
});
