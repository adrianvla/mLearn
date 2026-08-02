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

export type OS = 'windows' | 'mac' | 'linux' | 'other';

let cachedOS: OS | null = null;

/**
 * Detect the current operating system from the user agent.
 * Works in Electron, Capacitor, and web renderers (no IPC needed).
 * Note: Linux is reported on ChromeOS-capable user agents too.
 */
export function getOS(): OS {
  if (cachedOS) return cachedOS;

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) {
      cachedOS = 'windows';
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
      cachedOS = 'mac';
    } else if (/Linux|CrOS/i.test(ua)) {
      cachedOS = 'linux';
    } else {
      cachedOS = 'other';
    }
  } else {
    cachedOS = 'other';
  }

  return cachedOS;
}

/**
 * Adds `platform-{os}` to document.body (e.g. `platform-windows`).
 * CSS can scope platform-specific fixes with `body.platform-windows ...`.
 * Idempotent; safe to call once at module load of a shared entry point.
 */
export function initPlatformBodyClass(): void {
  if (typeof document === 'undefined') return;
  document.body.classList.add(`platform-${getOS()}`);
}
