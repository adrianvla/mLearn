import { Component, For, Show, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { Btn, EmptyState, TabContent } from '../../../components/common';
import { showToast } from '../../../components/common/Feedback/Toast';
import { useLocalization } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import type { PluginInstallResult, PluginState } from '../../../../shared/plugins/types';
import './PluginsTab.css';

function sortPlugins(plugins: PluginState[]): PluginState[] {
  return [...plugins].sort((left, right) => left.name.localeCompare(right.name));
}

function upsertPlugin(plugins: PluginState[], plugin: PluginState): PluginState[] {
  const existingIndex = plugins.findIndex((entry) => entry.id === plugin.id);
  if (existingIndex === -1) {
    return sortPlugins([...plugins, plugin]);
  }

  const nextPlugins = [...plugins];
  nextPlugins[existingIndex] = plugin;
  return sortPlugins(nextPlugins);
}

function removePlugin(plugins: PluginState[], pluginId: string): PluginState[] {
  return plugins.filter((plugin) => plugin.id !== pluginId);
}

export const PluginsTab: Component = () => {
  const { t } = useLocalization();
  const bridge = getBridge();
  const [installing, setInstalling] = createSignal(false);
  const [busyPluginId, setBusyPluginId] = createSignal<string | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = createSignal<string | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = createSignal<string | null>(null);

  const loadPlugins = async (): Promise<PluginState[]> => {
    setLoadErrorMessage(null);

    try {
      return sortPlugins(await bridge.plugins.pluginGetList());
    } catch (error) {
      console.error('Failed to load plugins:', error);
      setLoadErrorMessage(String(error));
      return [];
    }
  };

  const [plugins, { mutate: mutatePlugins, refetch }] = createResource(loadPlugins);

  const sortedPlugins = createMemo(() => sortPlugins(plugins() ?? []));
  const errorMessage = createMemo(() => actionErrorMessage() ?? loadErrorMessage());

  const handleInstall = async () => {
    setInstalling(true);
    setActionErrorMessage(null);

    try {
      const result = await bridge.plugins.pluginSelectAndInstall();
      handleInstallResult(result);
    } catch (error) {
      console.error('Failed to install plugin:', error);
      setActionErrorMessage(String(error));
    } finally {
      setInstalling(false);
    }
  };

  const handlePluginAction = async (
    pluginId: string,
    action: () => Promise<PluginState | null>,
  ) => {
    setBusyPluginId(pluginId);
    setActionErrorMessage(null);

    try {
      const updatedPlugin = await action();
      if (updatedPlugin) {
        mutatePlugins((currentPlugins) => upsertPlugin(currentPlugins ?? [], updatedPlugin));
      }
    } catch (error) {
      console.error(`Failed to update plugin ${pluginId}:`, error);
      setActionErrorMessage(String(error));
    } finally {
      setBusyPluginId(null);
    }
  };

  const handleUninstall = async (pluginId: string) => {
    setBusyPluginId(pluginId);
    setActionErrorMessage(null);

    try {
      const removed = await bridge.plugins.pluginUninstall(pluginId);
      if (removed) {
        mutatePlugins((currentPlugins) => removePlugin(currentPlugins ?? [], pluginId));
      }
    } catch (error) {
      console.error(`Failed to uninstall plugin ${pluginId}:`, error);
      setActionErrorMessage(String(error));
    } finally {
      setBusyPluginId(null);
    }
  };

  const handleOpenWindow = async (pluginId: string) => {
    setBusyPluginId(pluginId);
    setActionErrorMessage(null);

    try {
      const opened = await bridge.plugins.pluginOpenWindow({ pluginId });
      if (!opened) {
        setActionErrorMessage(t('mlearn.Settings.Plugins.OpenWindowError'));
      }
    } catch (error) {
      console.error(`Failed to open plugin window for ${pluginId}:`, error);
      setActionErrorMessage(String(error));
    } finally {
      setBusyPluginId(null);
    }
  };

  const handleInstallResult = (result: PluginInstallResult) => {
    if (!result.success && result.error) {
      setActionErrorMessage(result.error);
      showToast({ message: result.error, variant: 'error' });
      return;
    }

    if (result.success) {
      setActionErrorMessage(null);
      void refetch();
    }
  };

  onMount(() => {
    const cleanupPluginList = bridge.plugins.onPluginList((nextPlugins) => {
      mutatePlugins(sortPlugins(nextPlugins));
    });
    const cleanupStatusUpdate = bridge.plugins.onPluginStatusUpdate((plugin) => {
      mutatePlugins((currentPlugins) => upsertPlugin(currentPlugins ?? [], plugin));
    });
    const cleanupInstallResult = bridge.plugins.onPluginInstallResult((result) => {
      handleInstallResult(result);
    });

    onCleanup(() => {
      cleanupPluginList();
      cleanupStatusUpdate();
      cleanupInstallResult();
    });
  });

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.Plugins.Title'),
        description: t('mlearn.Settings.Plugins.Description'),
      }}
      padding="lg"
      class="plugins-tab"
    >
      <div class="plugins-tab__toolbar">
        <Btn onClick={handleInstall} loading={installing()}>
          {t('mlearn.Settings.Plugins.Install')}
        </Btn>
      </div>

      <Show when={errorMessage()}>
        {(message) => (
          <p class="plugins-tab__error" role="alert" aria-live="assertive">
            {message()}
          </p>
        )}
      </Show>

      <Show when={plugins.loading}>
        <div class="plugins-tab__loading">{t('mlearn.Settings.Plugins.Loading')}</div>
      </Show>

      <Show when={!plugins.loading && sortedPlugins().length === 0}>
        <EmptyState
          title={t('mlearn.Settings.Plugins.Empty.Title')}
          description={t('mlearn.Settings.Plugins.Empty.Description')}
          action={{
            label: t('mlearn.Settings.Plugins.Install'),
            onClick: handleInstall,
          }}
          variant="card"
        />
      </Show>

      <Show when={!plugins.loading && sortedPlugins().length > 0}>
        <div class="plugins-tab__grid">
          <For each={sortedPlugins()}>
            {(initialPlugin) => {
              const plugin = () => (plugins() ?? []).find((entry) => entry.id === initialPlugin.id) ?? initialPlugin;
              const isBusy = () => busyPluginId() === plugin().id;
              const needsPermissions = () => plugin().permissions.length > 0 && !plugin().permissionsGranted;
              const canEnable = () => plugin().status !== 'active' && !needsPermissions();
              const canOpenWindow = () => (
                plugin().status === 'active'
                && plugin().capabilities.includes('ui-panel')
                && plugin().permissions.includes('open-window')
                && Boolean(plugin().ui)
              );

              return (
                <section class="plugins-tab__card" data-plugin-id={plugin().id}>
                  <div class="plugins-tab__card-header">
                    <div>
                      <h3 class="plugins-tab__card-title">{plugin().name}</h3>
                      <p class="plugins-tab__card-subtitle">
                        v{plugin().version}
                        <Show when={plugin().author}> - {plugin().author}</Show>
                      </p>
                    </div>
                    <span class={`plugins-tab__status plugins-tab__status--${plugin().status}`}>
                      {t(`mlearn.Settings.Plugins.Status.${plugin().status}`)}
                    </span>
                  </div>

                  <Show when={plugin().description}>
                    <p class="plugins-tab__description">{plugin().description}</p>
                  </Show>

                  <div class="plugins-tab__meta">
                    <div>
                      <span class="plugins-tab__meta-label">{t('mlearn.Settings.Plugins.Capabilities')}</span>
                      <p>{plugin().capabilities.join(', ') || '-'}</p>
                    </div>
                    <div>
                      <span class="plugins-tab__meta-label">{t('mlearn.Settings.Plugins.Permissions')}</span>
                      <p>{plugin().permissions.join(', ') || '-'}</p>
                    </div>
                  </div>

                  <div class="plugins-tab__actions">
                    <Show when={needsPermissions()}>
                      <Btn
                        onClick={() => handlePluginAction(plugin().id, () => bridge.plugins.pluginGrantPermissions(plugin().id))}
                        disabled={isBusy()}
                      >
                        {t('mlearn.Settings.Plugins.GrantPermissions')}
                      </Btn>
                    </Show>

                    <Show when={canEnable()}>
                      <Btn
                        onClick={() => handlePluginAction(plugin().id, () => bridge.plugins.pluginEnable(plugin().id))}
                        disabled={isBusy()}
                      >
                        {t('mlearn.Settings.Plugins.Enable')}
                      </Btn>
                    </Show>

                    <Show when={plugin().status === 'active'}>
                      <Btn
                        variant="ghost"
                        onClick={() => handlePluginAction(plugin().id, () => bridge.plugins.pluginDisable(plugin().id))}
                        disabled={isBusy()}
                      >
                        {t('mlearn.Settings.Plugins.Disable')}
                      </Btn>
                    </Show>

                    <Show when={canOpenWindow()}>
                      <Btn
                        variant="ghost"
                        onClick={() => handleOpenWindow(plugin().id)}
                        disabled={isBusy()}
                      >
                        {t('mlearn.Settings.Plugins.OpenWindow')}
                      </Btn>
                    </Show>

                    <Btn
                      variant="danger"
                      onClick={() => handleUninstall(plugin().id)}
                      disabled={isBusy()}
                    >
                      {t('mlearn.Settings.Plugins.Uninstall')}
                    </Btn>
                  </div>
                </section>
              );
            }}
          </For>
        </div>
      </Show>
    </TabContent>
  );
};
