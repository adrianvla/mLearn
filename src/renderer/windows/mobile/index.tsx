/**
 * Mobile App Entry Point
 * Single-page SolidJS app with HashRouter and bottom tab navigation.
 * Reuses all existing components via WindowWrapper context providers.
 */

import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { initDebugLogger } from '../../utils/debugLogger';
import { WindowWrapper } from '../../context';
import { SyncProvider } from '../../context/SyncContext';
import { MobileLayout } from '../../components/mobile/MobileLayout/MobileLayout';
import { MobileContextMenuHandler } from '../../components/mobile/MobileContextMenu/MobileContextMenuHandler';
import { useCapacitorKeyboard } from '../../hooks/useCapacitorKeyboard';
import { LoadingOverlay } from '../main/components/LoadingOverlay';

// Initialize on-screen debug logger before anything else
initDebugLogger();

// Routes (lazy-loaded via dynamic import isn't needed — small enough)
import { WelcomeRoute } from '../main/routes/WelcomeRoute';
import { VideoRoute } from '../main/routes/VideoRoute';
import { ReaderRoute } from '../main/routes/ReaderRoute';

// Window-level apps imported as route components
import { FlashcardsContent } from './routes/FlashcardsRoute';
import { SettingsRoute } from './routes/SettingsRoute';
import { ConversationAgentRoute } from './routes/ConversationAgentRoute';
import { WordDbEditorRoute } from './routes/WordDbEditorRoute';
import { KanjiGridRoute } from './routes/KanjiGridRoute';
import { LicensesRoute } from './routes/LicensesRoute';
import { StatisticsRoute } from './routes/StatisticsRoute';

// Import global styles
import '../../styles/index.css';
import '../../styles/base.css';
import '../../styles/subtitle.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

const App = () => {
  useCapacitorKeyboard();

  return (
    <WindowWrapper showDragRegion={false}>
      <SyncProvider>
        <LoadingOverlay />
        <MobileContextMenuHandler />
        <HashRouter>
          <Route path="/" component={() => <MobileLayout><WelcomeRoute /></MobileLayout>} />
          <Route path="/video" component={() => <MobileLayout><VideoRoute /></MobileLayout>} />
          <Route path="/reader" component={() => <MobileLayout><ReaderRoute /></MobileLayout>} />
          <Route path="/flashcards" component={() => <MobileLayout><FlashcardsContent /></MobileLayout>} />
          <Route path="/settings" component={() => <MobileLayout><SettingsRoute /></MobileLayout>} />
          <Route path="/conversation-agent" component={() => <MobileLayout><ConversationAgentRoute /></MobileLayout>} />
          <Route path="/word-db-editor" component={() => <MobileLayout><WordDbEditorRoute /></MobileLayout>} />
          <Route path="/kanji-grid" component={() => <MobileLayout><KanjiGridRoute /></MobileLayout>} />
          <Route path="/statistics" component={() => <MobileLayout><StatisticsRoute /></MobileLayout>} />
          <Route path="/licenses" component={() => <MobileLayout><LicensesRoute /></MobileLayout>} />
        </HashRouter>
      </SyncProvider>
    </WindowWrapper>
  );
};

render(() => <App />, root);
