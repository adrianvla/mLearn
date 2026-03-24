/**
 * Platform Detection
 * Detects the runtime environment: Electron, Capacitor, or Web (tethered).
 */

export type Platform = 'electron' | 'capacitor' | 'web';

let cachedPlatform: Platform | null = null;

/**
 * Detect the current runtime platform.
 * - 'electron': Desktop app with preload bridge (`window.mLearnIPC`)
 * - 'capacitor': Mobile app with Capacitor native bridge (`window.Capacitor`)
 * - 'web': Tethered browser or standalone web app
 */
export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;

  if (typeof window !== 'undefined') {
    if (window.mLearnIPC) {
      cachedPlatform = 'electron';
    } else if ((window as unknown as Record<string, unknown>).Capacitor) {
      cachedPlatform = 'capacitor';
    } else {
      cachedPlatform = 'web';
    }
  } else {
    // SSR or Node.js context — default to web
    cachedPlatform = 'web';
  }

  return cachedPlatform;
}

export function isElectron(): boolean {
  return getPlatform() === 'electron';
}

export function isCapacitor(): boolean {
  return getPlatform() === 'capacitor';
}

export function isWeb(): boolean {
  return getPlatform() === 'web';
}

export function isMobile(): boolean {
  return isCapacitor();
}

export function isDesktop(): boolean {
  return isElectron();
}
