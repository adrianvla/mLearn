/**
 * Connection Tab
 * Allows the user to configure LLM provider URL and model for the conversation agent.
 */

import { Component, Show, createSignal, onMount } from 'solid-js';
import { useSettings, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import {
  FormField,
  Input,
  Btn,
  EmptyState,
  TabHeader,
  Select,
} from '../../components/common';
import type { SelectOption } from '../../components/common';
import type { OllamaModel } from '../../../shared/types';
import './ConnectionTab.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.conversationAgent.connection");

export const ConnectionTab: Component = () => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();

  const [serverUrl, setServerUrl] = createSignal(settings.ollamaUrl || 'http://localhost:11434');
  const [model, setModel] = createSignal(settings.ollamaModel || 'llama3.2');
  const [testStatus, setTestStatus] = createSignal<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [availableModels, setAvailableModels] = createSignal<OllamaModel[]>([]);
  const [loadingModels, setLoadingModels] = createSignal(false);
  const [saveStatus, setSaveStatus] = createSignal<'idle' | 'saved'>('idle');

  onMount(() => {
    setServerUrl(settings.ollamaUrl || 'http://localhost:11434');
    setModel(settings.ollamaModel || 'llama3.2');
  });

  const resetFormStatus = () => {
    setTestStatus('idle');
    setSaveStatus('idle');
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    try {
      updateSetting('ollamaUrl', serverUrl());
      const connected = await getBridge().llm.ollamaCheck();
      setTestStatus(connected ? 'success' : 'failed');
    } catch (e) {
      log.error("error", e);
      setTestStatus('failed');
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

  const testBtnLabel = () => {
    switch (testStatus()) {
      case 'testing':
        return t('mlearn.ConversationAgent.Connection.Testing');
      case 'success':
        return t('mlearn.ConversationAgent.Connection.ConnectionSuccess');
      case 'failed':
        return t('mlearn.ConversationAgent.Connection.ConnectionFailed');
      default:
        return t('mlearn.ConversationAgent.Connection.TestConnection');
    }
  };

  const testBtnVariant = (): 'default' | 'success' | 'danger' => {
    switch (testStatus()) {
      case 'success':
        return 'success';
      case 'failed':
        return 'danger';
      default:
        return 'default';
    }
  };

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
        <Btn
          variant={testBtnVariant()}
          onClick={handleTestConnection}
          disabled={testStatus() === 'testing'}
          loading={testStatus() === 'testing'}
        >
          {testBtnLabel()}
        </Btn>

        <Btn
          variant={saveStatus() === 'saved' ? 'success' : 'primary'}
          onClick={handleSave}
        >
          {saveStatus() === 'saved'
            ? t('mlearn.ConversationAgent.Connection.Saved')
            : t('mlearn.ConversationAgent.Connection.Save')}
        </Btn>
      </div>

      <div class="ca-conn-models-section">
        <div class="ca-conn-models-header">
          <span class="ca-conn-label">
            {t('mlearn.ConversationAgent.Connection.AvailableModels')}
          </span>
          <Btn
            size="sm"
            variant="ghost"
            onClick={handleFetchModels}
            disabled={loadingModels()}
            loading={loadingModels()}
          >
            {loadingModels()
              ? t('mlearn.ConversationAgent.Connection.LoadingModels')
              : t('mlearn.ConversationAgent.Connection.FetchModels')}
          </Btn>
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
