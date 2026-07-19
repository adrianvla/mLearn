/**
 * Welcome Window App Component
 * Initial setup and language installation
 * Uses real IPC to install Python backend and configure language
 */

import { Component, Show, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useSettings, useLocalization, useLanguage } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { DEFAULT_SETTINGS, type Settings, type InstallOptions, type InstallerState, type LanguageDataCatalogStatus, type PipProgress } from '../../../shared/types';
import { Panel, Btn, AlertBanner, LogConsole, CheckboxCard, ProgressBar, Select } from '../../components/common';
import type { LogEntry } from '../../components/common/Text/LogConsole';
import './welcome.css';
import { getLogger } from '../../../shared/utils/logger';
import { getBundledLocaleCodes } from '../../../shared/bridges/bundledLanguageAssets';

const log = getLogger("renderer.welcome.app");
const CLICK_TO_BEGIN_KEY = 'mlearn.Installer.Instructions.ClickToBegin';
const NOT_STARTED_KEY = 'mlearn.Installer.Status.NotStarted';
const COMPLETE_KEY = 'mlearn.Installer.Status.Complete';

interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  compatible: boolean;
  minimumAppVersion?: string;
}

type DictionaryPackStatus = NonNullable<LanguageDataCatalogStatus['dictionaryPacks']>[number];
type Translate = (key: string, params?: Record<string, string | number>) => string;

function isIncompatibleLanguageStatus(
  status: LanguageDataCatalogStatus | DictionaryPackStatus,
): status is LanguageDataCatalogStatus {
  return 'compatible' in status && !status.compatible;
}

function languageDataStatusClass(status: LanguageDataCatalogStatus | DictionaryPackStatus): string {
  if (isIncompatibleLanguageStatus(status)) return 'incompatible';
  if (status.installed) return 'installed';
  if (status.outdated) return 'outdated';
  return 'missing';
}

function languageDataStatusLabel(
  status: LanguageDataCatalogStatus | DictionaryPackStatus,
  t: Translate,
): string {
  if (isIncompatibleLanguageStatus(status)) {
    return t('mlearn.Settings.Language.LanguageData.RequiresAppVersion', {
      version: status.minimumAppVersion ?? '',
    });
  }
  if (status.installed) return t('mlearn.Settings.Language.LanguageData.Installed');
  if (status.outdated) return t('mlearn.Settings.Language.LanguageData.UpdateRequired');
  return t('mlearn.Settings.Language.LanguageData.MissingRequired');
}

const WELCOME_TEXTS = ['Welcome!', 'ようこそ！', 'Wilkommen!', 'Bienvenue!', '欢迎！', 'Добро пожаловать!'];

function uniqueLanguageCodes(...groups: Array<readonly string[]>): string[] {
  return [...new Set(groups.flat().filter(Boolean))];
}

function resolveInitialLanguageCode(preferredLanguage: string | undefined, availableLanguageCodes: readonly string[]): string {
  if (preferredLanguage && availableLanguageCodes.includes(preferredLanguage)) {
    return preferredLanguage;
  }

  return availableLanguageCodes[0] ?? '';
}

function resolveInitialUILanguageCode(preferredLanguage: string | undefined, availableLanguageCodes: readonly string[]): string {
  if (preferredLanguage && availableLanguageCodes.includes(preferredLanguage)) {
    return preferredLanguage;
  }

  if (availableLanguageCodes.includes(DEFAULT_SETTINGS.uiLanguage)) {
    return DEFAULT_SETTINGS.uiLanguage;
  }

  return availableLanguageCodes[0] ?? DEFAULT_SETTINGS.uiLanguage;
}

