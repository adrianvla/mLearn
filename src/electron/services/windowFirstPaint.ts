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

/** Native backing colour before renderer theme hydration. Never infer theme from the OS. */
export function initialWindowBackground(scheme: string): string {
  switch (scheme) {
    case 'quartz': case 'chalk': return '#f5f5f5';
    case 'light-high-contrast': return '#ffffff';
    case 'oled': case 'dark-high-contrast': return '#000000';
    default: return '#2b2c2a';
  }
}
