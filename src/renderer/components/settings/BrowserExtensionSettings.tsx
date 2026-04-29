/**
 * Browser Extension Settings Component
 * Detects browsers, shows install status, provides manual fallback instructions
 */

import { Component, createSignal, onMount, Show, For } from 'solid-js';
import { useLocalization } from '../../context';
import {
  SettingRow,
  SettingGroup,
  Btn,
  Input,
  TabContent,
  EmptyState,
  Spinner,
  AlertBanner,
  Indicator,
} from '../common';
import { getBridge } from '../../../shared/bridges';
import type { BrowserInfo } from '../../../shared/bridges/types';
import './BrowserExtensionSettings.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger('renderer.settings.browser-extension');

type InstallStatus = 'idle' | 'installing' | 'success' | 'error';

interface BrowserInstallState {
  browser: BrowserInfo;
  status: InstallStatus;
  error?: string;
}

export const BrowserExtensionSettings: Component = () => {
  const { t } = useLocalization();
  const [browsers, setBrowsers] = createSignal<BrowserInstallState[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [customPath, setCustomPath] = createSignal('');
  const [customPaths, setCustomPaths] = createSignal<string[]>([]);
  const [connectionStatus] = createSignal<'connected' | 'disconnected'>('disconnected');
  const [detectError, setDetectError] = createSignal<string | null>(null);

  const loadBrowsers = async () => {
    setLoading(true);
    setDetectError(null);
    try {
      const detected = await getBridge().browser.detectBrowsers(customPaths());
      setBrowsers(
        detected.map((b) => ({
          browser: b,
          status: 'idle' as InstallStatus,
        })),
      );
    } catch (e) {
      log.error('Failed to detect browsers:', e);
      setDetectError(t('mlearn.BrowserExtension.DetectError'));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadBrowsers();
  });

  const handleInstall = async (index: number) => {
    const current = browsers();
    const item = current[index];
    if (!item) return;

    const next = [...current];
    next[index] = { ...item, status: 'installing', error: undefined };
    setBrowsers(next);

    try {
      const result = await getBridge().browser.installExtension(item.browser);
      const updated = [...browsers()];
      if (result.success) {
        updated[index] = { ...updated[index], status: 'success' };
      } else {
        updated[index] = {
          ...updated[index],
          status: 'error',
          error: result.error || t('mlearn.BrowserExtension.InstallFailed'),
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

  const handleAddCustomPath = () => {
    const path = customPath().trim();
    if (!path) return;
    if (customPaths().includes(path)) return;
    setCustomPaths((prev) => [...prev, path]);
    setCustomPath('');
    loadBrowsers();
  };

  const handleRemoveCustomPath = (path: string) => {
    setCustomPaths((prev) => prev.filter((p) => p !== path));
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

  const getManualInstructions = (type: BrowserInfo['type']) => {
    if (type === 'chrome') {
      return t('mlearn.BrowserExtension.ManualChrome');
    }
    if (type === 'firefox') {
      return t('mlearn.BrowserExtension.ManualFirefox');
    }
    return t('mlearn.BrowserExtension.ManualUnknown');
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
      {/* ── Detected Browsers ── */}
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
                    </div>
                  </div>
                  <div class="browser-actions">
                    <Btn
                      size="sm"
                      onClick={() => handleInstall(index())}
                      disabled={item.status === 'installing'}
                      variant={item.status === 'success' ? 'success' : item.status === 'error' ? 'danger' : 'default'}
                    >
                      {getInstallLabel(item.status)}
                    </Btn>
                  </div>
                  <Show when={item.status === 'error'}>
                    <div class="browser-install-error">
                      <span class="error-text">{item.error}</span>
                      <div class="manual-instructions">
                        <strong>{t('mlearn.BrowserExtension.ManualTitle')}</strong>
                        <p>{getManualInstructions(item.browser.type)}</p>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </SettingGroup>

      {/* ── Custom Browser Path ── */}
      <SettingGroup title={t('mlearn.BrowserExtension.CustomPath')}>
        <SettingRow label={t('mlearn.BrowserExtension.CustomPathLabel')}>
          <div class="custom-path-row">
            <Input
              class="custom-path-input"
              value={customPath()}
              onInput={(e) => setCustomPath(e.currentTarget.value)}
              placeholder={t('mlearn.BrowserExtension.CustomPathPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCustomPath();
              }}
            />
            <Btn size="sm" onClick={handleAddCustomPath} disabled={!customPath().trim()}>
              {t('mlearn.Global.Add')}
            </Btn>
          </div>
        </SettingRow>

        <Show when={customPaths().length > 0}>
          <div class="custom-paths-list">
            <For each={customPaths()}>
              {(path) => (
                <div class="custom-path-item">
                  <span class="custom-path-text">{path}</span>
                  <Btn size="sm" variant="danger" onClick={() => handleRemoveCustomPath(path)}>
                    {t('mlearn.Global.Remove')}
                  </Btn>
                </div>
              )}
            </For>
          </div>
        </Show>
      </SettingGroup>

      {/* ── Extension Connection Status ── */}
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
