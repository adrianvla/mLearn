import { describe, expect, it } from 'vitest';

import { getInferencePolicy, type InferenceKind } from './inferencePolicy';
import { DEFAULT_SETTINGS, type Settings } from './types';

const ALL_KINDS: InferenceKind[] = [
  'conversation',
  'checker',
  'compaction',
  'reformulation',
  'dreamer',
  'scenario-direction',
  'proactive',
];

function settingsWith(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('inference policy', () => {
  it('conservative cloud permits only foreground kinds and user-initiated scenario direction', () => {
    const policy = getInferencePolicy(settingsWith({ llmProvider: 'cloud' }));

    expect(policy.kind).toBe('conservative-cloud');
    for (const kind of ['conversation', 'checker', 'compaction', 'reformulation'] as const) {
      expect(policy.isPermitted(kind)).toBe(true);
    }
    expect(policy.isPermitted('dreamer')).toBe(false);
    expect(policy.isPermitted('proactive')).toBe(false);
    expect(policy.isPermitted('scenario-direction')).toBe(false);
    expect(policy.isPermitted('scenario-direction', { userInitiated: true })).toBe(true);

    expect(policy.prefer('piggyback')).toBe(true);
    expect(policy.prefer('deferred')).toBe(false);
    expect(policy.prefer('immediate')).toBe(false);
  });

  it('budgeted cloud permits everything but never prefers immediate', () => {
    const policy = getInferencePolicy(
      settingsWith({ llmProvider: 'cloud', inferenceCloudTier: 'budgeted' }),
    );

    expect(policy.kind).toBe('budgeted-cloud');
    for (const kind of ALL_KINDS) {
      expect(policy.isPermitted(kind)).toBe(true);
    }
    expect(policy.prefer('piggyback')).toBe(true);
    expect(policy.prefer('deferred')).toBe(true);
    expect(policy.prefer('immediate')).toBe(false);
  });

  it('unrestricted cloud permits everything and prefers any mode', () => {
    const policy = getInferencePolicy(
      settingsWith({ llmProvider: 'cloud', inferenceCloudTier: 'unrestricted' }),
    );

    expect(policy.kind).toBe('unrestricted-cloud');
    for (const kind of ALL_KINDS) {
      expect(policy.isPermitted(kind)).toBe(true);
      expect(policy.isPermitted(kind, { userInitiated: false })).toBe(true);
    }
    expect(policy.prefer('piggyback')).toBe(true);
    expect(policy.prefer('deferred')).toBe(true);
    expect(policy.prefer('immediate')).toBe(true);
  });

  it('local provider is unrestricted regardless of cloud tier', () => {
    for (const provider of ['builtin', 'ollama'] as const) {
      const policy = getInferencePolicy(
        settingsWith({ llmProvider: provider, inferenceCloudTier: 'conservative' }),
      );

      expect(policy.kind).toBe('local');
      expect(policy.isPermitted('dreamer')).toBe(true);
      expect(policy.isPermitted('proactive')).toBe(true);
      expect(policy.isPermitted('scenario-direction')).toBe(true);
      expect(policy.prefer('piggyback')).toBe(true);
      expect(policy.prefer('deferred')).toBe(true);
      expect(policy.prefer('immediate')).toBe(true);
    }
  });
});
