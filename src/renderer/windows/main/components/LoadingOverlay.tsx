import { Component, Show, createMemo } from 'solid-js';
import { useServer, useSettings, useLanguage, useLocalization } from '../../../context';

export const LoadingOverlay: Component = () => {
  const server = useServer();
  const settings = useSettings();
  const language = useLanguage();
  const { t } = useLocalization();

  const isLoading = createMemo(
    () => !server.isConnected() || settings.isLoading() || language.isLoading()
  );

  const message = createMemo(() => {
    if (!server.isConnected()) {
      return server.statusMessage() || t('mlearn.Global.Status.StartingBackend');
    }
    if (settings.isLoading()) {
      return t('mlearn.Global.Status.LoadingSettings');
    }
    if (language.isLoading()) {
      return t('mlearn.Global.Status.LoadingLanguageData');
    }
    return t('mlearn.Global.Ready');
  });

  const progress = createMemo(() => {
    const steps = 3;
    const done =
      (server.isConnected() ? 1 : 0) +
      (!settings.isLoading() ? 1 : 0) +
      (!language.isLoading() ? 1 : 0);
    return Math.round((done / steps) * 100);
  });

  return (
    <Show when={isLoading()}>
      <div class="app-loading-overlay">
        <div class="app-loading-panel">
          <div class="app-loading-title">{t('mlearn.Global.AppName')}</div>
          <div class="app-loading-status">{message()}</div>
          <div class="app-loading-progress">
            <div
              class="app-loading-progress-bar"
              style={{ width: `${progress()}%` }}
            />
          </div>
          <div class="app-loading-percent">{progress()}%</div>
        </div>
      </div>
    </Show>
  );
};

export default LoadingOverlay;