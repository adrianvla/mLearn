/**
 * Mobile Context Menu Handler
 * Listens for context menu events from the capacitor bridge and shows a MobileContextMenu.
 * Mount this once inside the mobile app shell.
 */

import { Component, createSignal, onCleanup, onMount } from 'solid-js';
import { MobileContextMenu, type ContextMenuItem } from './MobileContextMenu';
import { useLocalization } from '../../../context/LocalizationContext';

export const MobileContextMenuHandler: Component = () => {
  const { t } = useLocalization();
  const [open, setOpen] = createSignal(false);
  const [items, setItems] = createSignal<ContextMenuItem[]>([]);
  const [responseEvent, setResponseEvent] = createSignal('');

  onMount(() => {
    const handleCtxMenu = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.type === 'video') {
        const menuItems: ContextMenuItem[] = [
          {
            id: 'copy-sub',
            label: t('mlearn.Video.CopySubtitle') || 'Copy Subtitle',
            disabled: !detail.options?.hasContextPhrase,
          },
          {
            id: 'explain-phrase',
            label: t('mlearn.WordHover.Explain') || 'Explain',
            disabled: !detail.options?.canExplainPhrase,
          },
          { id: 'sync-subs', label: t('mlearn.Video.SyncSubtitles') || 'Sync Subtitles' },
        ];
        if (detail.options?.isWatchTogether) {
          menuItems.push({ id: 'watch-together', label: t('mlearn.Video.WatchTogether') || 'Watch Together' });
        }
        setItems(menuItems);
        setResponseEvent('mlearn-ctx-command');
        setOpen(true);
      } else if (detail.type === 'reader') {
        const readerItems: ContextMenuItem[] = [];
        if (detail.options?.canToggleReadingHider !== false) {
          readerItems.push({
            id: 'toggle-reading-annotation-hider',
            label: detail.options?.readingAnnotationHiderEnabled
              ? (t('mlearn.Reader.ShowReadingAnnotations') || 'Show reading annotations')
              : (t('mlearn.Reader.HideReadingAnnotations') || 'Hide reading annotations'),
          });
        }
        if (detail.options?.hasContextPhrase) {
          readerItems.push({ id: 'copy-phrase', label: t('mlearn.Reader.CopyPhrase') || 'Copy Phrase' });
        }
        readerItems.push({
          id: 'explain-phrase',
          label: t('mlearn.WordHover.Explain') || 'Explain',
          disabled: !detail.options?.canExplainPhrase,
        });
        setItems(readerItems);
        setResponseEvent('mlearn-reader-ctx-command');
        setOpen(true);
      }
    };

    window.addEventListener('mlearn-ctx-menu', handleCtxMenu);
    onCleanup(() => window.removeEventListener('mlearn-ctx-menu', handleCtxMenu));
  });

  const handleSelect = (id: string) => {
    const evt = responseEvent();
    if (evt) {
      window.dispatchEvent(new CustomEvent(evt, { detail: id }));
    }
    setOpen(false);
  };

  return (
    <MobileContextMenu
      items={items()}
      onSelect={handleSelect}
      onClose={() => setOpen(false)}
      open={open()}
    />
  );
};
