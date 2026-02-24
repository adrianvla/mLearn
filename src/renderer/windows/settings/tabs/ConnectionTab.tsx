/**
 * Connection Settings Tab
 * Configure backend mode (Local / Tethered / Cloud) and connection testing for mobile tethering.
 */

import { Component, Show, createSignal } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText, LinkIcon, CheckIcon, CrossIcon, ToggleSwitch } from '../../../components/common';
import { isMobile } from '../../../../shared/platform';
import { DEFAULT_CLOUD_ENDPOINT, getBackend, resetBackend } from '../../../../shared/backends';
import { getNodeServer } from '../../../../shared/backends/nodeServerAdapter';
import type { SelectOption } from '../../../components/common';
import './ConnectionTab.css';

type BackendMode = 'local' | 'tethered' | 'cloud';

export const ConnectionTab: Component = () => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();
  const resolveCloudBackendUrl = () => (
    settings.overrideCloudEndpointUrl ? settings.backendUrl : ''
  );

  // Test connection state
  const [testingBackend, setTestingBackend] = createSignal(false);
  const [backendStatus, setBackendStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [backendError, setBackendError] = createSignal('');

  const [testingNode, setTestingNode] = createSignal(false);
  const [nodeStatus, setNodeStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [nodeError, setNodeError] = createSignal('');

  // Backend mode options — hide 'local' on mobile
  const modeOptions = (): SelectOption[] => {
    const opts: SelectOption[] = [];
    if (!isMobile()) {
      opts.push({ value: 'local', label: t('mlearn.Connection.ModeLocal') || 'Local' });
    }
    opts.push(
      { value: 'tethered', label: t('mlearn.Connection.ModeTethered') || 'Tethered' },
      { value: 'cloud', label: t('mlearn.Connection.ModeCloud') || 'Cloud' },
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
        url: settings.backendMode === 'cloud' ? resolveCloudBackendUrl() : settings.backendUrl,
        authToken: settings.cloudAuthToken,
      });
      const ok = await backend.ping();
      setBackendStatus(ok ? 'success' : 'error');
      if (!ok) setBackendError(t('mlearn.Connection.Unreachable') || 'Unreachable');
    } catch (e) {
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
      setNodeStatus('error');
      setNodeError(String(e));
    } finally {
      setTestingNode(false);
    }
  }


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
          {settings.backendMode === 'local'
            ? (t('mlearn.Connection.HintLocal') || 'Uses the local Python backend on this machine.')
            : settings.backendMode === 'tethered'
              ? (t('mlearn.Connection.HintTethered') || 'Connect to the Python backend running on your desktop.')
              : (t('mlearn.Connection.HintCloud') || 'Connect to a remote cloud backend.')}
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
              if (checked && !settings.backendUrl) {
                updateSetting('backendUrl', DEFAULT_CLOUD_ENDPOINT);
              }
            }}
          />
        </SettingRow>

        <Show when={settings.overrideCloudEndpointUrl}>
          <SettingRow label={t('mlearn.Connection.CloudEndpointUrl')}>
            <Input
              value={settings.backendUrl}
              onInput={(e) => updateSetting('backendUrl', e.currentTarget.value)}
              placeholder={DEFAULT_CLOUD_ENDPOINT}
            />
          </SettingRow>
        </Show>

        <SettingRow label={t('mlearn.Connection.AuthToken') || 'Auth Token'}>
          <Input
            value={settings.cloudAuthToken}
            onInput={(e) => updateSetting('cloudAuthToken', e.currentTarget.value)}
            placeholder="Bearer token"
            type="password"
          />
        </SettingRow>

        <HintText>
          {t('mlearn.Connection.DefaultCloudEndpoint', { endpoint: DEFAULT_CLOUD_ENDPOINT })}
        </HintText>

        {/* Test connection button */}
        <Show when={settings.backendMode !== 'local'}>
          <SettingRow label="">
            <div class="connection-test-row">
              <Btn onClick={handleTestBackend} disabled={testingBackend()}>
                {testingBackend()
                  ? (t('mlearn.Connection.Testing') || 'Testing...')
                  : (t('mlearn.Connection.TestConnection') || 'Test Connection')}
              </Btn>
              <Show when={backendStatus() === 'success'}>
                <span class="connection-status-ok"><CheckIcon size={14} /> {t('mlearn.Connection.Connected') || 'Connected'}</span>
              </Show>
              <Show when={backendStatus() === 'error'}>
                <span class="connection-status-error"><CrossIcon size={14} /> {backendError()}</span>
              </Show>
            </div>
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
            <div class="connection-test-row">
              <Btn onClick={handleTestNodeServer} disabled={testingNode()}>
                {testingNode()
                  ? (t('mlearn.Connection.Testing') || 'Testing...')
                  : (t('mlearn.Connection.TestConnection') || 'Test Connection')}
              </Btn>
              <Show when={nodeStatus() === 'success'}>
                <span class="connection-status-ok"><CheckIcon size={14} /> {t('mlearn.Connection.Connected') || 'Connected'}</span>
              </Show>
              <Show when={nodeStatus() === 'error'}>
                <span class="connection-status-error"><CrossIcon size={14} /> {nodeError()}</span>
              </Show>
            </div>
          </SettingRow>
        </SettingGroup>
      </Show>

    </TabContent>
  );
};
