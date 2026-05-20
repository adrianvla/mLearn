import type { SitePlatform } from './types.js';
import { genericPlatform } from './generic.js';
import { youtubePlatform } from './youtube.js';

const platforms: readonly SitePlatform[] = [
  youtubePlatform,
  genericPlatform,
];

export function getSitePlatform(url: string): SitePlatform {
  for (const platform of platforms) {
    if (platform.matchesUrl(url)) {
      return platform;
    }
  }
  return genericPlatform;
}

export type { SitePlatform, PlatformSubtitleResult } from './types.js';
