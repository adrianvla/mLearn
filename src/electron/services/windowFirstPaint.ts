/** Keep ordinary windows hidden until Chromium has a frame to display. */
export interface FirstPaintWindow {
  once(event: 'ready-to-show' | 'closed', listener: () => void): unknown;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

interface Presentation { ready: boolean; requested: boolean }
const presentations = new WeakMap<FirstPaintWindow, Presentation>();

export function registerWindowFirstPaint(window: FirstPaintWindow): void {
  if (presentations.has(window)) return;
  const presentation: Presentation = { ready: false, requested: false };
  presentations.set(window, presentation);
  window.once('ready-to-show', () => {
    presentation.ready = true;
    if (presentation.requested) showWindowAfterFirstPaint(window);
  });
  window.once('closed', () => {
    presentation.requested = false;
    presentations.delete(window);
  });
}

export function showWindowAfterFirstPaint(window: FirstPaintWindow): void {
  if (window.isDestroyed()) return;
  const presentation = presentations.get(window);
  if (presentation && !presentation.ready) {
    presentation.requested = true;
    return;
  }
  if (presentation) presentation.requested = false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** Reveal a themed, locally rendered recovery surface after the initial URL fails. */
export function showWindowAfterLoadFailure(window: FirstPaintWindow): void {
  if (window.isDestroyed()) return;
  const presentation = presentations.get(window);
  if (presentation) {
    presentation.ready = true;
    presentation.requested = false;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function loadRecoveryHtml(url: string, background: string): string {
  const foreground = recoveryBackgroundIsLight(background) ? '#202124' : '#f1f1f1';
  const escapedUrl = url.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>mLearn</title></head><body style="margin:0;min-height:100vh;background:${background};color:${foreground};font:16px system-ui,sans-serif"><main style="max-width:34rem;margin:15vh auto;padding:2rem"><h1>mLearn could not open this window</h1><p>Check that the application is available, then retry.</p><a style="color:inherit" href="${escapedUrl}">Try again</a></main></body></html>`;
}

function recoveryBackgroundIsLight(background: string): boolean {
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(background)?.[1];
  let channels: number[] | undefined;
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex.slice(0, 3)].map(value => `${value}${value}`).join('') : hex.slice(0, 6);
    channels = [0, 2, 4].map(offset => Number.parseInt(expanded.slice(offset, offset + 2), 16));
  } else {
    const rgb = /^rgba?\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?/i.exec(background);
    if (rgb) {
      const percentage = background.includes('%');
      channels = rgb.slice(1, 4).map(value => Number(value) * (percentage ? 2.55 : 1));
    }
  }
  if (!channels) return false;
  return (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) >= 140;
}

/** Native backing colour before renderer theme hydration. Never infer theme from the OS. */
export function initialWindowBackground(scheme: string, customColors?: { 'bg-opaque'?: string; bg?: string }): string {
  if (scheme === 'custom') {
    const customBackground = customColors?.['bg-opaque'] ?? customColors?.bg;
    if (customBackground && /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|rgba?\([\d.,%\s]+\))$/i.test(customBackground.trim())) {
      return customBackground.trim();
    }
  }
  switch (scheme) {
    case 'quartz': return '#f3f5f7';
    case 'chalk': return '#f5f5f5';
    case 'light-high-contrast': return '#ffffff';
    case 'slate': case 'oled': case 'dark-high-contrast': return '#000000';
    default: return '#2b2c2a';
  }
}
