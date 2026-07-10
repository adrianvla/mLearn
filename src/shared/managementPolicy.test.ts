import { describe, expect, it } from 'vitest';

import fixture from '../../test/fixtures/management-policy-v1.json';
import jcsFixture from '../../test/fixtures/policy-jcs-vectors.json';
import {
  type EffectiveManagementPolicy,
  validateEffectiveManagementPolicy,
} from './managementPolicy';
import { canonicalizePolicyJson } from './policyCanonicalization';

function settingRule<T>(value: T) {
  return {
    value,
    sourceGroupId: 'school',
    sourceGroupName: 'School',
    locked: true,
  } as const;
}

function assertManagedSettingTypeBoundary(
  settings: EffectiveManagementPolicy['settings'],
) {
  settings.llmEnabled = settingRule(false);
  // @ts-expect-error Auth/session secrets are not policy-addressable.
  settings.cloudAuthAccessToken = settingRule('secret');
  // @ts-expect-error Executable CSS is not policy-addressable.
  settings.customThemeCSS = settingRule('body {}');
}
void assertManagedSettingTypeBoundary;

describe('management policy contract', () => {
  it('matches the shared RFC 8785 canonical byte vectors', () => {
    for (const vector of jcsFixture.vectors) {
      expect(canonicalizePolicyJson(vector.input), vector.name).toBe(
        vector.canonical,
      );
    }
    const { signature: _, ...unsigned } = jcsFixture.signedSnapshot;
    expect(canonicalizePolicyJson(unsigned)).toBe(
      jcsFixture.signedSnapshotCanonical,
    );
  });

  it('rejects executable or unknown policy fields', () => {
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { ...fixture.settings, unknown: settingRule(true) },
      }).ok,
    ).toBe(false);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: {
          ...fixture.settings,
          customThemeCSS: settingRule('body {}'),
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects secret and auth settings', () => {
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: {
          ...fixture.settings,
          cloudAuthAccessToken: settingRule('secret'),
        },
      }).ok,
    ).toBe(false);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: {
          ...fixture.settings,
          cloudAuthRefreshToken: settingRule('secret'),
        },
      }).ok,
    ).toBe(false);
  });

  it('accepts only registered literal setting values', () => {
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { theme: settingRule('dark') },
      }).ok,
    ).toBe(true);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { theme: settingRule('neon') },
      }).ok,
    ).toBe(false);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { readerTextFontStyle: settingRule('serif') },
      }).ok,
    ).toBe(true);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        settings: { readerTextFontStyle: settingRule('comic') },
      }).ok,
    ).toBe(false);
  });

  it('rejects coercible quota metric and period objects without executing them', () => {
    let coercions = 0;
    const coercible = {
      toString: () => {
        coercions += 1;
        return 'totalTokens';
      },
    };
    const quota = fixture.llm.quotas[0];

    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        llm: { ...fixture.llm, quotas: [{ ...quota, metric: coercible }] },
      }).ok,
    ).toBe(false);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        llm: { ...fixture.llm, quotas: [{ ...quota, period: coercible }] },
      }).ok,
    ).toBe(false);
    expect(coercions).toBe(0);
  });

  it('accepts only JavaScript-safe integer quota limits', () => {
    const quota = fixture.llm.quotas[0];

    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        llm: {
          ...fixture.llm,
          quotas: [{ ...quota, limit: Number.MAX_SAFE_INTEGER }],
        },
      }).ok,
    ).toBe(true);
    expect(
      validateEffectiveManagementPolicy({
        ...fixture,
        llm: {
          ...fixture.llm,
          quotas: [{ ...quota, limit: Number.MAX_SAFE_INTEGER + 1 }],
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects unsafe integer settings while preserving finite fractions', () => {
    for (const value of [
      Number.MAX_SAFE_INTEGER + 1,
      9_007_199_254_740_993,
      Number.MIN_SAFE_INTEGER - 1,
      -9_007_199_254_740_993,
    ]) {
      expect(
        validateEffectiveManagementPolicy({
          ...fixture,
          settings: { subtitle_font_size: settingRule(value) },
        }).ok,
      ).toBe(false);
    }
    for (const value of [
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      20.5,
      1e-7,
    ]) {
      expect(
        validateEffectiveManagementPolicy({
          ...fixture,
          settings: { subtitle_font_size: settingRule(value) },
        }).ok,
      ).toBe(true);
    }
  });

  it('parses the shared version 1 fixture with exact public field names', () => {
    const result = validateEffectiveManagementPolicy(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.policyVersionId).toBe('policy-version-1');
    expect(result.value.settings.llmEnabled?.value).toBe(false);
    expect(result.value.settings.theme?.value).toBe('dark');
    expect(result.value.settings.flashcard_deck?.value).toBeNull();
  });
});
