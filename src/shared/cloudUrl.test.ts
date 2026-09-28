import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLOUD_API_URL,
  DEFAULT_CLOUD_LOGIN_URL,
  requiresFirstPartyCloudLegalConsent,
  resolveCloudApiUrl,
  resolveCloudLoginUrl,
} from './cloudUrl';

describe('cloud endpoint resolution', () => {
  it('ignores a saved custom URL while the override is disabled', () => {
    // The gate is overrideCloudEndpointUrl, not the presence of a custom URL.
    // Diagnostics once read cloudApiUrl raw and probed the custom endpoint
    // while the app itself talked to the default one.
    const settings = { overrideCloudEndpointUrl: false, cloudApiUrl: 'https://school.example.com' };
    expect(resolveCloudApiUrl(settings)).toBe(DEFAULT_CLOUD_API_URL);
    expect(resolveCloudLoginUrl({ ...settings, cloudLoginUrl: 'https://school.example.com/login' }))
      .toBe(DEFAULT_CLOUD_LOGIN_URL);
  });

  it('honours a custom URL only while the override is enabled', () => {
    const settings = { overrideCloudEndpointUrl: true, cloudApiUrl: 'https://school.example.com' };
    expect(resolveCloudApiUrl(settings)).toBe('https://school.example.com');
  });

  it('strips trailing slashes so callers can append paths safely', () => {
    expect(resolveCloudApiUrl({ overrideCloudEndpointUrl: true, cloudApiUrl: 'https://school.example.com///' }))
      .toBe('https://school.example.com');
  });

  it('treats only the first-party endpoints as covered by mLearn legal consent', () => {
    expect(requiresFirstPartyCloudLegalConsent({})).toBe(true);
    expect(requiresFirstPartyCloudLegalConsent({ cloudApiUrl: 'https://school.example.com' })).toBe(true);
    expect(requiresFirstPartyCloudLegalConsent({ overrideCloudEndpointUrl: true, cloudApiUrl: 'https://school.example.com' })).toBe(false);
  });
});
