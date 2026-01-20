/**
 * Welcome Window App Component
 * Initial setup and language installation - Production Ready
 * Uses real IPC to install Python backend and configure language
 */

import { Component, Show, For, createSignal, createEffect, onMount } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useSettings } from '../../context';
import type { Settings, InstallOptions, InstallerState } from '../../../shared/types';
import { GlassPanel, GlassButton, SelectableCard, AlertBanner, LogConsole, CheckboxCard, ProgressBar } from '../../components/common';
import type { LogEntry } from '../../components/common/LogConsole';

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

// Animated welcome text in multiple languages
const WELCOME_TEXTS = ['Welcome!', 'ようこそ！', 'Wilkommen!', 'Bienvenue!', '欢迎！', 'Добро пожаловать!'];

const WelcomeContent: Component = () => {
  const { updateSettings } = useSettings();

  // Installation state
  const [installationStarted, setInstallationStarted] = createSignal(false);
  const [installationCompleted, setInstallationCompleted] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [statusLogs, setStatusLogs] = createSignal<LogEntry[]>([{ message: 'Click Install to begin.', level: 'info' }]);
  const [overallStatus, setOverallStatus] = createSignal('Waiting to start installation...');
  const [networkError, setNetworkError] = createSignal<string | null>(null);

  // Install options
  const [includeLLM, setIncludeLLM] = createSignal(true);
  const [includeOCR, setIncludeOCR] = createSignal(true);

  // Language selection (enabled after install completes)
  const [selectedLanguage, setSelectedLanguage] = createSignal<string>('ja');

  // Welcome text animation
  const [welcomeTextIndex, setWelcomeTextIndex] = createSignal(0);
  const [welcomeFading, setWelcomeFading] = createSignal(false);

  // Log a message to the status console
  const logInfo = (message: string) => {
    const level = message.toLowerCase().includes('error') ? 'error' as const : 
                  message.toLowerCase().includes('complete') ? 'success' as const : 'info' as const;
    setStatusLogs(prev => [...prev, { message, level }]);
  };

  // Handle installation completion
  const installCompleted = () => {
    setInstallationCompleted(true);
    setInstallationStarted(false);
    setProgress(100);
    setOverallStatus('Installation complete!');
    logInfo('Installation complete!');
  };

  // Reset to waiting state (for retries)
  const setWaitingState = (opts?: InstallOptions) => {
    if (installationCompleted()) return;
    setInstallationStarted(false);
    setProgress(0);
    setOverallStatus('Waiting to start installation...');
    setStatusLogs([{ message: 'Click Install to begin.', level: 'info' }]);
    if (opts) {
      setIncludeLLM(opts.includeLLM ?? true);
      setIncludeOCR(opts.includeOCR ?? true);
    }
  };

  // Start installation
  const handleInstall = async () => {
    if (installationStarted()) return;

    setInstallationStarted(true);
    setNetworkError(null);
    setProgress(5);
    setOverallStatus('Installing...');
    setStatusLogs([]);
    logInfo(includeLLM() ? 'Local AI model dependencies will be installed.' : 'Skipping local AI model dependencies.');
    logInfo(includeOCR() ? 'OCR reader dependencies will be installed.' : 'Skipping OCR reader dependencies.');

    // Save preferences and start install via IPC
    try {
      const mLearnIPC = (window as unknown as { mLearnIPC?: typeof window.mLearnIPC }).mLearnIPC;
      if (mLearnIPC) {
        mLearnIPC.startInstall({ includeLLM: includeLLM(), includeOCR: includeOCR() });
      } else {
        throw new Error('IPC not available');
      }
    } catch (e) {
      console.error('Failed to start installation:', e);
      setOverallStatus('Error: Could not start installation');
      setInstallationStarted(false);
    }
  };

  // Continue after installation to select language
  const handleContinue = () => {
    if (!installationCompleted()) return;

    // Save language and restart
    updateSettings({ language: selectedLanguage() });

    const mLearnIPC = (window as unknown as { mLearnIPC?: typeof window.mLearnIPC }).mLearnIPC;
    if (mLearnIPC) {
      mLearnIPC.saveSettings({ language: selectedLanguage() } as Settings);
      mLearnIPC.onSettingsSaved(() => {
        setOverallStatus('Language installed! Restarting in 5 seconds...');
        setTimeout(() => {
          // Send quit request to proxy server
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

  // Setup IPC event listeners
  onMount(() => {
    const mLearnIPC = (window as unknown as { mLearnIPC?: typeof window.mLearnIPC }).mLearnIPC;
    if (!mLearnIPC) return;

    // Python install success
    mLearnIPC.onPythonSuccess((success: boolean) => {
      if (success) installCompleted();
    });

    // Server status updates (pip output, download progress, etc.)
    mLearnIPC.onServerStatusUpdate((status: string) => {
      logInfo(status);

      // Update progress bar based on status
      if (status.includes('Installing Python dependencies')) {
        setProgress(5);
      } else if (status === 'Downloading Python...') {
        setProgress(10);
      } else if (status.includes('Download complete')) {
        setProgress(45);
      } else if (status.includes('Extraction complete')) {
        setProgress(70);
      } else if (status === 'Installation complete') {
        installCompleted();
      } else if (status.toLowerCase().includes('error')) {
        setOverallStatus('An error occurred. Check the log below.');
      }
    });

    // Installation started by backend
    mLearnIPC.onInstallStarted((opts: InstallOptions) => {
      if (!installationStarted()) {
        setInstallationStarted(true);
        setIncludeLLM(opts.includeLLM ?? true);
        setIncludeOCR(opts.includeOCR ?? true);
      }
    });

    // Installer awaiting user choice (error recovery or initial state)
    mLearnIPC.onInstallerAwaitingChoice(() => {
      setWaitingState({ includeLLM: includeLLM(), includeOCR: includeOCR() });
    });

    // Network error during install
    mLearnIPC.onInstallerNetworkError((payload: { message: string; detail?: string }) => {
      const message = typeof payload === 'string' ? payload : payload.message;
      const detail = typeof payload === 'object' ? payload.detail : undefined;
      if (detail) logInfo(detail);
      setOverallStatus(message);
      setNetworkError(detail ? `${message}\n\nDetails: ${detail}` : message);
      setWaitingState({ includeLLM: includeLLM(), includeOCR: includeOCR() });
    });

    // Get current installer state
    mLearnIPC.onInstallerState((state: InstallerState) => {
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
    });

    // Load current settings
    mLearnIPC.onSettings((settings: Settings) => {
      if (settings.llmEnabled !== undefined) {
        setIncludeLLM(settings.llmEnabled !== false);
      }
      if (settings.ocrEnabled !== undefined) {
        setIncludeOCR(settings.ocrEnabled !== false);
      }
    });

    // Request current state
    mLearnIPC.requestInstallerState();
    mLearnIPC.isSuccess();
    mLearnIPC.getSettings();
  });

  // Welcome text animation
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
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'flex-start',
        padding: '2rem',
        'background': 'linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%)',
        overflow: 'auto',
      }}
    >
      {/* Draggable region */}
      <div
        class="dragger"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '32px',
          '-webkit-app-region': 'drag',
        }}
      />

      {/* Animated welcome text */}
      <h1
        style={{
          'font-size': '2.5rem',
          'font-weight': '700',
          color: 'var(--text-primary)',
          'margin-bottom': '1rem',
          transition: 'opacity 0.5s ease',
          opacity: welcomeFading() ? '0' : '1',
        }}
      >
        {WELCOME_TEXTS[welcomeTextIndex()]}
      </h1>

      {/* Progress bar */}
      <ProgressBar 
        value={progress()} 
        max={100} 
        style={{ width: '100%', 'max-width': '500px', 'margin-bottom': '1rem' }}
      />

      <GlassPanel
        variant="dark"
        blur="lg"
        rounded="xl"
        padding="xl"
        style={{
          'max-width': '600px',
          width: '100%',
          display: 'flex',
          'flex-direction': 'column',
        }}
      >
        {/* Info text */}
        <p
          style={{
            color: 'var(--text-secondary)',
            'margin-bottom': '1.5rem',
            'line-height': '1.6',
          }}
        >
          <Show when={!installationStarted() && !installationCompleted()}>
            Choose the components you want to install, then click Install.
            <br />
            Language selection unlocks after setup finishes.
            <br />
            If you forget to install something, delete mLearn and restart the installer again.
            <br />
            You will <strong>not</strong> lose your data.
          </Show>
          <Show when={installationStarted() && !installationCompleted()}>
            Installing required components. This can take several minutes—please keep this window open.
          </Show>
          <Show when={installationCompleted()}>
            Installation complete! Choose your language to finish setup.
          </Show>
        </p>

        {/* Install options - only shown before installation */}
        <Show when={!installationStarted() && !installationCompleted()}>
          <div style={{ 'margin-bottom': '1.5rem', display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
            <CheckboxCard
              checked={includeLLM()}
              onChange={setIncludeLLM}
              title="Install mLearn Explain AI Module"
              description="Installs a local LLM Neural Network. Skips ~3 GB of dependencies if left unchecked."
            />
            <CheckboxCard
              checked={includeOCR()}
              onChange={setIncludeOCR}
              title="Install mLearn Reader Module"
              description="Will install text recognition neural networks. Skip to save download size if you do not plan on using the manga/comic reader right now."
            />
          </div>
        </Show>

        {/* Language selection - only enabled after installation */}
        <Show when={installationCompleted()}>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': 'repeat(2, 1fr)',
              gap: '0.75rem',
              'margin-bottom': '1.5rem',
            }}
          >
            <For each={LANGUAGES}>
              {(lang) => (
                <SelectableCard
                  selected={selectedLanguage() === lang.code}
                  disabled={!lang.available}
                  onClick={() => setSelectedLanguage(lang.code)}
                  icon={lang.flag}
                  title={lang.name}
                  description={lang.available ? lang.nativeName : 'Coming soon'}
                />
              )}
            </For>
          </div>
        </Show>

        {/* Installation log - shown during/after installation */}
        <Show when={installationStarted() || installationCompleted()}>
          <LogConsole
            logs={statusLogs()}
            title={overallStatus()}
            size="md"
            autoScroll={true}
            showTimestamps={false}
            maxHeight="150px"
          />
        </Show>

        {/* Network error alert */}
        <Show when={networkError()}>
          <AlertBanner
            type="error"
            title="Network Error"
            message={networkError()!}
            dismissible
            onDismiss={() => setNetworkError(null)}
          />
        </Show>

        {/* Action button */}
        <GlassButton
          variant="primary"
          onClick={installationCompleted() ? handleContinue : handleInstall}
          disabled={installationStarted() && !installationCompleted()}
          style={{ width: '100%', 'margin-top': '1rem' }}
        >
          <Show when={!installationStarted() && !installationCompleted()}>Start Installation</Show>
          <Show when={installationStarted() && !installationCompleted()}>Installing...</Show>
          <Show when={installationCompleted()}>Continue</Show>
        </GlassButton>
      </GlassPanel>
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
