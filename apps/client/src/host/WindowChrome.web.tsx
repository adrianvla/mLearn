import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const windowControlsWidth = isTauri() && navigator.platform.startsWith('Mac') ? 80 : 0;

/** Native overlay adaptation without covering controls or source interaction. */
export function WindowChrome() {
  useEffect(() => {
    if (!windowControlsWidth) return;
    const drag = (event: PointerEvent) => {
      if (event.button !== 0 || event.clientY >= 28) return;
      if (event.target instanceof Element && event.target.closest(
        'button,input,textarea,select,a,[role="button"],[role="combobox"],[role="dialog"]',
      )) return;
      void getCurrentWindow().startDragging();
    };
    document.addEventListener('pointerdown', drag);
    return () => document.removeEventListener('pointerdown', drag);
  }, []);
  return null;
}
