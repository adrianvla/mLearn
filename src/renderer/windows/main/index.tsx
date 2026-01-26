/**
 * Main Window Entry Point
 * Uses SolidJS Router for welcome screen, video player, and reader routes
 */

import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { WindowWrapper } from '../../context';
import { LoadingOverlay } from './components/LoadingOverlay';
import { WelcomeRoute } from './routes/WelcomeRoute';
import { VideoRoute } from './routes/VideoRoute';
import { ReaderRoute } from './routes/ReaderRoute';

// Import global styles
import '../../styles/index.css';
import '../../styles/subtitle.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

const App = () => (
  <WindowWrapper>
    <LoadingOverlay />
    <HashRouter>
      <Route path="/" component={WelcomeRoute} />
      <Route path="/video" component={VideoRoute} />
      <Route path="/reader" component={ReaderRoute} />
    </HashRouter>
  </WindowWrapper>
);

render(() => <App />, root);
