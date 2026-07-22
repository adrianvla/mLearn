/**
 * About Tab
 */

import { Component, createMemo, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { TabContent, Btn, ProgressBar, ToggleSwitch } from '../../../components/common';
import { useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import type { AppUpdateState } from '../../../../shared/appUpdate';
import { isElectron } from '../../../../shared/platform';
import './AboutTab.css';
import AppLogo from "@renderer/components/common/Misc/AppLogo";

export const AboutTab: Component = () => {
  const [version, setVersion] = createSignal('1.0.0');
  const [updateState, setUpdateState] = createSignal<AppUpdateState | null>(null);
  const { t } = useLocalization();
  const { settings, updateSetting } = useSettings();
  const supportsDesktopUpdates = isElectron();

  const acceptUpdateState = (nextState: AppUpdateState) => {
    setUpdateState((currentState) => (
      !currentState || nextState.updatedAt >= currentState.updatedAt ? nextState : currentState
    ));
  };

  onMount(() => {
    const bridge = getBridge();
    bridge.server.getVersion();
    const cleanup = bridge.server.onVersionReceive((version: string) => {
      setVersion(version);
    });
    const cleanupUpdateState = supportsDesktopUpdates
      ? bridge.updates.onUpdateStateChanged(acceptUpdateState)
      : undefined;
    if (supportsDesktopUpdates) void bridge.updates.getUpdateState().then(acceptUpdateState);
    onCleanup(() => {
      cleanup();
      cleanupUpdateState?.();
    });
  });

  const updateMessage = createMemo(() => {
    const state = updateState();
    if (!state) return t('mlearn.About.Updates.Idle');
    if (state.status === 'idle') {
      if (state.supportReason === 'development') return t('mlearn.About.Updates.Development');
      if (state.supportReason) return t('mlearn.About.Updates.ManualDownload');
      return t('mlearn.About.Updates.Idle');
    }
    if (state.status === 'checking') return t('mlearn.About.Updates.Checking');
    if (state.status === 'up-to-date') return t('mlearn.About.Updates.UpToDate');
    if (state.status === 'available') {
      if (!state.canAutoUpdate) return t('mlearn.About.Updates.ManualDownload');
      return t('mlearn.About.Updates.Available', { version: state.update.version });
    }
    if (state.status === 'downloading') {
      return t('mlearn.About.Updates.Downloading', {
        version: state.update.version,
      });
    }
    if (state.status === 'downloaded') {
      return t('mlearn.About.Updates.Ready', { version: state.update.version });
    }
    if (state.status === 'installing') {
      return t('mlearn.About.Updates.Installing', { version: state.update.version });
    }
    if (state.status === 'error') {
      if (state.operation === 'download') return t('mlearn.About.Updates.DownloadError');
      if (state.operation === 'install') return t('mlearn.About.Updates.InstallError');
      return t('mlearn.About.Updates.CheckError');
    }
    return t('mlearn.About.Updates.UpToDate');
  });
  const updateErrorOperation = createMemo(() => {
    const state = updateState();
    return state?.status === 'error' && state.retryable && state.canAutoUpdate && state.update
      ? state.operation
      : null;
  });
  const showCheckAction = createMemo(() => {
    const state = updateState();
    return !state
      || state.status === 'idle'
      || state.status === 'checking'
      || state.status === 'up-to-date'
      || (state.status === 'error' && state.operation === 'check');
  });
  const releaseNotes = createMemo(() => {
    const state = updateState();
    return state && 'update' in state ? state.update?.releaseNotes : undefined;
  });

  const runUpdateAction = async (action: 'check' | 'download' | 'install') => {
    const updates = getBridge().updates;
    const nextState = action === 'check'
      ? await updates.checkForUpdates(settings.automaticallyDownloadUpdates)
      : action === 'download'
        ? await updates.downloadUpdate()
        : await updates.installUpdate();
    acceptUpdateState(nextState);
  };

  const openDownloadPage = () => {
    const state = updateState();
    const url = state && 'update' in state
      ? state.update?.manualDownloadUrl
      : undefined;
    void getBridge().window.openExternalUrl(url ?? 'https://mlearn.kikan.net/download/auto/');
  };

  const openContact = () => {
    getBridge().window.showContact();
  };

  const openLicenses = () => {
    getBridge().window.openWindow({
      type: 'licenses',
      options: { width: 900, height: 700 },
    });
  };

  const openDiagnostics = () => {
    getBridge().window.openWindow({
      type: 'diagnostics',
      options: { width: 900, height: 700 },
    });
  };

  return (
    <TabContent padding="lg" class="about-tab">
      <div class="about-logo"><AppLogo/></div>
      
      <div class="about-version">
        <h2>{t('mlearn.About.Title')}</h2>
        <span>{t('mlearn.About.VersionLabel', { version: version() })}</span>
      </div>

      <div class="about-description">
        <p>
          {t('mlearn.About.Description')}
        </p>
      </div>

      <Show when={supportsDesktopUpdates}>
      <section class="about-updates">
        <div class="about-updates__heading">
          <div>
            <h3>{t('mlearn.About.Updates.Title')}</h3>
            <p role="status" aria-live="polite">{updateMessage()}</p>
          </div>
          <Show when={updateState()?.status === 'downloading'}>
            <strong>{Math.round((updateState() as Extract<AppUpdateState, { status: 'downloading' }>).progress.percent)}%</strong>
          </Show>
        </div>
        <Show when={updateState()?.status === 'downloading'}>
          <ProgressBar
            class="about-updates__progress"
            value={(updateState() as Extract<AppUpdateState, { status: 'downloading' }>).progress.percent}
            size="xs"
            variant="primary"
            aria-label={t('mlearn.About.Updates.Downloading', {
              version: updateState()?.availableVersion ?? '',
            })}
          />
        </Show>
        <Show when={releaseNotes()}>
          <details class="about-updates__notes">
            <summary>{t('mlearn.About.Updates.WhatsNew')}</summary>
            <p>{releaseNotes()}</p>
          </details>
        </Show>
        <div class="about-updates__actions">
          <Show when={showCheckAction()}>
            <Btn
              size="sm"
              variant="secondary"
              loading={updateState()?.status === 'checking'}
              onClick={() => void runUpdateAction('check')}
            >
              {t('mlearn.About.Updates.Check')}
            </Btn>
          </Show>
          <Show when={updateState()?.status === 'available' && updateState()?.canAutoUpdate}>
            <Btn size="sm" variant="primary" onClick={() => void runUpdateAction('download')}>
              {t('mlearn.About.Updates.Download')}
            </Btn>
          </Show>
          <Show when={updateErrorOperation() === 'download'}>
            <Btn size="sm" variant="primary" onClick={() => void runUpdateAction('download')}>
              {t('mlearn.About.Updates.Download')}
            </Btn>
          </Show>
          <Show when={updateErrorOperation() === 'install'}>
            <Btn size="sm" variant="primary" onClick={() => void runUpdateAction('install')}>
              {t('mlearn.About.Updates.Restart')}
            </Btn>
          </Show>
          <Show when={updateState()?.status === 'available' && !updateState()?.canAutoUpdate}>
            <Btn size="sm" variant="primary" onClick={openDownloadPage}>
              {t('mlearn.About.Updates.DownloadPage')}
            </Btn>
          </Show>
          <Show when={updateState()?.status === 'downloaded'}>
            <Btn size="sm" variant="primary" onClick={() => void runUpdateAction('install')}>
              {t('mlearn.About.Updates.Restart')}
            </Btn>
          </Show>
        </div>
        <Show when={updateState()?.canAutoUpdate}>
          <div class="about-updates__preference">
            <label for="automatic-update-downloads">
              <span>{t('mlearn.About.Updates.AutomaticDownloads')}</span>
              <small>{t('mlearn.About.Updates.AutomaticDownloadsDescription')}</small>
            </label>
            <ToggleSwitch
              id="automatic-update-downloads"
              checked={settings.automaticallyDownloadUpdates}
              onChange={(checked) => updateSetting('automaticallyDownloadUpdates', checked)}
            />
          </div>
        </Show>
      </section>
      </Show>

      <div class="about-links">
        <Btn variant="ghost" onClick={openContact}>
          {t('mlearn.About.Website')}
        </Btn>
        <Btn variant="ghost" onClick={openLicenses}>
          {t('mlearn.About.Licenses')}
        </Btn>
        <Show when={settings.devMode}>
          <Btn variant="ghost" onClick={openDiagnostics}>
            Run Diagnostics
          </Btn>
        </Show>
      </div>

      <div class="about-legal">
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/eula')}>
          End User License Agreement
        </Btn>
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/terms')}>
          Terms of Service
        </Btn>
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/privacy')}>
          Privacy Policy
        </Btn>
        <Btn variant="ghost" onClick={() => getBridge().window.openExternalUrl('https://mlearn.kikan.net/school-deployment')}>
          School Deployment
        </Btn>
      </div>

      <div class="about-shortcuts">
        <h3>{t('mlearn.About.KeyboardShortcuts.Title')}</h3>
        <div class="shortcuts-grid">
          <ShortcutRow shortcut="Space" description={t('mlearn.About.KeyboardShortcuts.Space')} />
          <ShortcutRow shortcut="←/→" description={t('mlearn.About.KeyboardShortcuts.LeftRight')} />
          <ShortcutRow shortcut="↑/↓" description={t('mlearn.About.KeyboardShortcuts.UpDown')} />
          <ShortcutRow shortcut="F" description={t('mlearn.About.KeyboardShortcuts.F')} />
          <ShortcutRow shortcut="M" description={t('mlearn.About.KeyboardShortcuts.M')} />
          <ShortcutRow shortcut="1-4" description={t('mlearn.About.KeyboardShortcuts.Numbers')} />
          <ShortcutRow shortcut="Cmd/Ctrl+Z" description={t('mlearn.About.KeyboardShortcuts.Undo')} />
        </div>
      </div>
    </TabContent>
  );
};

const ShortcutRow: Component<{ shortcut: string; description: string }> = (props) => (
  <div class="shortcut-row">
    <span class="shortcut-description">{props.description}</span>
    <kbd class="shortcut-key">{props.shortcut}</kbd>
  </div>
);
