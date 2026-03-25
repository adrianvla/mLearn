/**
 * Connection Settings Tab
 * Configure backend mode (Local / Tethered) and connection testing for mobile tethering.
 */

import { Component, Show, createSignal, onCleanup } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText, LinkIcon, ToggleSwitch } from '../../../components/common';
import { isMobile } from '../../../../shared/platform';
import { DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL, getBackend, resetBackend } from '../../../../shared/backends';
import { getNodeServer } from '../../../../shared/backends/nodeServerAdapter';
import { getBridge } from '../../../../shared/bridges';
import { exchangeCloudDesktopCode, getCloudDashboardUrl, startCloudDesktopLogin } from '../../../services/cloudAuthService';
import type { SelectOption } from '../../../components/common';
import './ConnectionTab.css';

type BackendMode = 'local' | 'tethered';

export const ConnectionTab: Component = () => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();
  // Test connection state
  const [testingBackend, setTestingBackend] = createSignal(false);
  const [backendStatus, setBackendStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [, setBackendError] = createSignal('');

  const [testingNode, setTestingNode] = createSignal(false);
  const [nodeStatus, setNodeStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [, setNodeError] = createSignal('');
  const [cloudLoginPending, setCloudLoginPending] = createSignal(false);
  const [pendingState, setPendingState] = createSignal('');
  const [pendingVerifier, setPendingVerifier] = createSignal('');
  const [manualDesktopCode, setManualDesktopCode] = createSignal('');

  // Backend mode options — hide 'local' on mobile
  const modeOptions = (): SelectOption[] => {
    const opts: SelectOption[] = [];
    if (!isMobile()) {
      opts.push({ value: 'local', label: t('mlearn.Connection.ModeLocal') || 'Local' });
    }
    opts.push(
      { value: 'tethered', label: t('mlearn.Connection.ModeTethered') || 'Tethered' },
    );
    return opts;
  };

  async function handleTestBackend() {
    setTestingBackend(true);
    setBackendStatus('idle');
    setBackendError('');
    try {
      resetBackend();
      const backend = getBackend({
        mode: settings.backendMode as BackendMode,
        url: settings.backendUrl,
        authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
      });
      const ok = await backend.ping();
      setBackendStatus(ok ? 'success' : 'error');
      if (!ok) setBackendError(t('mlearn.Connection.Unreachable') || 'Unreachable');
    } catch (e) {
      console.error(e);
      setBackendStatus('error');
      setBackendError(String(e));
    } finally {
      setTestingBackend(false);
    }
  }

  async function handleTestNodeServer() {
    setTestingNode(true);
    setNodeStatus('idle');
    setNodeError('');
    try {
      const server = getNodeServer(settings.nodeServerUrl);
      const ok = await server.ping();
      setNodeStatus(ok ? 'success' : 'error');
      if (!ok) setNodeError(t('mlearn.Connection.Unreachable') || 'Unreachable');
    } catch (e) {
      console.error(e);
      setNodeStatus('error');
      setNodeError(String(e));
    } finally {
      setTestingNode(false);
    }
  }

  async function handleCloudSignIn() {
    setBackendError('');
    setCloudLoginPending(true);
    try {
      const login = await startCloudDesktopLogin(settings);
      setPendingState(login.state);
      setPendingVerifier(login.codeVerifier);
      await getBridge().window.openExternalUrl(login.loginUrl);
    } catch (e) {
      console.error(e);
      setBackendStatus('error');
      setBackendError(String(e));
      setCloudLoginPending(false);
    }
  }

  function handleCloudSignOut() {
    updateSetting('cloudAuthAccessToken', '');
    updateSetting('cloudAuthRefreshToken', '');
    updateSetting('cloudAuthUserId', '');
    updateSetting('cloudAuthUserEmail', '');
    updateSetting('cloudAuthExpiresAt', 0);
    updateSetting('cloudAuthStatus', 'signed-out');
    setPendingState('');
    setPendingVerifier('');
    setCloudLoginPending(false);
  }

  async function handleOpenDashboard() {
    await getBridge().window.openExternalUrl(getCloudDashboardUrl(settings));
  }

  async function handleCompleteManualSignIn() {
    const code = manualDesktopCode().trim();
    if (!code || !pendingVerifier()) {
      return;
    }
    try {
      const result = await exchangeCloudDesktopCode(settings, code, pendingVerifier());
      updateSetting('cloudAuthAccessToken', result.accessToken);
      updateSetting('cloudAuthRefreshToken', result.refreshToken);
      updateSetting('cloudAuthUserId', result.userId);
      updateSetting('cloudAuthUserEmail', result.userEmail);
      updateSetting('cloudAuthStatus', 'signed-in');
      setBackendStatus('success');
      setBackendError('');
      setPendingState('');
      setPendingVerifier('');
      setManualDesktopCode('');
      setCloudLoginPending(false);
    } catch (e) {
      console.error(e);
      setBackendStatus('error');
      setBackendError(String(e));
    }
  }

  const cleanupDeepLink = getBridge().window.onAuthDeepLink(async (payload) => {
    if (!payload.code || !payload.state) {
      if (payload.error) {
        setBackendStatus('error');
        setBackendError(payload.error);
      }
      return;
    }
    if (!pendingState() || payload.state !== pendingState()) {
      return;
    }
    try {
      const result = await exchangeCloudDesktopCode(settings, payload.code, pendingVerifier());
      updateSetting('cloudAuthAccessToken', result.accessToken);
      updateSetting('cloudAuthRefreshToken', result.refreshToken);
      updateSetting('cloudAuthUserId', result.userId);
      updateSetting('cloudAuthUserEmail', result.userEmail);
      updateSetting('cloudAuthStatus', 'signed-in');
      setBackendStatus('success');
      setBackendError('');
    } catch (e) {
      console.error(e);
      setBackendStatus('error');
      setBackendError(String(e));
    } finally {
      setPendingState('');
      setPendingVerifier('');
      setCloudLoginPending(false);
    }
  });
  onCleanup(() => cleanupDeepLink());


  return (
    <TabContent
      header={{
        title: t('mlearn.Connection.Title') || 'Connection',
        icon: <LinkIcon size={20} />,
      }}
      padding="lg"
    >
      {/* ── Backend Mode ── */}
      <SettingGroup title={t('mlearn.Connection.BackendMode') || 'Backend Mode'}>
        <SettingRow label={t('mlearn.Connection.Mode') || 'Mode'}>
          <Select
            options={modeOptions()}
            value={settings.backendMode}
            onChange={(e) => updateSetting('backendMode', e.currentTarget.value as BackendMode)}
          />
        </SettingRow>

        <HintText>
          {settings.backendMode === 'tethered'
            ? (t('mlearn.Connection.HintTethered') || 'Connect to the Python backend running on your desktop.')
            : (t('mlearn.Connection.HintLocal') || 'Uses the local Python backend on this machine.')}
        </HintText>

        {/* Tethered / Cloud URL */}
        <Show when={settings.backendMode === 'tethered'}>
          <SettingRow label={t('mlearn.Connection.BackendUrl') || 'Backend URL'}>
            <Input
              value={settings.backendUrl}
              onInput={(e) => updateSetting('backendUrl', e.currentTarget.value)}
              placeholder="http://192.168.x.x:7752"
            />
          </SettingRow>
        </Show>

        <SettingRow
          label={t('mlearn.Connection.OverrideCloudEndpointUrl')}
          description={t('mlearn.Connection.OverrideCloudEndpointUrlDescription')}
        >
          <ToggleSwitch
            checked={settings.overrideCloudEndpointUrl}
            onChange={(checked) => {
              updateSetting('overrideCloudEndpointUrl', checked);
              if (checked && !settings.cloudLoginUrl) {
                updateSetting('cloudLoginUrl', DEFAULT_CLOUD_LOGIN_URL);
              }
              if (checked && !settings.cloudApiUrl) {
                updateSetting('cloudApiUrl', DEFAULT_CLOUD_API_URL);
              }
            }}
          />
        </SettingRow>

        <Show when={settings.overrideCloudEndpointUrl}>
          <SettingRow label={t('mlearn.Connection.CloudLoginUrl')}>
            <Input
              value={settings.cloudLoginUrl}
              onInput={(e) => updateSetting('cloudLoginUrl', e.currentTarget.value)}
              placeholder={DEFAULT_CLOUD_LOGIN_URL}
            />
          </SettingRow>
          <SettingRow label={t('mlearn.Connection.CloudApiUrl')}>
            <Input
              value={settings.cloudApiUrl}
              onInput={(e) => updateSetting('cloudApiUrl', e.currentTarget.value)}
              placeholder={DEFAULT_CLOUD_API_URL}
            />
          </SettingRow>
        </Show>

        <SettingRow label={t('mlearn.Connection.AuthStatus') || 'Cloud Account'}>
          <div class="connection-test-row">
            <Show
              when={settings.cloudAuthStatus === 'signed-in' && !!(settings.cloudAuthAccessToken || settings.cloudAuthToken)}
              fallback={(
                <Btn onClick={handleCloudSignIn} disabled={cloudLoginPending()}>
                  {cloudLoginPending()
                    ? (t('mlearn.Connection.SigningIn') || 'Signing in...')
                    : (t('mlearn.Connection.SignIn') || 'Sign in')}
                </Btn>
              )}
            >
              <Btn onClick={handleOpenDashboard}>
                {t('mlearn.Connection.OpenDashboard') || 'Open Dashboard'}
              </Btn>
              <Btn onClick={handleCloudSignOut}>
                {t('mlearn.Connection.SignOut') || 'Sign out'}
              </Btn>
            </Show>
            <Show when={settings.cloudAuthStatus === 'signed-in' && settings.cloudAuthUserEmail}>
              <span class="connection-status-ok">{settings.cloudAuthUserEmail}</span>
            </Show>
          </div>
        </SettingRow>
        <Show when={cloudLoginPending()}>
          <SettingRow label={t('mlearn.Connection.CompleteSignIn') || 'Complete sign in'}>
            <div class="connection-test-row">
              <Input
                value={manualDesktopCode()}
                onInput={(e) => setManualDesktopCode(e.currentTarget.value)}
                placeholder={t('mlearn.Connection.DesktopCode') || 'Desktop one-time code'}
              />
              <Btn onClick={handleCompleteManualSignIn} disabled={!manualDesktopCode().trim()}>
                {t('mlearn.Connection.CompleteSignIn') || 'Complete sign in'}
              </Btn>
            </div>
          </SettingRow>
        </Show>

        <HintText>
          {t('mlearn.Connection.DefaultCloudEndpoint', { loginUrl: DEFAULT_CLOUD_LOGIN_URL, apiUrl: DEFAULT_CLOUD_API_URL })}
        </HintText>

        {/* Test connection button */}
        <Show when={settings.backendMode !== 'local'}>
          <SettingRow label="">
            <Btn
              onClick={handleTestBackend}
              loading={testingBackend()}
              variant={backendStatus() === 'success' ? 'success' : backendStatus() === 'error' ? 'danger' : 'default'}
              icon={backendStatus() === 'success' ? 'check' : undefined}
            >
              {backendStatus() === 'success'
                ? (t('mlearn.Connection.Connected') || 'Connected')
                : backendStatus() === 'error'
                  ? (t('mlearn.Connection.Unreachable') || 'Unreachable')
                  : (t('mlearn.Connection.TestConnection') || 'Test Connection')
              }
            </Btn>
          </SettingRow>
        </Show>
      </SettingGroup>

      {/* ── Node Server (Tethered) ── */}
      <Show when={settings.backendMode === 'tethered'}>
        <SettingGroup title={t('mlearn.Connection.NodeServer') || 'Desktop Server'}>
          <SettingRow label={t('mlearn.Connection.NodeServerUrl') || 'Server URL'}>
            <Input
              value={settings.nodeServerUrl}
              onInput={(e) => updateSetting('nodeServerUrl', e.currentTarget.value)}
              placeholder="http://192.168.x.x:7753"
            />
          </SettingRow>
          <SettingRow label="">
            <Btn
              onClick={handleTestNodeServer}
              loading={testingNode()}
              variant={nodeStatus() === 'success' ? 'success' : nodeStatus() === 'error' ? 'danger' : 'default'}
              icon={nodeStatus() === 'success' ? 'check' : undefined}
            >
              {nodeStatus() === 'success'
                ? (t('mlearn.Connection.Connected') || 'Connected')
                : nodeStatus() === 'error'
                  ? (t('mlearn.Connection.Unreachable') || 'Unreachable')
                  : (t('mlearn.Connection.TestConnection') || 'Test Connection')
              }
            </Btn>
          </SettingRow>
        </SettingGroup>
      </Show>

    </TabContent>
  );
};
