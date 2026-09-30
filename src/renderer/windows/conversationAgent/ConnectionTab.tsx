/**
 * Connection Tab
 * Allows the user to configure LLM provider URL and model for the conversation agent.
 */

import { Component, Show, createSignal, onMount } from 'solid-js';
import { useSettings, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { Button, FormField, Input, EmptyState, TabHeader, Select } from '../../components/common';
import type { SelectOption } from '../../components/common';
import type { OllamaModel } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import './ConnectionTab.css';
import { getLogger } from '../../../shared/utils/logger';
import {
  probeProvider,
  providerTestLabel,
  providerTestVariant,
  type ProviderFailure,
} from '../../services/providerFailure';

const log = getLogger("renderer.conversationAgent.connection");

export const ConnectionTab: Component = () => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();

  const [serverUrl, setServerUrl] = createSignal(settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl);
  const [model, setModel] = createSignal(settings.ollamaModel || 'llama3.2');
  /**
   * The last connection-test outcome, as a classification.
   *
   * This tab carried the fourth private copy of the same test-button state
   * machine the AI settings tab had three of, with its own `testBtnLabel` and
   * `testBtnVariant` switches. It is the one place a learner configures a
   * local endpoint, so "Connection failed" here was the least actionable
   * message in the app for the problem most likely to be a typo in the URL
   * they just typed.
   *
   * `testing` stays local: it is a property of the request in flight, not an
   * outcome, and no other surface needs to know about it.
   */
  const [testFailure, setTestFailure] = createSignal<ProviderFailure | null>(null);
  const [tested, setTested] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [availableModels, setAvailableModels] = createSignal<OllamaModel[]>([]);
  const [loadingModels, setLoadingModels] = createSignal(false);
  const [saveStatus, setSaveStatus] = createSignal<'idle' | 'saved'>('idle');

  onMount(() => {
    setServerUrl(settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl);
    setModel(settings.ollamaModel || 'llama3.2');
  });

  const resetFormStatus = () => {
    setTestFailure(null);
    setTested(false);
    setSaveStatus('idle');
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestFailure(null);
    setTested(false);
    try {
      updateSetting('ollamaUrl', serverUrl());
      const classified = await probeProvider({ ...settings, llmProvider: 'ollama' });
      setTestFailure(classified);
      setTested(true);
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    setLoadingModels(true);
    try {
      updateSetting('ollamaUrl', serverUrl());
      const models = (await getBridge().llm.ollamaListModels()) as OllamaModel[] | undefined;
      setAvailableModels(models || []);
    } catch (e) {
      log.error("error", e);
      setAvailableModels([]);
    }
    setLoadingModels(false);
  };

  const handleSave = () => {
    updateSetting('ollamaUrl', serverUrl());
    updateSetting('ollamaModel', model());
    setSaveStatus('saved');
  };

  const handleModelSelect = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value) {
      resetFormStatus();
      setModel(value);
      updateSetting('ollamaModel', value);
    }
  };

  const modelOptions = (): SelectOption[] =>
    availableModels().map((m) => ({
      value: m.name,
      label: `${m.name} (${(m.size / 1_073_741_824).toFixed(1)} GB)`,
    }));

  // While the request is in flight the button reports that, because there is
  // no outcome yet. Once it resolves, the classified failure names the problem
  // instead of collapsing every cause into "Connection failed".
  const testBtnLabel = () => {
    if (testing()) return t('mlearn.ConversationAgent.Connection.Testing');
    return providerTestLabel(tested(), testFailure(), t,
      'mlearn.ConversationAgent.Connection.ConnectionSuccess',
      'mlearn.ConversationAgent.Connection.TestConnection');
  };

  const testBtnVariant = () => (testing()
    ? 'default'
    : providerTestVariant(tested(), testFailure()));

  return (
    <div class="ca-connection-tab">
      <TabHeader
        title={t('mlearn.ConversationAgent.Connection.Title')}
        description={t('mlearn.ConversationAgent.Connection.Hint')}
      />

      <FormField
        label={t('mlearn.ConversationAgent.Connection.ServerUrl')}
        hint={t('mlearn.ConversationAgent.Connection.ServerUrlHint')}
      >
        <Input
          value={serverUrl()}
          onInput={(e) => {
            resetFormStatus();
            setServerUrl(e.currentTarget.value);
          }}
          placeholder="http://localhost:11434"
          fullWidth
        />
      </FormField>

      <FormField
        label={t('mlearn.ConversationAgent.Connection.Model')}
        hint={t('mlearn.ConversationAgent.Connection.ModelHint')}
      >
        <Input
          value={model()}
          onInput={(e) => {
            resetFormStatus();
            setModel(e.currentTarget.value);
          }}
          placeholder="llama3.2"
          fullWidth
        />
      </FormField>

      <div class="ca-conn-actions">
        <Button
          variant={testBtnVariant()}
          onClick={handleTestConnection}
          disabled={testing()}
          loading={testing()}
        >
          {testBtnLabel()}
        </Button>

        <Button
          variant={saveStatus() === 'saved' ? 'success' : 'primary'}
          onClick={handleSave}
        >
          {saveStatus() === 'saved'
            ? t('mlearn.ConversationAgent.Connection.Saved')
            : t('mlearn.ConversationAgent.Connection.Save')}
        </Button>
      </div>

      <div class="ca-conn-models-section">
        <div class="ca-conn-models-header">
          <span class="ca-conn-label">
            {t('mlearn.ConversationAgent.Connection.AvailableModels')}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleFetchModels}
            disabled={loadingModels()}
            loading={loadingModels()}
          >
            {loadingModels()
              ? t('mlearn.ConversationAgent.Connection.LoadingModels')
              : t('mlearn.ConversationAgent.Connection.FetchModels')}
          </Button>
        </div>

        <Show when={availableModels().length > 0}>
          <Select
            options={modelOptions()}
            value={model()}
            onChange={handleModelSelect}
            placeholder={t('mlearn.ConversationAgent.Connection.AvailableModels')}
          />
        </Show>

        <Show when={!loadingModels() && availableModels().length === 0}>
          <EmptyState
            title={t('mlearn.ConversationAgent.Connection.NoModelsFound')}
            size="sm"
            variant="minimal"
          />
        </Show>
      </div>
    </div>
  );
};
