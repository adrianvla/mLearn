/**
 * Main Window Loading Overlay
 * Displays loading state during app initialization
 * Uses the standardized LoadingOverlay component from common/Modal
 */

import { Component, createMemo, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { useServer, useSettings, useLanguage, useLocalization } from '../../../context';
import { LoadingOverlay as BaseLoadingOverlay } from '../../../components/common/Modal/LoadingOverlay';
import { ErrorModal } from '../../../components/common/Modal/ErrorModal';
import { Modal } from '../../../components/common/Modal/Modal';
import { Btn } from '../../../components/common/Button/Button';
import { showToast } from '../../../components/common/Feedback/Toast';
import { getBridge } from '../../../../shared/bridges';
import { WINDOW_TYPES } from '../../../../shared/constants';
import { DEFAULT_SETTINGS, type InstallOptions, type LanguageDataCatalogStatus, type Settings } from '../../../../shared/types';
import { getLogger } from '../../../../shared/utils/logger';
import './LoadingOverlay.css';

const log = getLogger("renderer.main.loadingOverlay");
const INSTALLER_REQUIRED_FRAGMENT = 'Python runtime is not installed';

export function isInstallerRequiredError(message: string | null | undefined): boolean {
  return Boolean(message?.includes(INSTALLER_REQUIRED_FRAGMENT));
}

export function buildInstallOptionsFromSettings(settings: Settings): InstallOptions {
  return {
    includeLLM: settings.llmEnabled ?? DEFAULT_SETTINGS.llmEnabled,
    includeOCR: settings.ocrEnabled ?? DEFAULT_SETTINGS.ocrEnabled,
    includeVoice: settings.voiceEnabled ?? DEFAULT_SETTINGS.voiceEnabled,
  };
}

export function startRequiredComponentRepair(settings: Settings): void {
  getBridge().installer.startInstall(buildInstallOptionsFromSettings(settings));
}

export type LanguageSetupRequirement =
  | { required: false }
  | { required: true; reason: 'learning-language' | 'dictionary-language' | 'learning-language-update' | 'dictionary-language-update' };

export interface LanguageDataUpdateTarget {
  language: string;
  dictionaryTargetLanguage?: string;
}

export function getLanguageDataUpdateTarget(
  settings: Pick<Settings, 'language' | 'dictionaryTargetLanguages'>,
  requirement: LanguageSetupRequirement,
): LanguageDataUpdateTarget | null {
  if (
    !requirement.required
    || !settings.language
    || (requirement.reason !== 'learning-language-update' && requirement.reason !== 'dictionary-language-update')
  ) {
    return null;
  }

  return {
    language: settings.language,
    dictionaryTargetLanguage: settings.dictionaryTargetLanguages?.[settings.language],
  };
}

export function getLanguageSetupRequirement(
  settings: Pick<Settings, 'language' | 'dictionaryTargetLanguages'>,
  hasCurrentLanguageData: boolean,
  activeLanguageStatus?: LanguageDataCatalogStatus,
): LanguageSetupRequirement {
  if (!settings.language || !hasCurrentLanguageData) {
    return { required: true, reason: 'learning-language' };
  }
  if (activeLanguageStatus?.outdated) {
    return { required: true, reason: 'learning-language-update' };
  }

  const dictionaryTarget = settings.dictionaryTargetLanguages?.[settings.language];
  if (!dictionaryTarget) {
    return { required: false };
  }

  const dictionaryPack = activeLanguageStatus?.dictionaryPacks?.find(
    (pack) => pack.targetLanguage === dictionaryTarget,
  );
  if (dictionaryPack && !dictionaryPack.installed) {
    return {
      required: true,
      reason: dictionaryPack.outdated ? 'dictionary-language-update' : 'dictionary-language',
    };
  }

  return { required: false };
}

export const LoadingOverlay: Component = () => {
  const server = useServer();
  const settings = useSettings();
  const language = useLanguage();
  const { t } = useLocalization();
  
  // Track critical errors from the server
  const [criticalError, setCriticalError] = createSignal<{ message: string; details?: string } | null>(null);

  const displayedError = createMemo(() => {
    const explicitError = criticalError();
    if (explicitError) return explicitError;
    if (server.status() !== 'error') return null;
    return {
      message: server.error() || server.statusMessage() || t('mlearn.ErrorModal.Messages.BackendStopped'),
      details: server.error() ? server.statusMessage() : undefined,
    };
  });

  const isInstallerRequired = createMemo(() => (
    isInstallerRequiredError(server.error()) || isInstallerRequiredError(server.statusMessage())
  ));

  const languageSetupRequirement = createMemo(() => {
    if (settings.isLoading() || language.isLoading()) {
      return { required: false } as LanguageSetupRequirement;
    }

    return getLanguageSetupRequirement(
      settings.settings,
      Boolean(language.currentLangData()),
      language.getLanguageDataStatus(settings.settings.language),
    );
  });
  const languageSetupMessage = createMemo(() => {
    const requirement = languageSetupRequirement();
    if (!requirement.required) {
      return '';
    }
    if (requirement.reason === 'dictionary-language-update') {
      return t('mlearn.LanguageSetup.DictionaryUpdateMessage');
    }
    if (requirement.reason === 'learning-language-update') {
      return t('mlearn.LanguageSetup.LanguageUpdateMessage');
    }
    return requirement.reason === 'dictionary-language'
      ? t('mlearn.LanguageSetup.DictionaryMessage')
      : t('mlearn.LanguageSetup.LanguageMessage');
  });
  const languageDataUpdateTarget = createMemo(() => getLanguageDataUpdateTarget(
    settings.settings,
    languageSetupRequirement(),
  ));
  const isLanguageDataUpdating = createMemo(() => {
    const target = languageDataUpdateTarget();
    return Boolean(target && language.isLanguageDataInstalling(
      target.language,
      target.dictionaryTargetLanguage,
    ));
  });
  const languageDataUpdateError = createMemo(() => {
    const target = languageDataUpdateTarget();
    const error = language.languageDataInstallError();
    if (!target || !error || error.language !== target.language) return null;
    if (error.dictionaryTargetLanguage !== target.dictionaryTargetLanguage) return null;
    return error.error;
  });
  const languageDataUpdateMessage = createMemo(() => {
    if (languageDataUpdateError()) return t('mlearn.LanguageSetup.UpdateFailed');
    if (isLanguageDataUpdating()) return t('mlearn.LanguageSetup.UpdatingMessage');
    return languageSetupMessage();
  });

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
      log.warn('[LoadingOverlay] Anki connection error received:', reason);
      showToast({
        variant: 'warning',
        title: t('mlearn.ErrorModal.Title.AnkiError'),
        message:
          reason === 'no_valid_cards'
            ? t('mlearn.ErrorModal.Messages.AnkiNoValidCards')
            : t('mlearn.ErrorModal.Messages.AnkiConnectionFailed'),
        duration: 8000,
      });
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

  const handleInstallComponents = () => {
    setCriticalError(null);
    startRequiredComponentRepair(settings.settings);
  };

  const handleOpenLanguageSetup = () => {
    getBridge().window.openWindow({ type: WINDOW_TYPES.WELCOME });
  };

  const handleLanguageDataUpdate = () => {
    const target = languageDataUpdateTarget();
    if (!target) return;
    language.installLanguageData(target.language, target.dictionaryTargetLanguage);
  };

  const handleQuit = () => {
    getBridge().window.closeWindow();
  };

  return (
    <>
      {/* Error modal - shown when there's a critical error */}
      <Show when={displayedError()}>
        {(error) => (
          <ErrorModal
            isOpen={true}
            severity={isInstallerRequired() ? 'warning' : 'fatal'}
            title={isInstallerRequired()
              ? t('mlearn.Installer.Title.ComponentsRequired')
              : t('mlearn.ErrorModal.Title.StartupError')}
            message={error().message}
            details={error().details}
            onRetry={handleRetry}
            onQuit={handleQuit}
            showRetry={!isInstallerRequired()}
            showQuit={true}
            actions={isInstallerRequired() && (
              <Btn
                variant="primary"
                onClick={handleInstallComponents}
              >
                {t('mlearn.Installer.Buttons.InstallRequiredComponents')}
              </Btn>
            )}
          />
        )}
      </Show>

      <Show when={!displayedError() && languageSetupRequirement().required}>
        <Show
          when={languageDataUpdateTarget()}
          fallback={(
            <ErrorModal
              isOpen={true}
              severity="warning"
              title={t('mlearn.LanguageSetup.Title')}
              message={languageSetupMessage()}
              showRetry={false}
              showQuit={false}
              actions={(
                <Btn
                  variant="primary"
                  onClick={handleOpenLanguageSetup}
                >
                  {t('mlearn.LanguageSetup.OpenSetup')}
                </Btn>
              )}
            />
          )}
        >
          <Modal
            isOpen={true}
            onClose={() => {}}
            title={t('mlearn.LanguageSetup.UpdateTitle')}
            size="md"
            closeOnEscape={false}
            closeOnOverlay={false}
            showCloseButton={false}
            headerDraggable
            footer={(
              <Btn
                variant="primary"
                onClick={handleLanguageDataUpdate}
                loading={isLanguageDataUpdating()}
              >
                {isLanguageDataUpdating()
                  ? t('mlearn.LanguageSetup.Updating')
                  : t('mlearn.LanguageSetup.UpdateNow')}
              </Btn>
            )}
          >
            <div class="language-data-update-modal__body">
              <p class="language-data-update-modal__message">{languageDataUpdateMessage()}</p>
              <Show when={languageDataUpdateError()}>
                {(error) => <p class="language-data-update-modal__error">{error()}</p>}
              </Show>
            </div>
          </Modal>
        </Show>
      </Show>

      {/* Loading overlay - shown during initialization when no error */}
      <Show when={!displayedError()}>
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
