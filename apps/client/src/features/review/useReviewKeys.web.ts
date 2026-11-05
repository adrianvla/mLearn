import { useEffect, useRef } from 'react';
import { learningKeyAllowed } from './rating';

/** Mounted by the focused Review route only; dialogs and text selection keep their keys. */
export function useReviewKeys(active: boolean, handle: (key: string, at: number, alt: boolean) => boolean) {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    if (!active) return;
    let composing = false;
    const begin = () => { composing = true; };
    const end = () => { composing = false; };
    const keydown = (event: KeyboardEvent) => {
      const path = event.composedPath();
      const editable = path.some(node => node instanceof HTMLElement && (
        node.isContentEditable || node.matches('input,textarea,select,[role="textbox"],[role="combobox"]')
      ));
      const modal = !!document.querySelector('[aria-modal="true"],dialog[open]');
      const selected = !!document.getSelection()?.toString();
      const context = {
        repeat: event.repeat, composing: composing || event.isComposing || event.keyCode === 229,
        prevented: event.defaultPrevented, editable, selected, modal,
        modified: event.ctrlKey || event.metaKey || event.shiftKey,
      };
      if (!learningKeyAllowed(context)) {
        // A held key on a focused Button must not bypass this owner's repeat
        // guard through the browser's native click synthesis.
        if (event.repeat && path.some(node => node instanceof HTMLElement && node.matches('button,[role="button"]')))
          event.preventDefault();
        return;
      }
      // Enter/Space on an actual control belongs to that control, not Reveal.
      if ((event.key === ' ' || event.key === 'Enter') &&
        path.some(node => node instanceof HTMLElement && node.matches('button,[role="button"],a'))) return;
      if (latest.current(event.key, event.timeStamp, event.altKey)) event.preventDefault();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('compositionstart', begin);
    document.addEventListener('compositionend', end);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('compositionstart', begin);
      document.removeEventListener('compositionend', end);
    };
  }, [active]);
}
