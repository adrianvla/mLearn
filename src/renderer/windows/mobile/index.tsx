/**
 * Mobile App Entry Point
 * Single-page SolidJS app with HashRouter and bottom tab navigation.
 * Reuses all existing components via WindowWrapper context providers.
 */

import { render } from 'solid-js/web';
import { HashRouter } from '@solidjs/router';
import { initDebugLogger } from '../../utils/debugLogger';
import { WindowWrapper } from '../../context';
import { SyncProvider } from '../../context/SyncContext';
import { MobileContextMenuHandler } from '../../components/mobile/MobileContextMenu/MobileContextMenuHandler';
import { useCapacitorKeyboard } from '../../hooks/useCapacitorKeyboard';

// Initialize on-screen debug logger before anything else
initDebugLogger();

import { ApplicationRoutes } from '../main/ApplicationRoutes';
import { ApplicationShell } from '../main/ApplicationShell';
// Import global styles
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

const App = () => {
  useCapacitorKeyboard();

  return (
    <WindowWrapper showDragRegion={false} showActiveGroupSwitch libraryGuard={false}>
      <SyncProvider>
        <MobileContextMenuHandler />
        <HashRouter root={ApplicationShell}><ApplicationRoutes /></HashRouter>
      </SyncProvider>
    </WindowWrapper>
  );
};

render(() => <App />, root);
