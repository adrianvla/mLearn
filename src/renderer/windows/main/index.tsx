/**
 * Main Window Entry Point
 * Uses SolidJS Router for welcome screen, video player, and reader routes
 */

import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { WindowWrapper } from '../../context';
import { WelcomeRoute } from './routes/WelcomeRoute';
import { VideoRoute } from './routes/VideoRoute';
import { ReaderRoute } from './routes/ReaderRoute';

// Import global styles
import '../../styles/index.css';
import '../../styles/glass.css';
import '../../styles/subtitle.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

const App = () => (
  <WindowWrapper>
    <Router>
      <Route path="/" component={WelcomeRoute} />
      <Route path="/video" component={VideoRoute} />
      <Route path="/reader" component={ReaderRoute} />
    </Router>
  </WindowWrapper>
);

render(() => <App />, root);
