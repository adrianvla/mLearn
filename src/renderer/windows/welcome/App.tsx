/**
 * Welcome Window App Component
 * Initial setup and language installation
 * Uses real IPC to install Python backend and configure language
 */

import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useSettings, useLocalization } from '../../context';
import type { Settings, InstallOptions, InstallerState, PipProgress } from '../../../shared/types';
import { Panel, Btn, SelectableCard, AlertBanner, LogConsole, CheckboxCard, ProgressBar } from '../../components/common';
import type { LogEntry } from '../../components/common/Text/LogConsole';
import './welcome.css';

interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  available: boolean;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', available: true },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳', available: true },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', available: true },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', available: true },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', available: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', available: false },
];

const WELCOME_TEXTS = ['Welcome!', 'ようこそ！', 'Wilkommen!', 'Bienvenue!', '欢迎！', 'Добро пожаловать!'];

const WelcomeContent: Component = () => {
  const { updateSettings } = useSettings();
  const { t } = useLocalization();

  const [installationStarted, setInstallationStarted] = createSignal(false);
  const [installationCompleted, setInstallationCompleted] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [statusLogs, setStatusLogs] = createSignal<LogEntry[]>([{ message: t('mlearn.Installer.Instructions.ClickToBegin'), level: 'info' }]);
  const [overallStatus, setOverallStatus] = createSignal(t('mlearn.Installer.Status.NotStarted'));
  const [networkError, setNetworkError] = createSignal<string | null>(null);

  const [includeLLM, setIncludeLLM] = createSignal(true);
  const [includeOCR, setIncludeOCR] = createSignal(true);

  const [selectedLanguage, setSelectedLanguage] = createSignal<string>('ja');

  const [welcomeTextIndex, setWelcomeTextIndex] = createSignal(0);
  const [welcomeFading, setWelcomeFading] = createSignal(false);

  const logInfo = (message: string) => {
    const level = message.toLowerCase().includes('error') ? 'error' as const : 
                  message.toLowerCase().includes('complete') ? 'success' as const : 'info' as const;
    setStatusLogs(prev => [...prev, { message, level }]);
  };

  const installCompleted = () => {
    setInstallationCompleted(true);
    setInstallationStarted(false);
    setProgress(100);
    setOverallStatus(t('mlearn.Installer.Status.Complete'));
    logInfo(t('mlearn.Installer.Status.Complete'));
  };

  const setWaitingState = (opts?: InstallOptions) => {
    if (installationCompleted()) return;
    setInstallationStarted(false);
    setProgress(0);
    setOverallStatus(t('mlearn.Installer.Status.NotStarted'));
    setStatusLogs([{ message: t('mlearn.Installer.Instructions.ClickToBegin'), level: 'info' }]);
    if (opts) {
      setIncludeLLM(opts.includeLLM ?? true);
      setIncludeOCR(opts.includeOCR ?? true);
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

    try {
      const mLearnIPC = (window as unknown as { mLearnIPC?: typeof window.mLearnIPC }).mLearnIPC;
      if (mLearnIPC) {
        mLearnIPC.startInstall({ includeLLM: includeLLM(), includeOCR: includeOCR() });
      } else {
        throw new Error('IPC not available');
      }
    } catch (e) {
      console.error('Failed to start installation:', e);
      setOverallStatus(t('mlearn.Installer.Status.CouldNotStart'));
      setInstallationStarted(false);
    }
  };

  const handleContinue = () => {
    if (!installationCompleted()) return;

    updateSettings({ language: selectedLanguage() });

    const mLearnIPC = (window as unknown as { mLearnIPC?: typeof window.mLearnIPC }).mLearnIPC;
    if (mLearnIPC) {
      mLearnIPC.saveSettings({ language: selectedLanguage() } as Settings);
      const settingsSavedCleanup = mLearnIPC.onSettingsSaved(() => {
        settingsSavedCleanup();
        setOverallStatus(t('mlearn.Installer.Status.LanguageInstalledRestarting'));
        setTimeout(() => {
          fetch('http://127.0.0.1:7753/quit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }).catch(() => { /* ignore */ });
          mLearnIPC.forceRestartApp();
        }, 5000);
      });
    }
  };

  const ipcCleanups: Array<() => void> = [];
  onMount(() => {
    const mLearnIPC = (window as unknown as { mLearnIPC?: typeof window.mLearnIPC }).mLearnIPC;
    if (!mLearnIPC) return;

    ipcCleanups.push(mLearnIPC.onPythonSuccess((success: boolean) => {
      if (success) installCompleted();
    }));

    ipcCleanups.push(mLearnIPC.onServerStatusUpdate((status: string) => {
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

    ipcCleanups.push(mLearnIPC.onPipProgress((pipProgress: PipProgress) => {
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

    ipcCleanups.push(mLearnIPC.onInstallStarted((opts: InstallOptions) => {
      if (!installationStarted()) {
        setInstallationStarted(true);
        setIncludeLLM(opts.includeLLM ?? true);
        setIncludeOCR(opts.includeOCR ?? true);
      }
    }));

    ipcCleanups.push(mLearnIPC.onInstallerAwaitingChoice(() => {
      setWaitingState({ includeLLM: includeLLM(), includeOCR: includeOCR() });
    }));

    ipcCleanups.push(mLearnIPC.onInstallerNetworkError((payload: { message: string; detail?: string }) => {
      const message = typeof payload === 'string' ? payload : payload.message;
      const detail = typeof payload === 'object' ? payload.detail : undefined;
      if (detail) logInfo(detail);
      setOverallStatus(message);
      setNetworkError(detail ? `${message}\n\nDetails: ${detail}` : message);
      setWaitingState({ includeLLM: includeLLM(), includeOCR: includeOCR() });
    }));

    ipcCleanups.push(mLearnIPC.onInstallerState((state: InstallerState) => {
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

    ipcCleanups.push(mLearnIPC.onSettings((settings: Settings) => {
      if (settings.llmEnabled !== undefined) {
        setIncludeLLM(settings.llmEnabled !== false);
      }
      if (settings.ocrEnabled !== undefined) {
        setIncludeOCR(settings.ocrEnabled !== false);
      }
    }));

    mLearnIPC.requestInstallerState();
    mLearnIPC.isSuccess();
    mLearnIPC.getSettings();
  });

  onCleanup(() => {
    for (const cleanup of ipcCleanups) cleanup();
    ipcCleanups.length = 0;
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
            <br />
            {t('mlearn.Installer.Instructions.LanguageUnlocks')}
            <br />
            {t('mlearn.Installer.Instructions.ForgetSomething')}
            <br />
            <strong>{t('mlearn.Installer.Instructions.DownloadNote')}</strong>
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
          </div>
        </Show>

        <Show when={installationCompleted()}>
          <div class="welcome-window__languages">
            <For each={LANGUAGES}>
              {(lang) => (
                <SelectableCard
                  selected={selectedLanguage() === lang.code}
                  disabled={!lang.available}
                  onClick={() => setSelectedLanguage(lang.code)}
                  icon={lang.flag}
                  title={lang.name}
                  subtitle={lang.available ? lang.nativeName : t('mlearn.Global.ComingSoon')}
                />
              )}
            </For>
          </div>
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

        <Btn
          variant="primary"
          onClick={installationCompleted() ? handleContinue : handleInstall}
          disabled={installationStarted() && !installationCompleted()}
          class="welcome-window__action"
        >
          <Show when={!installationStarted() && !installationCompleted()}>{t('mlearn.Installer.Buttons.StartInstallation')}</Show>
          <Show when={installationStarted() && !installationCompleted()}>{t('mlearn.Installer.Buttons.Installing')}</Show>
          <Show when={installationCompleted()}>{t('mlearn.Installer.Buttons.Continue')}</Show>
        </Btn>
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
