import { useLocation, useNavigate } from '@solidjs/router';
import { Show, createEffect, onMount, onCleanup, type ParentComponent } from 'solid-js';
import { useLocalization } from '../../context';
import { Button, TabContainer } from '../../components/common';
import { LibraryLoadGuard } from '../../context/WindowWrapper';
import { getBridge } from '../../../shared/bridges';
import { isElectron } from '../../../shared/platform';
import { isApplicationNavigation, applicationHostForPath } from '../../../shared/applicationNavigation';
import { LoadingOverlay } from './components/LoadingOverlay';
import { currentApplicationHost, hasActiveMediaSource, useApplicationNavigate } from './applicationHost';
import { prepareMediaWorkspaceReturn } from './routes/mediaWorkspaceReturn';
import './ApplicationShell.css';

export const ApplicationShell: ParentComponent = props => {
  const { t } = useLocalization();
  const location = useLocation();
  const navigate = useNavigate();
  const open = useApplicationNavigate();
  const host = () => isElectron() ? currentApplicationHost() : applicationHostForPath(location.pathname);
  const links = () => !isElectron() && host() === 'study'
    ? [['/practise', 'mlearn.Product.Practise'], ['/evaluate', 'mlearn.Product.Evaluate']]
    : host() === 'my-learning'
      ? [['/plan', 'mlearn.Product.Plan'], ['/knowledge', 'mlearn.Product.Knowledge'], ['/progress', 'mlearn.Product.Progress']] : [];
  createEffect(() => {
    const label = host() === 'study' ? location.pathname.startsWith('/evaluate') ? 'mlearn.Product.Evaluate' : 'mlearn.Flashcards.UI.Title' : host() === 'my-learning' ? 'mlearn.Product.MyLearning' : host() === 'settings' ? 'mlearn.Settings.UI.Title' : host() === 'messenger' ? 'mlearn.Product.Messenger' : undefined;
    document.title = `${t('mlearn.Global.AppName')}${label ? ` · ${t(label)}` : ''}`;
  });
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext(context => {
      if (isApplicationNavigation(context)) {
        const request = context.applicationNavigation;
        if (location.pathname === request.path && Object.keys(request.context ?? {}).every(key => key === 'applicationPath')) return;
        if (request.context?.applicationReturn === true) {
          const source = request.context.sourceContext;
          if (source && typeof source === 'object' && !Array.isArray(source)) {
            if (location.pathname === request.path && hasActiveMediaSource(source as Record<string, unknown>)) return;
            prepareMediaWorkspaceReturn(sessionStorage, source as Record<string, unknown>);
          } else if (location.pathname === request.path) return;
        }
        navigate(request.path, { state: { applicationRequestId: request.requestId, applicationContext: request.context ?? {} } });
      }
    });
    if (isElectron()) bridge.window.getWindowContext(currentApplicationHost());
    onCleanup(() => cleanup?.());
  });
  return <div class="application-shell" classList={{ 'application-shell-mobile': !isElectron(), 'application-shell-study': host() === 'study', 'application-shell-native-chrome': isElectron() }}>
    <Show when={isElectron()}><div class="application-native-chrome" aria-hidden="true" /></Show>
    <Show when={links().length || (!isElectron() && location.pathname !== '/')}>
      <nav class="application-navigation" aria-label={t('mlearn.Product.Navigation')}>
        <Show when={!isElectron()}><Button buttonType="nav" onClick={() => open('/')}>{t('mlearn.Tabs.Home')}</Button></Show>
        <TabContainer
          idBase="workspace-navigation"
          tabs={links().map(([id, label]) => ({ id: id.slice(1), label: t(label) }))}
          activeTab={links().find(([path]) => location.pathname.startsWith(path))?.[0].slice(1) ?? ''}
          onTabChange={id => open(`/${id}`)}
          variant="underline"
          class="workspace-tabs"
        />
      </nav>
    </Show>
    <div class="application-outlet">
      <Show when={location.pathname !== '/settings'}><LoadingOverlay /></Show>
      <LibraryLoadGuard recoveryAccess={location.pathname === '/settings'} />
      {props.children}
    </div>
  </div>;
};
