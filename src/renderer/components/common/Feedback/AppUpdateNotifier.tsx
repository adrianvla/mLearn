import { Component, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { AppUpdateState } from '../../../../shared/appUpdate';
import { getBridge } from '../../../../shared/bridges';
import { isElectron } from '../../../../shared/platform';
import { useLocalization } from '../../../context/LocalizationContext';
import { Btn } from '../Button';
import { ProgressBar } from './ProgressBar';
import { removeToast, showToast, updateToast } from './Toast';
import './AppUpdateNotifier.css';

interface AppUpdateToastContentProps {
  state: () => AppUpdateState | null;
}

const AppUpdateToastContent: Component<AppUpdateToastContentProps> = (props) => {
  const { t } = useLocalization();

  const download = () => {
    void getBridge().updates.downloadUpdate();
  };

  const install = () => {
    void getBridge().updates.installUpdate();
  };

  const openDownloadPage = () => {
    const state = props.state();
    const url = state && 'update' in state
      ? state.update?.manualDownloadUrl
      : undefined;
    void getBridge().window.openExternalUrl(url ?? 'https://mlearn.kikan.net/download/auto/');
  };

  return (
    <Show when={props.state()}>
      {(stateAccessor) => {
        const state = () => stateAccessor();
        return (
          <div class="app-update-toast__body">
            <Show when={state().status === 'available'}>
              <p>
                {state().canAutoUpdate
                  ? t('mlearn.About.Updates.Available', { version: state().availableVersion ?? '' })
                  : t('mlearn.About.Updates.ManualDownload')}
              </p>
              <Btn size="sm" variant="primary" onClick={state().canAutoUpdate ? download : openDownloadPage}>
                {state().canAutoUpdate
                  ? t('mlearn.About.Updates.Download')
                  : t('mlearn.About.Updates.DownloadPage')}
              </Btn>
            </Show>
            <Show when={state().status === 'downloading'}>
              <p>
                {t('mlearn.About.Updates.Downloading', {
                  version: state().availableVersion ?? '',
                })}
              </p>
              <ProgressBar
                class="app-update-toast__progress"
                value={(state() as Extract<AppUpdateState, { status: 'downloading' }>).progress.percent}
                size="xs"
                variant="primary"
                aria-label={t('mlearn.About.Updates.Downloading', {
                  version: state().availableVersion ?? '',
                })}
              />
            </Show>
            <Show when={state().status === 'downloaded'}>
              <p>{t('mlearn.About.Updates.Ready', { version: state().availableVersion ?? '' })}</p>
              <Btn size="sm" variant="primary" onClick={install}>
                {t('mlearn.About.Updates.Restart')}
              </Btn>
            </Show>
            <Show when={state().status === 'error'}>
              <p>
                {(state() as Extract<AppUpdateState, { status: 'error' }>).operation === 'install'
                  ? t('mlearn.About.Updates.InstallError')
                  : t('mlearn.About.Updates.DownloadError')}
              </p>
              <Show
                when={(state() as Extract<AppUpdateState, { status: 'error' }>).retryable
                  && state().canAutoUpdate
                  && 'update' in state()
                  && (state() as Extract<AppUpdateState, { status: 'error' }>).update}
                fallback={
                  <Btn size="sm" variant="secondary" onClick={openDownloadPage}>
                    {t('mlearn.About.Updates.DownloadPage')}
                  </Btn>
                }
              >
                <Btn
                  size="sm"
                  variant="secondary"
                  onClick={(state() as Extract<AppUpdateState, { status: 'error' }>).operation === 'install' ? install : download}
                >
                  {(state() as Extract<AppUpdateState, { status: 'error' }>).operation === 'install'
                    ? t('mlearn.About.Updates.Restart')
                    : t('mlearn.About.Updates.Download')}
                </Btn>
              </Show>
            </Show>
          </div>
        );
      }}
    </Show>
  );
};

export const AppUpdateNotifier: Component = () => {
  const { t } = useLocalization();
  const [state, setState] = createSignal<AppUpdateState | null>(null);
  let toastId: number | null = null;
  let toastPresentation: string | null = null;
  let dismissedPresentation: string | null = null;

  const acceptState = (nextState: AppUpdateState) => {
    setState((currentState) => (
      !currentState || nextState.updatedAt >= currentState.updatedAt ? nextState : currentState
    ));
  };

  const closeToast = () => {
    if (toastId !== null) removeToast(toastId);
    toastId = null;
    toastPresentation = null;
    dismissedPresentation = null;
  };

  onMount(() => {
    if (!isElectron()) return;
    const updates = getBridge().updates;
    const cleanup = updates.onUpdateStateChanged(acceptState);
    void updates.getUpdateState().then(acceptState);
    onCleanup(() => {
      cleanup();
      closeToast();
    });
  });

  createEffect(() => {
    const nextState = state();
    const visible = nextState?.status === 'available'
      || nextState?.status === 'downloading'
      || nextState?.status === 'downloaded'
      || (nextState?.status === 'error'
        && (nextState.operation === 'download' || nextState.operation === 'install'));

    if (!visible) {
      closeToast();
      return;
    }

    const downloaded = nextState.status === 'downloaded';
    const failed = nextState.status === 'error';
    const title = failed
      ? t('mlearn.About.Updates.UpdateFailedTitle')
      : downloaded
        ? t('mlearn.About.Updates.ReadyTitle')
        : t('mlearn.About.Updates.AvailableTitle');
    const variant = failed ? 'error' : downloaded ? 'success' : 'info';
    const nextPresentation = `${variant}:${title}`;

    if (toastId === null) {
      if (dismissedPresentation === nextPresentation) return;
      toastId = showToast({
        variant,
        title,
        content: <AppUpdateToastContent state={state} />,
        duration: 0,
        class: 'app-update-toast',
        onDismiss: () => {
          toastId = null;
          toastPresentation = null;
          dismissedPresentation = nextPresentation;
        },
      });
      toastPresentation = nextPresentation;
      dismissedPresentation = null;
      return;
    }

    if (toastPresentation === nextPresentation) return;

    updateToast(toastId, {
      variant,
      title,
      duration: 0,
    });
    toastPresentation = nextPresentation;
  });

  return null;
};
