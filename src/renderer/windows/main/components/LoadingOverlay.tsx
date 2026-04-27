/**
 * Main Window Loading Overlay
 * Displays loading state during app initialization
 * Uses the standardized LoadingOverlay component from common/Modal
 */

import { Component, createMemo, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { useServer, useSettings, useLanguage, useLocalization } from '../../../context';
import { LoadingOverlay as BaseLoadingOverlay, ErrorModal } from '../../../components/common/Modal';
import { Btn } from '../../../components/common/Button';
import { getBridge } from '../../../../shared/bridges';
import { getLogger } from '../../../../shared/utils/logger';

const log = getLogger("renderer.main.loadingOverlay");

export const LoadingOverlay: Component = () => {
  const server = useServer();
  const settings = useSettings();
  const language = useLanguage();
  const { t } = useLocalization();
  
  // Track critical errors from the server
  const [criticalError, setCriticalError] = createSignal<{ message: string; details?: string } | null>(null);
  // Track Anki-specific connection errors
  const [ankiError, setAnkiError] = createSignal<string | null>(null);

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
    const handleCriticalError = (errorMessage: string) => {
        log.error('[LoadingOverlay] Critical error received:', errorMessage);
        
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

    const handleAnkiError = (reason: string) => {
      log.error('[LoadingOverlay] Anki connection error received:', reason);
      setAnkiError(reason);
    };

    const bridge = getBridge();
    const cleanupCritical = bridge.server.onServerCriticalError(handleCriticalError);
    let cleanupAnki: (() => void) | undefined;
    try {
      cleanupAnki = bridge.server.onAnkiConnectionError(handleAnkiError);
    } catch (e) {
      log.warn('[LoadingOverlay] onAnkiConnectionError not available:', e);
    }
    onCleanup(() => {
      cleanupCritical();
      cleanupAnki?.();
    });
  });

  const handleRetry = () => {
    setCriticalError(null);
    server.restartBackend();
  };

  const handleQuit = () => {
    getBridge().window.closeWindow();
  };

  // Anki recovery actions
  const handleAnkiDisableSession = () => {
    setAnkiError(null);
    server.resetToLoading();
    getBridge().server.restartBackendAnkiOverride(true);
  };

  const handleAnkiDisablePermanent = () => {
    setAnkiError(null);
    settings.updateSettings({ use_anki: false });
    server.resetToLoading();
    getBridge().server.restartBackendAnkiOverride(false);
  };

  const handleAnkiTryAgain = () => {
    setAnkiError(null);
    server.restartBackend();
  };

  const ankiErrorMessage = createMemo(() => {
    const reason = ankiError();
    if (reason === 'no_valid_cards') {
      return t('mlearn.ErrorModal.Messages.AnkiNoValidCards');
    }
    return t('mlearn.ErrorModal.Messages.AnkiConnectionFailed');
  });

  return (
    <>
      {/* Anki connection error modal */}
      <Show when={ankiError()}>
        <ErrorModal
          isOpen={true}
          severity="error"
          title={t('mlearn.ErrorModal.Title.AnkiError')}
          message={ankiErrorMessage()}
          showRetry={false}
          showQuit={false}
          actions={
            <>
              <Btn
                variant="default"
                onClick={handleAnkiDisableSession}
              >
                {t('mlearn.ErrorModal.AnkiDisableSession')}
              </Btn>
              <Btn
                variant="danger"
                onClick={handleAnkiDisablePermanent}
              >
                {t('mlearn.ErrorModal.AnkiDisablePermanent')}
              </Btn>
              <Btn
                variant="primary"
                onClick={handleAnkiTryAgain}
              >
                {t('mlearn.Global.TryAgain')}
              </Btn>
            </>
          }
        />
      </Show>

      {/* Error modal - shown when there's a critical error */}
      <Show when={!ankiError() ? criticalError() : null}>
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
      <Show when={!criticalError() && !ankiError()}>
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