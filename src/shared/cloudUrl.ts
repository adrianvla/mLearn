/**
 * Cloud endpoint resolution.
 *
 * This is a PURE rule with no browser or Electron dependencies, so both the
 * renderer and the main process resolve endpoints through the same owner.
 * A saved-but-disabled override must never win: the gate is
 * `overrideCloudEndpointUrl`, not merely the presence of a custom URL.
 */

import { DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL } from './constants';

export { DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL };

export interface CloudUrlSettings {
  overrideCloudEndpointUrl?: boolean;
  cloudLoginUrl?: string;
  cloudApiUrl?: string;
}

/** Resolve the cloud login/website URL from settings */
export function resolveCloudLoginUrl(settings: CloudUrlSettings): string {
  const url = settings.overrideCloudEndpointUrl && settings.cloudLoginUrl
    ? settings.cloudLoginUrl : DEFAULT_CLOUD_LOGIN_URL;
  return url.replace(/\/+$/, '');
}

/** Resolve the cloud API URL from settings */
export function resolveCloudApiUrl(settings: CloudUrlSettings): string {
  const url = settings.overrideCloudEndpointUrl && settings.cloudApiUrl
    ? settings.cloudApiUrl : DEFAULT_CLOUD_API_URL;
  return url.replace(/\/+$/, '');
}

/**
 * mLearn's legal acceptance applies only to mLearn-hosted cloud services.
 * A custom provider owns its own legal and consent flow.
 */
export function requiresFirstPartyCloudLegalConsent(settings: CloudUrlSettings): boolean {
  return resolveCloudLoginUrl(settings) === DEFAULT_CLOUD_LOGIN_URL
    && resolveCloudApiUrl(settings) === DEFAULT_CLOUD_API_URL;
}
