import { onCleanup, onMount } from 'solid-js';
import { getBridge } from '@shared/bridges';
import { useLocalization } from '../../../context/LocalizationContext';
import AppLogo from '../Misc/AppLogo';
import './WindowsMenuBar.css';

// Menu ids must match the ids in the app menu template (windowManager.ts);
// labels reuse the same locale keys, so both stay in sync.
const MENU_ITEMS = [
  { id: 'mlearn-menu-file', key: 'mlearn.Menu.File' },
  { id: 'mlearn-menu-edit', key: 'mlearn.Menu.Edit' },
  { id: 'mlearn-menu-view', key: 'mlearn.Menu.View' },
  { id: 'mlearn-menu-go', key: 'mlearn.Menu.Go' },
  { id: 'mlearn-menu-tools', key: 'mlearn.Menu.Tools' },
  { id: 'mlearn-menu-help', key: 'mlearn.Menu.Help' },
];

// Computed styles return rgb()/rgba(); the overlay API wants opaque hex.
function toHex(color: string): string | null {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (!match) return null;
  return `#${match
    .slice(1, 4)
    .map((v) => Number(v).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Windows title-bar menu strip: top-level menu labels with the native ─ □ ×
 * overlay controls drawn over the right edge (titleBarStyle hidden).
 */
export default function WindowsMenuBar() {
  const { t } = useLocalization();
  const bridge = getBridge();
  let stripRef: HTMLDivElement | undefined;

  // Mirror the strip's theme colors into the native overlay (main ignores off Windows).
  const syncOverlay = () => {
    const strip = stripRef;
    if (!strip) return;
    const styles = getComputedStyle(strip);
    const color = toHex(styles.backgroundColor);
    const symbolColor = toHex(styles.color);
    if (!color || !symbolColor) return;
    bridge.window.setTitleBarOverlay({ color, symbolColor });
  };

  onMount(() => {
    syncOverlay();
    // Themes switch via body.theme-{name}
    const observer = new MutationObserver(syncOverlay);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // Window fullscreen: hide the strip (body.window-fullscreen collapses
    // the --windows-menu-bar-height offsets to 0 in CSS)
    const cleanupFullscreen = bridge.window.onWindowFullscreenChange?.((isFullscreen) => {
      document.body.classList.toggle('window-fullscreen', isFullscreen);
    });
    onCleanup(() => {
      observer.disconnect();
      cleanupFullscreen?.();
      document.body.classList.remove('window-fullscreen');
    });
  });

  return (
    <div ref={stripRef} class="windows-menu-bar">
      <div class="windows-menu-logo">
        <AppLogo size="20px" />
      </div>
      {MENU_ITEMS.map((item) => (
        <button
          type="button"
          class="windows-menu-label"
          onClick={() => bridge.window.popupMenu(item.id)}
        >
          {t(item.key)}
        </button>
      ))}
    </div>
  );
}
