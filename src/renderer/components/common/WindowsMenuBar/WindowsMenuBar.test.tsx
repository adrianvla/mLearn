// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

let fullscreenCallback: ((isFullscreen: boolean) => void) | undefined;
const mockOnWindowFullscreenChange = vi.fn((cb: (isFullscreen: boolean) => void) => {
  fullscreenCallback = cb;
  return () => {
    fullscreenCallback = undefined;
  };
});

vi.mock('@shared/bridges', () => ({
  getBridge: () => ({
    window: {
      popupMenu: vi.fn(),
      setTitleBarOverlay: vi.fn(),
      onWindowFullscreenChange: mockOnWindowFullscreenChange,
    },
  }),
}));

vi.mock('../../../context/LocalizationContext', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
}));

import WindowsMenuBar from './WindowsMenuBar';

describe('WindowsMenuBar', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.classList.remove('window-fullscreen');
  });

  it('renders the File/Edit/View/Go/Tools/Help menu labels', () => {
    const dispose = render(() => <WindowsMenuBar />, document.body);
    const bar = document.querySelector('.windows-menu-bar');
    expect(bar).not.toBeNull();
    expect(bar?.textContent).toContain('mlearn.Menu.File');
    expect(bar?.textContent).toContain('mlearn.Menu.Tools');
    dispose();
  });

  it('subscribes to window fullscreen changes and toggles the body class', () => {
    const dispose = render(() => <WindowsMenuBar />, document.body);
    expect(mockOnWindowFullscreenChange).toHaveBeenCalled();

    fullscreenCallback?.(true);
    expect(document.body.classList.contains('window-fullscreen')).toBe(true);

    fullscreenCallback?.(false);
    expect(document.body.classList.contains('window-fullscreen')).toBe(false);
    dispose();
  });

  it('cleans up the fullscreen class and subscription on unmount', () => {
    const dispose = render(() => <WindowsMenuBar />, document.body);
    fullscreenCallback?.(true);
    expect(document.body.classList.contains('window-fullscreen')).toBe(true);

    dispose();
    expect(document.body.classList.contains('window-fullscreen')).toBe(false);
  });

  it('toggles the class on element fullscreen (video player requestFullscreen)', () => {
    const dispose = render(() => <WindowsMenuBar />, document.body);

    // Simulate element fullscreen: document.fullscreenElement set + event
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => ({ tagName: 'DIV' }),
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(document.body.classList.contains('window-fullscreen')).toBe(true);

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(document.body.classList.contains('window-fullscreen')).toBe(false);
    dispose();
  });
});