const WelcomeContent: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t, changeLanguage, isLoaded: isLocalizationLoaded } = useLocalization();
  const {
    langData,
    supportedLanguages,
    languageDataCatalog,
    getLanguageDataStatus,
    installLanguageData,
    languageDataInstallError,
  } = useLanguage();

  const catalogLanguageCodes = createMemo(() => languageDataCatalog().map((status) => status.language));
  const availableLanguageCodes = createMemo(() => {
    const catalogCodes = catalogLanguageCodes();
    return uniqueLanguageCodes(catalogCodes, supportedLanguages());
  });
  const availableLanguages = createMemo<LanguageOption[]>(() => availableLanguageCodes().map((code) => {
    const status = getLanguageDataStatus(code);
    return {
      code,
      name: langData[code]?.name ?? status?.name ?? code.toUpperCase(),
      nativeName: langData[code]?.name_translated ?? status?.nameTranslated ?? status?.name ?? code.toUpperCase(),
      compatible: status?.compatible !== false,
      minimumAppVersion: status?.minimumAppVersion,
    };
  }));
  const uiLanguageCodes = getBundledLocaleCodes();
  const uiLanguageOptions = createMemo(() => uiLanguageCodes.map((code) => ({
    value: code,
    label: t(`mlearn.LocaleNames.${code}`),
  })));

  const [installationStarted, setInstallationStarted] = createSignal(false);
  const [installationCompleted, setInstallationCompleted] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [statusLogs, setStatusLogs] = createSignal<LogEntry[]>([{ message: t(CLICK_TO_BEGIN_KEY), level: 'info' }]);
  const [overallStatus, setOverallStatus] = createSignal(t(NOT_STARTED_KEY));
  const [networkError, setNetworkError] = createSignal<string | null>(null);

  const [includeLLM, setIncludeLLM] = createSignal(true);
  const [includeOCR, setIncludeOCR] = createSignal(true);
  const [includeVoice, setIncludeVoice] = createSignal(true);

  const [selectedLanguage, setSelectedLanguage] = createSignal<string>(resolveInitialLanguageCode(settings.language, availableLanguageCodes()));
  const [selectedUILanguage, setSelectedUILanguage] = createSignal<string>(resolveInitialUILanguageCode(settings.uiLanguage, uiLanguageCodes));
  const [selectedDictionaryTargetLanguage, setSelectedDictionaryTargetLanguage] = createSignal('');
  const [isAdvancedOpen, setIsAdvancedOpen] = createSignal(false);
  const [pendingLanguageInstall, setPendingLanguageInstall] = createSignal<string | null>(null);
  const [isFinalizingSetup, setIsFinalizingSetup] = createSignal(false);

  const [welcomeTextIndex, setWelcomeTextIndex] = createSignal(0);
  const [welcomeFading, setWelcomeFading] = createSignal(false);
  const [restartCountdown, setRestartCountdown] = createSignal<number | null>(null);
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const logInfo = (message: string) => {
    setStatusLogs(prev => [...prev, { message }]);
  };

  const installCompleted = () => {
    if (installationCompleted()) return;
    setInstallationCompleted(true);
    setInstallationStarted(false);
    setProgress(100);
    setOverallStatus(t(COMPLETE_KEY));
    const waitingMessages = new Set([CLICK_TO_BEGIN_KEY, t(CLICK_TO_BEGIN_KEY)]);
    setStatusLogs((prev) => [
      ...prev.filter((entry) => !waitingMessages.has(entry.message)),
      { message: t(COMPLETE_KEY) },
    ]);
  };

  const setWaitingState = (opts?: InstallOptions) => {
    if (installationCompleted()) return;
    setInstallationStarted(false);
    setProgress(0);
    setOverallStatus(t(NOT_STARTED_KEY));
    setStatusLogs([{ message: t(CLICK_TO_BEGIN_KEY), level: 'info' }]);
    if (opts) {
      setIncludeLLM(opts.includeLLM ?? true);
      setIncludeOCR(opts.includeOCR ?? true);
      setIncludeVoice(opts.includeVoice ?? true);
    }
  };

  const handleInstall = async () => {
    if (installationStarted()) return;

    setInstallationStarted(true);
    setNetworkError(null);
    setProgress(5);
    setOverallStatus(t('mlearn.Installer.Status.Installing'));
    setStatusLogs([]);
    logInfo(includeLLM() ? t('mlearn.Installer.Status.LlmWillInstall') : t('mlearn.Installer.Status.LlmSkip'));
    logInfo(includeOCR() ? t('mlearn.Installer.Status.OcrWillInstall') : t('mlearn.Installer.Status.OcrSkip'));
    logInfo(includeVoice() ? t('mlearn.Installer.Status.VoiceWillInstall') : t('mlearn.Installer.Status.VoiceSkip'));

    try {
      getBridge().installer.startInstall({ includeLLM: includeLLM(), includeOCR: includeOCR(), includeVoice: includeVoice() });
    } catch (e) {
      log.error('Failed to start installation:', e);
      setOverallStatus(t('mlearn.Installer.Status.CouldNotStart'));
      setInstallationStarted(false);
    }
  };

  const handleCancelInstall = () => {
    getBridge().installer.cancelInstall();
    setInstallationStarted(false);
    setOverallStatus(t('mlearn.Installer.Status.NotStarted'));
  };

  const selectedLanguageDataStatus = createMemo(() => getLanguageDataStatus(selectedLanguage()));
  const dictionaryTargetOptions = createMemo(() => selectedLanguageDataStatus()?.dictionaryPacks ?? []);
  const isDictionaryTargetRequired = createMemo(() => dictionaryTargetOptions().length > 0);
  const hasValidDictionaryTargetSelection = createMemo(() => {
    if (!isDictionaryTargetRequired()) return true;
    const target = selectedDictionaryTargetLanguage();
    return Boolean(target && dictionaryTargetOptions().some((pack) => pack.targetLanguage === target));
  });
  const isPreferredDictionaryTargetAvailable = createMemo(() => {
    const target = selectedUILanguage();
    return Boolean(target && dictionaryTargetOptions().some((pack) => pack.targetLanguage === target));
  });
  const shouldShowDictionaryTargetWarning = createMemo(() => (
    isDictionaryTargetRequired() &&
    Boolean(selectedUILanguage()) &&
    !isPreferredDictionaryTargetAvailable()
  ));
  const availableDictionaryTargetLabels = createMemo(() => (
    dictionaryTargetOptions().map((pack) => pack.name).join(', ')
  ));
  const selectedDictionaryPackStatus = createMemo(() => {
    const target = selectedDictionaryTargetLanguage();
    return dictionaryTargetOptions().find((pack) => pack.targetLanguage === target);
  });
  const selectedLanguageOption = createMemo(() => availableLanguages().find((lang) => lang.code === selectedLanguage()));
  const selectedUILanguageLabel = createMemo(() => uiLanguageOptions().find((lang) => lang.value === selectedUILanguage())?.label ?? selectedUILanguage().toUpperCase());
  const selectedDictionaryTargetLabel = createMemo(() => {
    const target = selectedDictionaryTargetLanguage();
    if (!target) return t('mlearn.Installer.Summary.NotAvailable');
    const localeName = t(`mlearn.LocaleNames.${target}`);
    return localeName === `mlearn.LocaleNames.${target}` ? target.toUpperCase() : localeName;
  });
  const selectedDictionaryRoute = createMemo(() => {
    const source = selectedLanguageOption()?.name ?? selectedLanguage().toUpperCase();
    const target = selectedDictionaryTargetLabel();
    return `${source}\u2192${target}`;
  });
  const isSelectedLanguageDataReady = (languageCode: string): boolean => {
    const status = getLanguageDataStatus(languageCode);
    if (status?.compatible === false) return false;
    const dictionaryTarget = selectedDictionaryTargetLanguage();
    const dictionaryPack = status?.dictionaryPacks?.find((pack) => pack.targetLanguage === dictionaryTarget);
    return Boolean((!status || status.installed) && hasValidDictionaryTargetSelection() && (!dictionaryTarget || dictionaryPack?.installed));
  };
  const selectedLanguageDataNeedsUpdate = createMemo(() => {
    const status = getLanguageDataStatus(selectedLanguage());
    const dictionaryTarget = selectedDictionaryTargetLanguage();
    const dictionaryPack = status?.dictionaryPacks?.find((pack) => pack.targetLanguage === dictionaryTarget);
    return Boolean(status?.outdated || dictionaryPack?.outdated);
  });
  const primaryActionLabel = createMemo(() => {
    if (!installationCompleted()) {
      return t('mlearn.Installer.Buttons.StartInstallation');
    }
    if (isSelectedLanguageDataReady(selectedLanguage())) {
      return t('mlearn.Installer.Buttons.FinishSetup');
    }
    const status = selectedLanguageDataStatus();
    if (status?.compatible === false) {
      return t('mlearn.Settings.Language.LanguageData.RequiresAppVersion', {
        version: status.minimumAppVersion ?? '',
      });
    }
    if (selectedLanguageDataNeedsUpdate()) {
      return t('mlearn.Installer.Buttons.UpdateLanguageData');
    }
    return t('mlearn.Installer.Buttons.InstallLanguageData');
  });

  const saveSetupSettingsAndRestart = (languageCode: string) => {
    if (isFinalizingSetup()) return;
    setIsFinalizingSetup(true);
    const dictionaryTarget = selectedDictionaryTargetLanguage();
    const settingsToSave: Partial<Settings> = {
      language: languageCode,
      uiLanguage: selectedUILanguage(),
      llmEnabled: includeLLM(),
      ocrEnabled: includeOCR(),
      voiceEnabled: includeVoice(),
    };
    if (dictionaryTarget) {
      settingsToSave.dictionaryTargetLanguages = {
        ...(settings.dictionaryTargetLanguages ?? DEFAULT_SETTINGS.dictionaryTargetLanguages),
        [languageCode]: dictionaryTarget,
      };
    }

    updateSettings(settingsToSave);

    const bridge = getBridge();
    const settingsSavedCleanup = bridge.settings.onSettingsSaved(() => {
      settingsSavedCleanup();
      setOverallStatus(t('mlearn.Installer.Status.LanguageInstalledRestarting'));
      setRestartCountdown(3);
      const countdownInterval = setInterval(() => {
        setRestartCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(countdownInterval);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
      restartTimer = setTimeout(() => {
        clearInterval(countdownInterval);
        setRestartCountdown(null);
        bridge.server.completeInitialSetup();
      }, 3000);
    });
  };

  const handleContinue = () => {
    const languageCode = selectedLanguage();
    if (!installationCompleted() || !languageCode || pendingLanguageInstall()) return;
    if (!hasValidDictionaryTargetSelection()) {
      setIsAdvancedOpen(true);
      setOverallStatus(t('mlearn.Installer.DictionaryTarget.Unavailable', {
        language: selectedUILanguageLabel(),
        available: availableDictionaryTargetLabels(),
      }));
      return;
    }

    if (isSelectedLanguageDataReady(languageCode)) {
      saveSetupSettingsAndRestart(languageCode);
      return;
    }

    setPendingLanguageInstall(languageCode);
    setProgress(96);
    setOverallStatus(t('mlearn.Installer.Status.InstallingLanguageData'));
    logInfo(t('mlearn.Installer.Status.InstallingLanguageData'));
    installLanguageData(languageCode, selectedDictionaryTargetLanguage() || undefined, {
      includeLLM: includeLLM(),
      includeOCR: includeOCR(),
      includeVoice: includeVoice(),
    });
  };

  const handleUILanguageChange = (languageCode: string) => {
    setSelectedUILanguage(languageCode);
    const matchingPack = dictionaryTargetOptions().find((pack) => pack.targetLanguage === languageCode);
    if (matchingPack) {
      setSelectedDictionaryTargetLanguage(languageCode);
    } else if (dictionaryTargetOptions().length > 0) {
      setSelectedDictionaryTargetLanguage('');
      setIsAdvancedOpen(true);
    }
    changeLanguage(languageCode);
  };

  const handleCancelRestart = () => {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    setRestartCountdown(null);
    setOverallStatus(t('mlearn.Installer.Status.Complete'));
  };

  const ipcCleanups: Array<() => void> = [];
  onMount(() => {
    const bridge = getBridge();

    ipcCleanups.push(bridge.installer.onPythonSuccess((success: boolean) => {
      if (success) installCompleted();
    }));

    ipcCleanups.push(bridge.server.onServerStatusUpdate((status: string) => {
      logInfo(status);

      if (status.includes('Installing Python dependencies')) {
        setProgress(2);
      } else if (status === 'Downloading Python...') {
        setProgress(5);
      } else if (status.includes('Download complete')) {
        setProgress(30);
      } else if (status.includes('Extraction complete')) {
        setProgress(40);
        setOverallStatus(t('mlearn.Installer.Status.InstallingPackages'));
      } else if (status === 'Installation complete') {
        installCompleted();
      } else if (status.toLowerCase().includes('error')) {
        setOverallStatus(t('mlearn.Installer.Status.ErrorOccurred'));
      }
    }));

    ipcCleanups.push(bridge.installer.onPipProgress((pipProgress: PipProgress) => {
      if (pipProgress.action === 'complete') {
        setProgress(95);
      } else if (pipProgress.action === 'installing') {
        // "Installing collected packages" — near the end
        setProgress(90);
        setOverallStatus(t('mlearn.Installer.Status.InstallingPackages'));
      } else {
        // Use asymptotic curve: progress approaches 90% as package count grows
        // Formula: 40 + 50 * (1 - 1/(1 + count/10)) — starts at 40%, approaches 90%
        const count = pipProgress.current;
        const pipPercent = Math.round(40 + 50 * (1 - 1 / (1 + count / 10)));
        setProgress(Math.min(pipPercent, 89));

        if (pipProgress.packageName) {
          const actionKey = pipProgress.action === 'collecting'
            ? 'mlearn.Installer.Status.Collecting'
            : pipProgress.action === 'downloading'
              ? 'mlearn.Installer.Status.Downloading'
              : pipProgress.action === 'satisfied'
                ? 'mlearn.Installer.Status.AlreadySatisfied'
                : 'mlearn.Installer.Status.InstallingPackages';
          setOverallStatus(
            `${t(actionKey)} ${pipProgress.packageName} (${pipProgress.current})`
          );
        }
      }
    }));

    ipcCleanups.push(bridge.installer.onInstallStarted((opts: InstallOptions) => {
      if (!installationStarted()) {
        setInstallationStarted(true);
        setIncludeLLM(opts.includeLLM ?? true);
        setIncludeOCR(opts.includeOCR ?? true);
        setIncludeVoice(opts.includeVoice ?? true);
      }
    }));

    ipcCleanups.push(bridge.installer.onInstallerAwaitingChoice(() => {
      setWaitingState({ includeLLM: includeLLM(), includeOCR: includeOCR(), includeVoice: includeVoice() });
    }));

    ipcCleanups.push(bridge.installer.onInstallerNetworkError((payload: { message: string; detail?: string }) => {
      const message = typeof payload === 'string' ? payload : payload.message;
      const detail = typeof payload === 'object' ? payload.detail : undefined;
      if (detail) logInfo(detail);
      setOverallStatus(message);
      setNetworkError(detail ? `${message}\n\nDetails: ${detail}` : message);
      setWaitingState({ includeLLM: includeLLM(), includeOCR: includeOCR(), includeVoice: includeVoice() });
    }));

    ipcCleanups.push(bridge.installer.onInstallerState((state: InstallerState) => {
      if (state.success) {
        installCompleted();
        return;
      }
      if (state.inProgress && !installationStarted()) {
        setInstallationStarted(true);
        if (state.options) {
          setIncludeLLM(state.options.includeLLM ?? true);
          setIncludeOCR(state.options.includeOCR ?? true);
        }
        return;
      }
      if (state.waiting) {
        setWaitingState(state.options);
      }
    }));

    ipcCleanups.push(bridge.settings.onSettings((settings: Settings) => {
      setSelectedLanguage(resolveInitialLanguageCode(settings.language, availableLanguageCodes()));
      setSelectedUILanguage(resolveInitialUILanguageCode(settings.uiLanguage, uiLanguageCodes));
      if (settings.llmEnabled !== undefined) {
        setIncludeLLM(settings.llmEnabled !== false);
      }
      if (settings.ocrEnabled !== undefined) {
        setIncludeOCR(settings.ocrEnabled !== false);
      }
      if (settings.voiceEnabled !== undefined) {
        setIncludeVoice(settings.voiceEnabled !== false);
      }
    }));

    bridge.installer.requestInstallerState();
    bridge.server.isSuccess();
    bridge.settings.getSettings();
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
  });

  createEffect(() => {
    const currentSelection = selectedLanguage();
    const languageCodes = availableLanguageCodes();

    if (languageCodes.length === 0) {
      if (currentSelection) {
        setSelectedLanguage('');
      }
      return;
    }

    if (!currentSelection || !languageCodes.includes(currentSelection)) {
      setSelectedLanguage(resolveInitialLanguageCode(settings.language, languageCodes));
    }
  });

  createEffect(() => {
    if (!isLocalizationLoaded() || installationStarted() || installationCompleted()) return;

    setOverallStatus(t(NOT_STARTED_KEY));
    setStatusLogs((prev) => {
      if (prev.length !== 1 || prev[0]?.message !== CLICK_TO_BEGIN_KEY) {
        return prev;
      }
      return [{ message: t(CLICK_TO_BEGIN_KEY), level: 'info' }];
    });
  });

  createEffect(() => {
    const options = dictionaryTargetOptions();
    if (options.length === 0) {
      if (selectedDictionaryTargetLanguage()) {
        setSelectedDictionaryTargetLanguage('');
      }
      return;
    }

    const preferredTarget = selectedUILanguage();
    const currentTarget = selectedDictionaryTargetLanguage();
    if (currentTarget && options.some((option) => option.targetLanguage === currentTarget)) {
      return;
    }

    if (preferredTarget && options.some((option) => option.targetLanguage === preferredTarget)) {
      setSelectedDictionaryTargetLanguage(preferredTarget);
      return;
    }

    setSelectedDictionaryTargetLanguage('');
    setIsAdvancedOpen(true);
  });

  createEffect(() => {
    const languageCode = pendingLanguageInstall();
    if (!languageCode) return;

    const error = languageDataInstallError();
    if (error?.language === languageCode) {
      setNetworkError(error.error);
      setOverallStatus(t('mlearn.Installer.Status.ErrorOccurred'));
      setPendingLanguageInstall(null);
      return;
    }

    if (isSelectedLanguageDataReady(languageCode)) {
      setPendingLanguageInstall(null);
      saveSetupSettingsAndRestart(languageCode);
    }
  });

  createEffect(() => {
    const interval = setInterval(() => {
      setWelcomeFading(true);
      setTimeout(() => {
        setWelcomeTextIndex(prev => (prev + 1) % WELCOME_TEXTS.length);
        setWelcomeFading(false);
      }, 1000);
    }, 3000);
    return () => clearInterval(interval);
  });

  return (
    <div class="welcome-window">
      <div class="welcome-window__dragger" />

      <h1 class={`welcome-window__heading ${welcomeFading() ? 'welcome-window__heading--fading' : ''}`}>
        {WELCOME_TEXTS[welcomeTextIndex()]}
      </h1>

      <ProgressBar
        value={progress()}
        class="welcome-window__progress"
        size="lg"
        variant="primary"
        rounded
        animated
      />

      <Panel
        variant="default"
        rounded="xl"
        padding="xl"
        class="welcome-window__panel"
      >
        <p class="welcome-window__info">
          <Show when={!installationStarted() && !installationCompleted()}>
            {t('mlearn.Installer.Instructions.ChooseComponents')}
          </Show>
          <Show when={installationStarted() && !installationCompleted()}>
            {t('mlearn.Installer.Status.Installing')}
          </Show>
          <Show when={installationCompleted()}>
            {t('mlearn.Installer.Status.Complete')}
          </Show>
        </p>

        <Show when={!installationStarted() && !installationCompleted()}>
          <div class="welcome-window__options">
            <CheckboxCard
              checked={includeLLM()}
              onChange={setIncludeLLM}
              title={t('mlearn.Installer.Components.ExplainAi.Title')}
              description={t('mlearn.Installer.Components.ExplainAi.Description')}
            />
            <CheckboxCard
              checked={includeOCR()}
              onChange={setIncludeOCR}
              title={t('mlearn.Installer.Components.Reader.Title')}
              description={t('mlearn.Installer.Components.Reader.Description')}
            />
            <CheckboxCard
              checked={includeVoice()}
              onChange={setIncludeVoice}
              title={t('mlearn.Installer.Components.Voice.Title')}
              description={t('mlearn.Installer.Components.Voice.Description')}
            />
          </div>
        </Show>

        <Show when={!installationStarted()}>
          <div class="welcome-window__setup-sentence">
            <span>{t('mlearn.Installer.SetupSentence.LearnPrefix')}</span>
            <Select
              class="welcome-window__sentence-select"
              value={selectedLanguage()}
              onChange={(event) => {
                if (getLanguageDataStatus(event.currentTarget.value)?.compatible === false) return;
                setSelectedLanguage(event.currentTarget.value);
              }}
              options={availableLanguages().map((lang) => ({
                value: lang.code,
                label: lang.compatible
                  ? `${lang.name} (${lang.nativeName})`
                  : `${lang.name} (${lang.nativeName}) — ${t('mlearn.Settings.Language.LanguageData.RequiresAppVersion', {
                    version: lang.minimumAppVersion ?? '',
                  })}`,
                disabled: !lang.compatible && lang.code !== selectedLanguage(),
              }))}
            />
            <span>{t('mlearn.Installer.SetupSentence.AppLanguagePrefix')}</span>
            <Select
              class="welcome-window__sentence-select"
              value={selectedUILanguage()}
              onChange={(event) => handleUILanguageChange(event.currentTarget.value)}
              options={uiLanguageOptions()}
            />
            <span>{t('mlearn.Installer.SetupSentence.AppLanguageSuffix')}</span>
          </div>
          <div class="welcome-window__summary">
            <span>{t('mlearn.Installer.Summary.LearningLanguage', { language: selectedLanguageOption()?.name ?? selectedLanguage().toUpperCase() })}</span>
            <span>{t('mlearn.Installer.Summary.DisplayLanguage', { language: selectedUILanguageLabel() })}</span>
            <span>{t('mlearn.Installer.Summary.DictionaryLanguage', { language: selectedDictionaryRoute() })}</span>
          </div>
          <Show when={selectedLanguageDataStatus()?.compatible === false}>
            <p class="welcome-window__dictionary-target-warning">
              {languageDataStatusLabel(selectedLanguageDataStatus()!, t)}
            </p>
          </Show>
          <Show when={dictionaryTargetOptions().length > 0}>
            <details
              class="welcome-window__advanced"
              open={isAdvancedOpen()}
              onToggle={(event) => setIsAdvancedOpen(event.currentTarget.open)}
            >
              <summary>{t('mlearn.Installer.Advanced.Title')}</summary>
              <div class="welcome-window__dictionary-target">
                <span>{t('mlearn.Installer.SetupSentence.DictionaryPrefix')}</span>
                <Select
                  class="welcome-window__sentence-select"
                  value={selectedDictionaryTargetLanguage()}
                  placeholder={t('mlearn.Installer.DictionaryTarget.ChooseAvailable')}
                  onChange={(event) => setSelectedDictionaryTargetLanguage(event.currentTarget.value)}
                  options={dictionaryTargetOptions().map((pack) => ({
                    value: pack.targetLanguage,
                    label: pack.name,
                  }))}
                />
                <Show when={shouldShowDictionaryTargetWarning()}>
                  <p class="welcome-window__dictionary-target-warning">
                    {t('mlearn.Installer.DictionaryTarget.Unavailable', {
                      language: selectedUILanguageLabel(),
                      available: availableDictionaryTargetLabels(),
                    })}
                  </p>
                </Show>
                <Show when={selectedDictionaryPackStatus()}>
                  {(pack) => (
                    <span class={`welcome-window__dictionary-target-status ${languageDataStatusClass(pack())}`}>
                      {languageDataStatusLabel(pack(), t)}
                    </span>
                  )}
                </Show>
              </div>
            </details>
          </Show>
          <p class="welcome-window__download-note">
            {t('mlearn.Installer.Instructions.LanguageUnlocks')}
          </p>
        </Show>

        <Show when={installationStarted() || installationCompleted()}>
          <LogConsole
            logs={statusLogs()}
            title={overallStatus()}
            size="md"
            autoScroll={true}
            showTimestamps={false}
            height="150px"
          />
        </Show>

        <Show when={networkError()}>
          <AlertBanner
            variant="error"
            title={t('mlearn.Installer.Alerts.NetworkError')}
            message={networkError()!}
            closable
            onClose={() => setNetworkError(null)}
          />
        </Show>

        <Show when={restartCountdown() !== null}>
          <Btn
            variant="secondary"
            onClick={handleCancelRestart}
            class="welcome-window__action"
          >
            {t('mlearn.Installer.Buttons.CancelRestart')} ({restartCountdown()})
          </Btn>
        </Show>
        <Show when={restartCountdown() === null}>
          <Show when={installationStarted() && !installationCompleted()}>
            <Btn
              variant="secondary"
              onClick={handleCancelInstall}
              class="welcome-window__action"
            >
              {t('mlearn.Installer.Buttons.CancelInstall')}
            </Btn>
          </Show>
          <Show when={!installationStarted() || installationCompleted()}>
            <Btn
              variant="primary"
              onClick={() => {
                if (installationCompleted()) {
                  handleContinue();
                } else {
                  void handleInstall();
                }
              }}
              disabled={
                (installationStarted() && !installationCompleted()) ||
                !selectedLanguage() ||
                selectedLanguageDataStatus()?.compatible === false ||
                !hasValidDictionaryTargetSelection() ||
                Boolean(pendingLanguageInstall()) ||
                isFinalizingSetup()
              }
              class="welcome-window__action"
            >
              {primaryActionLabel()}
            </Btn>
          </Show>
        </Show>
      </Panel>
    </div>
  );
};

export const WelcomeApp: Component = () => {
  return (
    <WindowWrapper>
      <WelcomeContent />
    </WindowWrapper>
  );
};

export default WelcomeApp;
