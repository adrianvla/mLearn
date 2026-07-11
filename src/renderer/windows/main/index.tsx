/**
 * Main Window Entry Point
 * Uses SolidJS Router for welcome screen, video player, and reader routes
 */

import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { createMemo, Show } from 'solid-js';
import { WindowWrapper, useLanguage, useServer, useSettings } from '../../context';
import { LoadingOverlay } from './components/LoadingOverlay';
import { WelcomeRoute } from './routes/WelcomeRoute';
import { VideoRoute } from './routes/VideoRoute';
import { ReaderRoute } from './routes/ReaderRoute';
import { shouldMountMainRoutes } from './mainRouteReadiness';

// Import global styles
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

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

const App = () => (
  <WindowWrapper showDragRegion={false} showActiveGroupSwitch>
    <LoadingOverlay />
    <MainRoutes />
  </WindowWrapper>
);

render(() => <App />, root);
