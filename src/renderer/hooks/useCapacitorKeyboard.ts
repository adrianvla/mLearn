/**
 * useCapacitorKeyboard
 * Adjusts the viewport when the software keyboard shows/hides on mobile.
 * Uses @capacitor/keyboard plugin events to add/remove a body class
 * that CSS can use to adjust layout.
 */

import { onCleanup, onMount } from 'solid-js';
import { isMobile } from '../../shared/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger("renderer.hooks.useCapacitorKeyboard");

export function useCapacitorKeyboard() {
  if (!isMobile()) return;

  onMount(async () => {
    try {
      const { Keyboard } = await import('@capacitor/keyboard');

      const showListener = await Keyboard.addListener('keyboardWillShow', (info) => {
        document.body.classList.add('keyboard-visible');
        document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
      });

      const hideListener = await Keyboard.addListener('keyboardWillHide', () => {
        document.body.classList.remove('keyboard-visible');
        document.documentElement.style.setProperty('--keyboard-height', '0px');
      });

      onCleanup(() => {
        showListener.remove();
        hideListener.remove();
      });
    } catch (e) {
      log.error("error", e);
      // @capacitor/keyboard not available (e.g., in browser dev mode)
    }
  });
}
