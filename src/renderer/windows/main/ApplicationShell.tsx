import { A, useLocation, useNavigate } from '@solidjs/router';
import { For, Show, onMount, onCleanup, type ParentComponent } from 'solid-js';
import { useLocalization } from '../../context';
import { LibraryLoadGuard } from '../../context/WindowWrapper';
import { getBridge } from '../../../shared/bridges';
import { isElectron } from '../../../shared/platform';
import { isApplicationNavigation } from '../../../shared/applicationNavigation';
import { LoadingOverlay } from './components/LoadingOverlay';
import './ApplicationShell.css';

export const ApplicationShell: ParentComponent = props => {
  const { t } = useLocalization();
  const location = useLocation();
  const navigate = useNavigate();
  const primary = [
    ['/', 'mlearn.Tabs.Home'], ['/reader', 'mlearn.Home.Today.Read'],
    ['/video', 'mlearn.Home.Today.Watch'], ['/messenger', 'mlearn.Product.Messenger'],
    ['/practise', 'mlearn.Product.Practise'], ['/evaluate', 'mlearn.Product.Evaluate'],
  ];
  const secondary = [['/plan', 'mlearn.Product.Plan'], ['/knowledge', 'mlearn.Product.Knowledge'], ['/progress', 'mlearn.Product.Progress']];
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext(context => {
      if (isApplicationNavigation(context)) {
        const request = context.applicationNavigation;
        navigate(request.path, { state: { applicationRequestId: request.requestId, applicationContext: request.context ?? {} } });
      }
    });
    if (isElectron()) bridge.window.getWindowContext('main');
    onCleanup(() => cleanup?.());
  });
  const link = (item: string[]) => <A href={item[0]} end={item[0] === '/'} activeClass="is-active">{t(item[1])}</A>;
  return <div class="application-shell" classList={{ 'application-shell-mobile': !isElectron() }}>
    <nav class="application-navigation" aria-label={t('mlearn.Product.Navigation')}>
      <div class="application-navigation-primary"><For each={primary}>{link}</For></div>
      <div class="application-navigation-secondary"><span>{t('mlearn.Product.MyLearning')}</span><For each={secondary}>{link}</For></div>
      <A href="/settings" activeClass="is-active">{t('mlearn.Settings.UI.Title')}</A>
    </nav>
    <div class="application-outlet">
      <Show when={location.pathname !== '/settings'}><LoadingOverlay /></Show>
      <LibraryLoadGuard recoveryAccess={location.pathname === '/settings'} />
      {props.children}
    </div>
  </div>;
};
