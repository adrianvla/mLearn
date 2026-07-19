import { describe, expect, it } from 'vitest';
import { compareSemanticVersions, satisfiesMinimumAppVersion } from './semanticVersion';

describe('semantic version comparison', () => {
  it('orders major, minor, and patch components numerically', () => {
    expect(compareSemanticVersions('3.0.0', '2.99.99')).toBe(1);
    expect(compareSemanticVersions('2.10.0', '2.9.99')).toBe(1);
    expect(compareSemanticVersions('2.9.10', '2.9.9')).toBe(1);
    expect(compareSemanticVersions('2.9.9', '2.9.9')).toBe(0);
  });

  it('implements semantic prerelease ordering and ignores build metadata', () => {
    expect(compareSemanticVersions('2.7.0-beta.2', '2.7.0-beta.10')).toBe(-1);
    expect(compareSemanticVersions('2.7.0', '2.7.0-rc.1')).toBe(1);
    expect(compareSemanticVersions('2.7.0+desktop.4', '2.7.0+desktop.1')).toBe(0);
  });

  it('rejects invalid semantic versions instead of comparing them lexically', () => {
    expect(compareSemanticVersions('2.7', '2.7.0')).toBeUndefined();
    expect(compareSemanticVersions('2.07.0', '2.7.0')).toBeUndefined();
    expect(satisfiesMinimumAppVersion('not-a-version', '2.7.0')).toBe(false);
  });

  it('accepts an optional v prefix on app versions', () => {
    expect(satisfiesMinimumAppVersion('v2.7.1', '2.7.0')).toBe(true);
  });
});
