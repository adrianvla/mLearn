/**
 * Browser Extension Settings Component
 * Detects browsers, shows install status, provides manual fallback instructions
 */

import { Component, createSignal, onMount, onCleanup, Show, For } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import {
  SettingRow,
  SettingGroup,
  Btn,
  Select,
  TabContent,
  EmptyState,
  Spinner,
  AlertBanner,
  Indicator,
} from '../common';
import { showToast } from '../common/Feedback/Toast';
import { getBridge } from '../../../shared/bridges';
import type { BrowserInfo, CustomBrowserPath } from '../../../shared/bridges/types';
import './BrowserExtensionSettings.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger('renderer.settings.browser-extension');

type InstallStatus = 'idle' | 'installing' | 'success' | 'error';

interface BrowserInstallState {
  browser: BrowserInfo;
  status: InstallStatus;
  error?: string;
  installPath?: string;
  extensionPath?: string;
}

const BROWSER_TYPE_OPTIONS = [
  { value: 'chrome', label: 'Chromium (Chrome, Edge, Brave, etc.)' },
  { value: 'firefox', label: 'Firefox (Firefox, Zen, LibreWolf, etc.)' },
];

export const BrowserExtensionSettings: Component = () => {
  const { t } = useLocalization();
  const { settings, updateSetting } = useSettings();
  const [browsers, setBrowsers] = createSignal<BrowserInstallState[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [customPathType, setCustomPathType] = createSignal<'chrome' | 'firefox'>('chrome');
  const [customPaths, setCustomPaths] = createSignal<CustomBrowserPath[]>([]);
  const [connectionStatus, setConnectionStatus] = createSignal<'connected' | 'disconnected'>('disconnected');
  const [detectError, setDetectError] = createSignal<string | null>(null);

  const loadBrowsers = async () => {
    setLoading(true);
    setDetectError(null);
    try {
      const detected = await getBridge().browser.detectBrowsers(customPaths());
      const installedPaths = new Set(settings.installedBrowserExtensions);

      const browserStates = await Promise.all(
        detected.map(async (browser) => {
          const wasInstalled = installedPaths.has(browser.path);
          let status: InstallStatus = 'idle';

          if (wasInstalled && browser.profilePath) {
            try {
              const check = await getBridge().browser.isExtensionInstalled(browser);
              status = check.installed ? 'success' : 'idle';
            } catch (e) {
              log.warn(`Failed to check extension status for ${browser.name}:`, e);
              status = 'idle';
            }
          }

          return {
            browser,
            status,
          };
        }),
      );

      setBrowsers(browserStates);
    } catch (e) {
      log.error('Failed to detect browsers:', e);
      setDetectError(t('mlearn.BrowserExtension.DetectError'));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadBrowsers();

    const checkConnection = async () => {
      try {
        const response = await fetch('http://127.0.0.1:7753/api/ping', { method: 'GET' });
        setConnectionStatus(response.ok ? 'connected' : 'disconnected');
      } catch {
        setConnectionStatus('disconnected');
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 5000);

    onCleanup(() => clearInterval(interval));
  });

  const addInstalledBrowser = (browserPath: string) => {
    const current = settings.installedBrowserExtensions;
    if (!current.includes(browserPath)) {
      updateSetting('installedBrowserExtensions', [...current, browserPath]);
    }
  };

  const removeInstalledBrowser = (browserPath: string) => {
    const current = settings.installedBrowserExtensions;
    updateSetting(
      'installedBrowserExtensions',
      current.filter((p) => p !== browserPath),
    );
  };

  const handleInstall = async (index: number) => {
    const current = browsers();
    const item = current[index];
    if (!item) return;

    const next = [...current];
    next[index] = { ...item, status: 'installing', error: undefined, extensionPath: undefined };
    setBrowsers(next);

    try {
      const result = await getBridge().browser.installExtension(item.browser);
      const updated = [...browsers()];
      if (result.success) {
        updated[index] = { ...updated[index], status: 'success', installPath: result.path };
        addInstalledBrowser(item.browser.path);
      } else {
        updated[index] = {
          ...updated[index],
          status: 'error',
          error: result.error || t('mlearn.BrowserExtension.InstallFailed'),
          extensionPath: result.extensionPath,
        };
      }
      setBrowsers(updated);
    } catch (e) {
      log.error('Install failed:', e);
      const updated = [...browsers()];
      updated[index] = {
        ...updated[index],
        status: 'error',
        error: t('mlearn.BrowserExtension.InstallFailed'),
      };
      setBrowsers(updated);
    }
  };

  const handleUninstall = async (index: number) => {
    const current = browsers();
    const item = current[index];
    if (!item) return;

    const next = [...current];
    next[index] = { ...item, status: 'installing', error: undefined };
    setBrowsers(next);

    try {
      const result = await getBridge().browser.uninstallExtension(item.browser);
      const updated = [...browsers()];
      if (result.success) {
        updated[index] = { ...updated[index], status: 'idle' };
        removeInstalledBrowser(item.browser.path);
      } else {
        updated[index] = {
          ...updated[index],
          status: 'error',
          error: result.error || t('mlearn.BrowserExtension.UninstallFailed'),
        };
      }
      setBrowsers(updated);
    } catch (e) {
      log.error('Uninstall failed:', e);
      const updated = [...browsers()];
      updated[index] = {
        ...updated[index],
        status: 'error',
        error: t('mlearn.BrowserExtension.UninstallFailed'),
      };
      setBrowsers(updated);
    }
  };

  const handleBrowseBrowser = async () => {
    try {
      const path = await getBridge().files.selectBrowserFile();
      if (!path) return;
      if (customPaths().some((c) => c.path === path)) return;

      setCustomPaths((prev) => [...prev, { path, type: customPathType() }]);
      loadBrowsers();
    } catch (e) {
      log.error('Failed to browse for browser:', e);
    }
  };

  const handleRemoveCustomPath = (path: string) => {
    setCustomPaths((prev) => prev.filter((c) => c.path !== path));
    loadBrowsers();
  };

  const getBrowserIcon = (type: BrowserInfo['type']) => {
    switch (type) {
      case 'chrome':
        return '🌐';
      case 'firefox':
        return '🦊';
      default:
        return '🔍';
    }
  };

  const getInstallLabel = (status: InstallStatus) => {
    switch (status) {
      case 'installing':
        return t('mlearn.BrowserExtension.Installing');
      case 'success':
        return t('mlearn.BrowserExtension.Installed');
      case 'error':
        return t('mlearn.BrowserExtension.Retry');
      default:
        return t('mlearn.BrowserExtension.Install');
    }
  };

  const handleOpenExtensionFolder = async () => {
    try {
      const success = await getBridge().browser.openExtensionFolder();
      if (success) {
        showToast({ variant: 'success', message: t('mlearn.BrowserExtension.OpenExtensionFolderSuccess') });
      } else {
        showToast({ variant: 'error', message: t('mlearn.BrowserExtension.OpenExtensionFolderFailed') });
      }
    } catch (e) {
      log.error('Failed to open extension folder:', e);
      showToast({ variant: 'error', message: t('mlearn.BrowserExtension.OpenExtensionFolderFailed') });
    }
  };

  const handleCopyExtensionPath = (extensionPath: string) => {
    getBridge().files.writeToClipboard(extensionPath);
  };

  return (
    <TabContent
      header={{
        title: t('mlearn.BrowserExtension.Title'),
        description: t('mlearn.BrowserExtension.Description'),
        icon: <span class="browser-extension-header-icon">🔗</span>,
      }}
      padding="lg"
    >
      <SettingGroup title={t('mlearn.BrowserExtension.Title')}>
        <SettingRow
          label={t('mlearn.BrowserExtension.OpenExtensionFolder')}
          description={t('mlearn.BrowserExtension.ManualInstallHint')}
        >
          <Btn size="sm" onClick={handleOpenExtensionFolder}>
            {t('mlearn.BrowserExtension.OpenExtensionFolder')}
          </Btn>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.BrowserExtension.DetectedBrowsers')}>
        <Show when={loading()}>
          <div class="browser-extension-loading">
            <Spinner size={24} />
            <span>{t('mlearn.BrowserExtension.Detecting')}</span>
          </div>
        </Show>

        <Show when={!loading() && detectError()}>
          <AlertBanner variant="error" message={detectError() || ''} />
        </Show>

        <Show when={!loading() && browsers().length === 0 && !detectError()}>
          <EmptyState
            title={t('mlearn.BrowserExtension.NoBrowsers')}
            description={t('mlearn.BrowserExtension.NoBrowsersHint')}
          />
        </Show>

        <Show when={!loading() && browsers().length > 0}>
          <div class="browser-list">
            <For each={browsers()}>
              {(item, index) => (
                <div class="browser-item">
                  <div class="browser-info">
                    <span class="browser-icon">{getBrowserIcon(item.browser.type)}</span>
                    <div class="browser-details">
                      <span class="browser-name">{item.browser.name}</span>
                      <span class="browser-path">{item.browser.path}</span>
                      <Show when={item.browser.profilePath}>
                        <span class="browser-profile">{item.browser.profilePath}</span>
                      </Show>
                      <Show when={item.status === 'success' && item.installPath}>
                        <span class="browser-install-path">
                          {t('mlearn.BrowserExtension.InstalledAt')}: {item.installPath}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="browser-actions">
                    <Show
                      when={item.status === 'success'}
                      fallback={
                        <Btn
                          size="sm"
                          onClick={() => handleInstall(index())}
                          disabled={item.status === 'installing'}
                          variant={
                            item.status === 'error' ? 'danger' : 'default'
                          }
                        >
                          {getInstallLabel(item.status)}
                        </Btn>
                      }
                    >
                      <Btn
                        size="sm"
                        variant="danger"
                        onClick={() => handleUninstall(index())}
                        disabled={item.status === 'installing'}
                      >
                        {t('mlearn.BrowserExtension.Uninstall')}
                      </Btn>
                    </Show>
                  </div>
                  <Show when={item.status === 'error'}>
                    <div class="browser-install-error">
                      <span class="error-text">{item.error}</span>
                      <div class="manual-install-guide">
                        <p class="manual-install-hint">{t('mlearn.BrowserExtension.ManualInstallHint')}</p>
                        <ol class="manual-install-steps">
                          <li>{t('mlearn.BrowserExtension.Step1')}</li>
                          <li>{t('mlearn.BrowserExtension.Step2')}</li>
                          <li>{t('mlearn.BrowserExtension.Step3')}</li>
                          <li>{t('mlearn.BrowserExtension.Step4')}</li>
                        </ol>
                      </div>
                      <div class="manual-install-actions">
                        <Btn size="sm" onClick={handleOpenExtensionFolder}>
                          {t('mlearn.BrowserExtension.OpenExtensionFolder')}
                        </Btn>
                        <Show when={item.extensionPath}>
                          <Btn
                            size="sm"
                            variant="secondary"
                            onClick={() => handleCopyExtensionPath(item.extensionPath!)}
                          >
                            {t('mlearn.BrowserExtension.CopyExtensionPath')}
                          </Btn>
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.BrowserExtension.CustomPath')}>
        <SettingRow label={t('mlearn.BrowserExtension.CustomPathLabel')} style={{ "flex-direction": 'column', "align-items": 'flex-start' }}>
          <div class="custom-path-row">
            <Select
              class="custom-path-type-select"
              value={customPathType()}
              options={BROWSER_TYPE_OPTIONS}
              onChange={(e) =>
                setCustomPathType(e.currentTarget.value as 'chrome' | 'firefox')
              }
            />
            <Btn size="sm" onClick={handleBrowseBrowser}>
              {t('mlearn.BrowserExtension.Browse')}
            </Btn>
          </div>
          <span class="custom-path-hint">
            {t('mlearn.BrowserExtension.CustomPathHint')}
          </span>
        </SettingRow>

        <Show when={customPaths().length > 0}>
          <div class="custom-paths-list">
            <For each={customPaths()}>
              {(custom) => (
                <div class="custom-path-item">
                  <span class="custom-path-text">
                    {custom.path}
                    <span class="custom-path-badge">
                      {custom.type === 'chrome'
                        ? 'Chromium'
                        : 'Firefox'}
                    </span>
                  </span>
                  <Btn
                    size="sm"
                    variant="danger"
                    onClick={() => handleRemoveCustomPath(custom.path)}
                  >
                    {t('mlearn.Global.Remove')}
                  </Btn>
                </div>
              )}
            </For>
          </div>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.BrowserExtension.ConnectionStatus')}>
        <SettingRow label={t('mlearn.BrowserExtension.ExtensionStatus')}>
          <div class="connection-status-row">
            <Indicator
              variant={connectionStatus() === 'connected' ? 'success' : 'error'}
              size="sm"
            />
            <span class="connection-status-text">
              {connectionStatus() === 'connected'
                ? t('mlearn.BrowserExtension.Connected')
                : t('mlearn.BrowserExtension.Disconnected')}
            </span>
          </div>
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};

export default BrowserExtensionSettings;
