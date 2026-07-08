import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import App from './App';
import {
  OverviewPage,
  ServicesPage,
  LogsPage,
  ConfigPage,
  StoragePage,
  AiStatusPage,
  SchoolPage,
} from './pages';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  render(
    () => (
      <Router root={App}>
        <Route path="/" component={OverviewPage} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/logs" component={LogsPage} />
        <Route path="/config" component={ConfigPage} />
        <Route path="/storage" component={StoragePage} />
        <Route path="/ai-status" component={AiStatusPage} />
        <Route path="/school" component={SchoolPage} />
      </Router>
    ),
    root,
  );
}
