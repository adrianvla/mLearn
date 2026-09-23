/**
 * Main Window Entry Point
 * Uses SolidJS Router for welcome screen, video player, and reader routes
 */

import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { createEffect, createMemo, Show } from 'solid-js';
import { WindowWrapper, useFlashcards, useLanguage, useServer, useSettings } from '../../context';
import { LoadingOverlay } from './components/LoadingOverlay';
import { WelcomeRoute } from './routes/WelcomeRoute';
import { VideoRoute } from './routes/VideoRoute';
import { ReaderRoute } from './routes/ReaderRoute';
import { shouldMountMainRoutes } from './mainRouteReadiness';
import { AppUpdateNotifier } from '../../components/common/Feedback/AppUpdateNotifier';
import WindowsMenuBar from '../../components/common/WindowsMenuBar/WindowsMenuBar';
import { getBridge } from '../../../shared/bridges';
import { isElectron } from '../../../shared/platform';
import { startupRendererState } from './startupReadiness';

// Import global styles
import '../../styles/index.css';
import '../../styles/base.css';

import { installPerfObserverCounters } from '../../utils/perfCounters';
const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

installPerfObserverCounters();

const MainRoutes = () => {
  const server = useServer();
  const settings = useSettings();
  const language = useLanguage();
  const canMountRoutes = createMemo(() => shouldMountMainRoutes({
    serverConnected: server.isConnected(),
    settingsLoading: settings.isLoading(),
    languageLoading: language.isLoading(),
  }));

  return (
    <Show when={canMountRoutes()}>
      <HashRouter>
        <Route path="/" component={WelcomeRoute} />
        <Route path="/video" component={VideoRoute} />
        <Route path="/reader" component={ReaderRoute} />
      </HashRouter>
    </Show>
  );
};

const StartupReadiness = () => {
  const server = useServer();
  const language = useLanguage();
  const flashcards = useFlashcards();
  let lastState: string | undefined;

  createEffect(() => {
    if (!isElectron()) return;
    const state = startupRendererState({
      languageLoading: language.isLoading(),
      libraryLoading: flashcards.isLoading(),
      knowledgeReady: flashcards.isKnowledgeReady(),
      serverStatus: server.status(),
    });
    if (state !== lastState) {
      lastState = state;
      getBridge().window.reportStartupState(state);
    }
  });
  return null;
};

const App = () => (
  <WindowWrapper showDragRegion={false} showActiveGroupSwitch showWindowLoadingScreen={false}>
    <WindowsMenuBar />
    <AppUpdateNotifier />
    <LoadingOverlay />
    <StartupReadiness />
    <MainRoutes />
  </WindowWrapper>
);

render(() => <App />, root);
