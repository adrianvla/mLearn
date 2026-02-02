/**
 * Main Window Loading Overlay
 * Displays loading state during app initialization
 * Uses the standardized LoadingOverlay component from common/Modal
 */

import { Component, createMemo, createSignal, onMount, Show } from 'solid-js';
import { useServer, useSettings, useLanguage, useLocalization } from '../../../context';
import { LoadingOverlay as BaseLoadingOverlay, ErrorModal } from '../../../components/common/Modal';

export const LoadingOverlay: Component = () => {
  const server = useServer();
  const settings = useSettings();
  const language = useLanguage();
  const { t } = useLocalization();
  
  // Track critical errors from the server
  const [criticalError, setCriticalError] = createSignal<{ message: string; details?: string } | null>(null);

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

  // Listen for critical errors from the server
  onMount(() => {
    if (window.mLearnIPC) {
      const handleCriticalError = (errorMessage: string) => {
        console.error('[LoadingOverlay] Critical error received:', errorMessage);
        
        // Parse error messages for known error types
        let details: string | undefined;
        let friendlyMessage = errorMessage;
        
        if (errorMessage.includes('EADDRINUSE')) {
          friendlyMessage = t('mlearn.ErrorModal.Messages.PortInUse');
          details = errorMessage;
        } else if (errorMessage.includes('EACCES')) {
          friendlyMessage = t('mlearn.ErrorModal.Messages.PermissionDenied');
          details = errorMessage;
        } else if (errorMessage.includes('ENOENT')) {
          friendlyMessage = t('mlearn.ErrorModal.Messages.FileNotFound');
          details = errorMessage;
        } else if (errorMessage.includes('exit code') || errorMessage.includes('stopped')) {
          friendlyMessage = t('mlearn.ErrorModal.Messages.BackendStopped');
          details = errorMessage;
        }
        
        setCriticalError({ message: friendlyMessage, details });
      };

      window.mLearnIPC.onServerCriticalError(handleCriticalError);
    }
  });

  const handleRetry = () => {
    setCriticalError(null);
    server.forceRestart();
  };

  const handleQuit = () => {
    window.mLearnIPC?.closeWindow();
  };

  return (
    <>
      {/* Error modal - shown when there's a critical error */}
      <Show when={criticalError()}>
        {(error) => (
          <ErrorModal
            isOpen={true}
            severity="fatal"
            title={t('mlearn.ErrorModal.Title.StartupError')}
            message={error().message}
            details={error().details}
            onRetry={handleRetry}
            onQuit={handleQuit}
            showRetry={true}
            showQuit={true}
          />
        )}
      </Show>

      {/* Loading overlay - shown during initialization when no error */}
      <Show when={!criticalError()}>
        <BaseLoadingOverlay
          isOpen={isLoading()}
          title={t('mlearn.Global.AppName')}
          message={message()}
          progress={progress()}
          showProgress={true}
          showPercent={true}
        />
      </Show>
    </>
  );
};

export default LoadingOverlay;