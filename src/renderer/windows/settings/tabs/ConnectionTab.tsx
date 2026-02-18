/**
 * Connection Settings Tab
 * Configure backend mode (Local / Tethered / Cloud), LLM cloud endpoint,
 * and connection testing for mobile tethering.
 */

import { Component, Show, createSignal } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText } from '../../../components/common';
import { isMobile } from '../../../../shared/platform';
import { getBackend, resetBackend } from '../../../../shared/backends';
import { CloudLLMAdapter } from '../../../../shared/backends/cloudLLMAdapter';
import { getNodeServer } from '../../../../shared/backends/nodeServerAdapter';
import type { SelectOption } from '../../../components/common';
import './ConnectionTab.css';

type BackendMode = 'local' | 'tethered' | 'cloud';

export const ConnectionTab: Component = () => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();

  // Test connection state
  const [testingBackend, setTestingBackend] = createSignal(false);
  const [backendStatus, setBackendStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [backendError, setBackendError] = createSignal('');

  const [testingNode, setTestingNode] = createSignal(false);
  const [nodeStatus, setNodeStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [nodeError, setNodeError] = createSignal('');

  const [testingCloudLLM, setTestingCloudLLM] = createSignal(false);
  const [cloudLLMStatus, setCloudLLMStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  const [cloudLLMError, setCloudLLMError] = createSignal('');

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

  const llmProviderOptions = (): SelectOption[] => {
    const opts: SelectOption[] = [
      { value: 'builtin', label: t('mlearn.Connection.LLMBuiltIn') || 'Built-in' },
      { value: 'ollama', label: t('mlearn.Connection.LLMOllama') || 'Ollama' },
      { value: 'cloud', label: t('mlearn.Connection.LLMCloud') || 'Cloud' },
    ];
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

  async function handleTestCloudLLM() {
    setTestingCloudLLM(true);
    setCloudLLMStatus('idle');
    setCloudLLMError('');
    try {
      const adapter = new CloudLLMAdapter(settings.cloudLLMUrl, settings.cloudLLMToken);
      const ok = await adapter.checkAvailability();
      setCloudLLMStatus(ok ? 'success' : 'error');
      if (!ok) setCloudLLMError(t('mlearn.Connection.Unreachable') || 'Unreachable');
    } catch (e) {
      setCloudLLMStatus('error');
      setCloudLLMError(String(e));
    } finally {
      setTestingCloudLLM(false);
    }
  }

  return (
    <TabContent
      header={{
        title: t('mlearn.Connection.Title') || 'Connection',
        icon: '🔗',
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
        <Show when={settings.backendMode !== 'local'}>
          <SettingRow label={t('mlearn.Connection.BackendUrl') || 'Backend URL'}>
            <Input
              value={settings.backendUrl}
              onInput={(e) => updateSetting('backendUrl', e.currentTarget.value)}
              placeholder={settings.backendMode === 'tethered' ? 'http://192.168.x.x:7752' : 'https://your-cloud-url.com'}
            />
          </SettingRow>
        </Show>

        {/* Cloud auth token */}
        <Show when={settings.backendMode === 'cloud'}>
          <SettingRow label={t('mlearn.Connection.AuthToken') || 'Auth Token'}>
            <Input
              value={settings.cloudAuthToken}
              onInput={(e) => updateSetting('cloudAuthToken', e.currentTarget.value)}
              placeholder="Bearer token"
              type="password"
            />
          </SettingRow>
        </Show>

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
                <span class="connection-status-ok">✓ {t('mlearn.Connection.Connected') || 'Connected'}</span>
              </Show>
              <Show when={backendStatus() === 'error'}>
                <span class="connection-status-error">✗ {backendError()}</span>
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
                <span class="connection-status-ok">✓ {t('mlearn.Connection.Connected') || 'Connected'}</span>
              </Show>
              <Show when={nodeStatus() === 'error'}>
                <span class="connection-status-error">✗ {nodeError()}</span>
              </Show>
            </div>
          </SettingRow>
        </SettingGroup>
      </Show>

      {/* ── Cloud LLM ── */}
      <SettingGroup title={t('mlearn.Connection.CloudLLM') || 'Cloud LLM'}>
        <SettingRow label={t('mlearn.Connection.LLMProvider') || 'LLM Provider'}>
          <Select
            options={llmProviderOptions()}
            value={settings.llmProvider}
            onChange={(e) => updateSetting('llmProvider', e.currentTarget.value as 'builtin' | 'ollama' | 'cloud')}
          />
        </SettingRow>

        <Show when={settings.llmProvider === 'cloud'}>
          <SettingRow label={t('mlearn.Connection.CloudLLMUrl') || 'Cloud LLM URL'}>
            <Input
              value={settings.cloudLLMUrl}
              onInput={(e) => updateSetting('cloudLLMUrl', e.currentTarget.value)}
              placeholder="https://your-llm-service.com"
            />
          </SettingRow>

          <SettingRow label={t('mlearn.Connection.CloudLLMToken') || 'Cloud LLM Token'}>
            <Input
              value={settings.cloudLLMToken}
              onInput={(e) => updateSetting('cloudLLMToken', e.currentTarget.value)}
              placeholder="Bearer token"
              type="password"
            />
          </SettingRow>

          <SettingRow label="">
            <div class="connection-test-row">
              <Btn onClick={handleTestCloudLLM} disabled={testingCloudLLM()}>
                {testingCloudLLM()
                  ? (t('mlearn.Connection.Testing') || 'Testing...')
                  : (t('mlearn.Connection.TestConnection') || 'Test Connection')}
              </Btn>
              <Show when={cloudLLMStatus() === 'success'}>
                <span class="connection-status-ok">✓ {t('mlearn.Connection.Connected') || 'Connected'}</span>
              </Show>
              <Show when={cloudLLMStatus() === 'error'}>
                <span class="connection-status-error">✗ {cloudLLMError()}</span>
              </Show>
            </div>
          </SettingRow>
        </Show>
      </SettingGroup>
    </TabContent>
  );
};
