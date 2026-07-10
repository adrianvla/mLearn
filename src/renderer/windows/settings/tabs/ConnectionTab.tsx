/**
 * Connection Settings Tab
 * Configure backend mode (Local / Tethered) and connection testing for mobile tethering.
 */

import { Component, Show, createSignal, onCleanup } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { Modal, SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText, LinkIcon, ToggleSwitch, CheckboxCard } from '../../../components/common';
import { isMobile } from '../../../../shared/platform';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL, getBackend, resetBackend } from '../../../../shared/backends';
import { getNodeServer } from '../../../../shared/backends/nodeServerAdapter';
import { getBridge } from '../../../../shared/bridges';
import { exchangeCloudDesktopCode, getCloudDashboardUrl, startCloudDesktopLogin } from '../../../services/cloudAuthService';
import { handleCloudSessionError } from '../../../services/cloudSessionManager';
import type { SelectOption } from '../../../components/common';
import './ConnectionTab.css';
import { getLogger } from '../../../../shared/utils/logger';

const log = getLogger("renderer.settings.connection");

type BackendMode = 'local' | 'tethered';

export const ConnectionTab: Component = () => {
  const { settings, updateSetting, updateSettings } = useSettings();
  const { t } = useLocalization();
  // Test connection state
  const [testingBackend, setTestingBackend] = createSignal(false);
  const [backendStatus, setBackendStatus] = createSignal<'idle' | 'success' | 'error' | 'auth'>('idle');
  const [, setBackendError] = createSignal('');

  const [testingNode, setTestingNode] = createSignal(false);
  const [nodeStatus, setNodeStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [, setNodeError] = createSignal('');
  const [cloudLoginPending, setCloudLoginPending] = createSignal(false);
  const [pendingState, setPendingState] = createSignal('');
  const [pendingVerifier, setPendingVerifier] = createSignal('');
  const [manualDesktopCode, setManualDesktopCode] = createSignal('');

  // ToS / Privacy acceptance modal
  const [showTosModal, setShowTosModal] = createSignal(false);
  const [tosChecked, setTosChecked] = createSignal(false);
  const [privacyChecked, setPrivacyChecked] = createSignal(false);

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
      log.error("error", e);
      const requiresSignIn = handleCloudSessionError(e, true);
      setBackendStatus(requiresSignIn ? 'auth' : 'error');
      setBackendError(requiresSignIn ? '' : String(e));
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
      log.error("error", e);
      setNodeStatus('error');
      setNodeError(String(e));
    } finally {
      setTestingNode(false);
    }
  }

  function handleSignInClick() {
    if (settings.cloudTosAccepted && settings.cloudPrivacyAccepted) {
      handleCloudSignIn();
    } else {
      setTosChecked(false);
      setPrivacyChecked(false);
      setShowTosModal(true);
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
      log.error("error", e);
      setBackendStatus('error');
      setBackendError(String(e));
      setCloudLoginPending(false);
    }
  }

  function handleAcceptAndSignIn() {
    const now = Date.now();
    updateSettings({
      cloudTosAccepted: true,
      cloudTosAcceptedAt: now,
      cloudPrivacyAccepted: true,
      cloudPrivacyAcceptedAt: now,
    });
    setShowTosModal(false);
    handleCloudSignIn();
  }

  function handleCloudSignOut() {
    updateSettings({
      cloudAuthAccessToken: '',
      cloudAuthToken: '',
      cloudAuthRefreshToken: '',
      cloudAuthUserId: '',
      cloudAuthUserEmail: '',
      cloudAuthExpiresAt: 0,
      cloudAuthStatus: 'signed-out',
    });
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
      updateSettings({
        cloudAuthAccessToken: result.accessToken,
        cloudAuthToken: '',
        cloudAuthRefreshToken: result.refreshToken,
        cloudAuthUserId: result.userId,
        cloudAuthUserEmail: result.userEmail,
        cloudAuthExpiresAt: result.expiresAt ?? 0,
        cloudAuthStatus: 'signed-in',
        llmProvider: 'cloud',
      });
      setBackendStatus('success');
      setBackendError('');
      setPendingState('');
      setPendingVerifier('');
      setManualDesktopCode('');
      setCloudLoginPending(false);
    } catch (e) {
      log.error("error", e);
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
      updateSettings({
        cloudAuthAccessToken: result.accessToken,
        cloudAuthToken: '',
        cloudAuthRefreshToken: result.refreshToken,
        cloudAuthUserId: result.userId,
        cloudAuthUserEmail: result.userEmail,
        cloudAuthExpiresAt: result.expiresAt ?? 0,
        cloudAuthStatus: 'signed-in',
        llmProvider: 'cloud',
      });
      setBackendStatus('success');
      setBackendError('');
    } catch (e) {
      log.error("error", e);
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
                <Btn onClick={handleSignInClick} disabled={cloudLoginPending()}>
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
                : backendStatus() === 'auth'
                  ? (t('mlearn.Connection.SignIn') || 'Sign in')
                : backendStatus() === 'error'
                  ? (t('mlearn.Connection.Unreachable') || 'Unreachable')
                  : (t('mlearn.Connection.TestConnection') || 'Test Connection')
              }
            </Btn>
          </SettingRow>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Connection.LanguageCatalog.Title')}>
        <SettingRow
          label={t('mlearn.Connection.LanguageCatalog.Url')}
          description={t('mlearn.Connection.LanguageCatalog.Description')}
        >
          <Input
            value={settings.languageCatalogUrl ?? DEFAULT_SETTINGS.languageCatalogUrl}
            onInput={(e) => updateSetting('languageCatalogUrl', e.currentTarget.value)}
            placeholder={DEFAULT_SETTINGS.languageCatalogUrl}
          />
        </SettingRow>
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

      {/* ── ToS / Privacy Acceptance Modal ── */}
      <Modal
        isOpen={showTosModal()}
        onClose={() => setShowTosModal(false)}
        title="Terms of Service"
        size="sm"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setShowTosModal(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              disabled={!tosChecked() || !privacyChecked()}
              onClick={handleAcceptAndSignIn}
            >
              Accept & Sign In
            </Btn>
          </>
        }
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--spacing-4)' }}>
          <p style={{ margin: '0', color: 'var(--text-secondary)', 'font-size': 'var(--font-size-sm)' }}>
            To use cloud services, you must accept our Terms of Service and Privacy Policy.
          </p>
          <CheckboxCard
            checked={tosChecked()}
            onChange={setTosChecked}
            title="I agree to the Terms of Service"
          >
            <Btn
              variant="ghost"
              size="sm"
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                getBridge().window.openExternalUrl('https://mlearn.kikan.net/terms');
              }}
            >
              View Terms of Service
            </Btn>
          </CheckboxCard>
          <CheckboxCard
            checked={privacyChecked()}
            onChange={setPrivacyChecked}
            title="I agree to the Privacy Policy"
          >
            <Btn
              variant="ghost"
              size="sm"
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                getBridge().window.openExternalUrl('https://mlearn.kikan.net/privacy');
              }}
            >
              View Privacy Policy
            </Btn>
          </CheckboxCard>
        </div>
      </Modal>

    </TabContent>
  );
};
