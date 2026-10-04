/**
 * Main Window Entry Point
 * Uses SolidJS Router for welcome screen, video player, and reader routes
 */

import { render } from 'solid-js/web';
import { HashRouter } from '@solidjs/router';
import { createEffect } from 'solid-js';
import { WindowWrapper, useFlashcards, useLanguage, useServer } from '../../context';
import { ApplicationShell } from './ApplicationShell';
import { ApplicationRoutes } from './ApplicationRoutes';
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

const MainRoutes = () => <HashRouter root={ApplicationShell}><ApplicationRoutes /></HashRouter>;

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
      libraryLoadError: !!flashcards.libraryLoadError(),
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
  <WindowWrapper showDragRegion={false} showActiveGroupSwitch showWindowLoadingScreen={false} libraryGuard={false}>
    <WindowsMenuBar />
    <AppUpdateNotifier />
    <StartupReadiness />
    <MainRoutes />
  </WindowWrapper>
);

render(() => <App />, root);
