/**
 * Welcome Window App Component
 * Initial setup and language installation - Production Ready
 * Uses real IPC to install Python backend and configure language
 */

import { Component, Show, For, createSignal, createEffect, onMount } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useSettings } from '../../context';
import type { Settings, InstallOptions, InstallerState } from '../../../shared/types';
import { GlassPanel, GlassButton } from '../../components/common';

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
  const [statusLogs, setStatusLogs] = createSignal<string[]>(['Click Install to begin.']);
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
    setStatusLogs(prev => [...prev, message]);
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
    setStatusLogs(['Click Install to begin.']);
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
      <div
        style={{
          width: '100%',
          'max-width': '500px',
          height: '8px',
          'background-color': 'var(--glass-bg)',
          'border-radius': 'var(--radius-full)',
          overflow: 'hidden',
          'margin-bottom': '1rem',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress()}%`,
            'background-color': 'var(--color-primary)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

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
          <div style={{ 'margin-bottom': '1.5rem' }}>
            <label
              style={{
                display: 'flex',
                'align-items': 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                background: 'var(--glass-bg)',
                'border-radius': 'var(--radius-md)',
                cursor: 'pointer',
                'margin-bottom': '0.5rem',
              }}
            >
              <input
                type="checkbox"
                checked={includeLLM()}
                onChange={(e) => setIncludeLLM(e.currentTarget.checked)}
                style={{ 'margin-top': '4px' }}
              />
              <span>
                <strong style={{ color: 'var(--text-primary)' }}>Install mLearn Explain AI Module</strong>
                <br />
                <small style={{ color: 'var(--text-secondary)' }}>
                  Installs a local LLM Neural Network. Skips ~3 GB of dependencies if left unchecked.
                </small>
              </span>
            </label>
            <label
              style={{
                display: 'flex',
                'align-items': 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                background: 'var(--glass-bg)',
                'border-radius': 'var(--radius-md)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={includeOCR()}
                onChange={(e) => setIncludeOCR(e.currentTarget.checked)}
                style={{ 'margin-top': '4px' }}
              />
              <span>
                <strong style={{ color: 'var(--text-primary)' }}>Install mLearn Reader Module</strong>
                <br />
                <small style={{ color: 'var(--text-secondary)' }}>
                  Will install text recognition neural networks. Skip to save download size
                  if you do not plan on using the manga/comic reader right now.
                </small>
              </span>
            </label>
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
                <button
                  disabled={!lang.available}
                  onClick={() => setSelectedLanguage(lang.code)}
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '0.75rem',
                    padding: '1rem',
                    background: selectedLanguage() === lang.code ? 'var(--color-primary-alpha)' : 'var(--glass-bg)',
                    border: selectedLanguage() === lang.code ? '2px solid var(--color-primary)' : '2px solid transparent',
                    'border-radius': 'var(--radius-md)',
                    cursor: lang.available ? 'pointer' : 'not-allowed',
                    opacity: lang.available ? '1' : '0.5',
                    transition: 'all 0.2s ease',
                    'text-align': 'left',
                  }}
                >
                  <span style={{ 'font-size': '1.5rem' }}>{lang.flag}</span>
                  <div>
                    <div style={{ 'font-weight': '500', color: 'var(--text-primary)' }}>{lang.name}</div>
                    <div style={{ 'font-size': '0.875rem', color: 'var(--text-secondary)' }}>{lang.nativeName}</div>
                  </div>
                  <Show when={!lang.available}>
                    <span
                      style={{
                        'margin-left': 'auto',
                        'font-size': '0.75rem',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Coming soon
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Installation log - shown during/after installation */}
        <Show when={installationStarted() || installationCompleted()}>
          <div style={{ 'margin-bottom': '1rem' }}>
            <p
              style={{
                'font-weight': '600',
                color: 'var(--text-primary)',
                'margin-bottom': '0.5rem',
              }}
            >
              {overallStatus()}
            </p>
            <div
              style={{
                height: '150px',
                overflow: 'auto',
                background: 'rgba(0,0,0,0.3)',
                'border-radius': 'var(--radius-md)',
                padding: '0.75rem',
                'font-family': 'monospace',
                'font-size': '0.75rem',
                color: 'var(--text-secondary)',
              }}
              ref={(el) => {
                // Auto-scroll to bottom when logs update
                createEffect(() => {
                  statusLogs();
                  if (el) el.scrollTop = el.scrollHeight;
                });
              }}
            >
              <For each={statusLogs()}>
                {(log) => (
                  <p
                    style={{
                      margin: '0.25rem 0',
                      color: log.toLowerCase().includes('error') ? 'var(--color-danger)' : 'inherit',
                    }}
                  >
                    {log}
                  </p>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Network error alert */}
        <Show when={networkError()}>
          <div
            style={{
              padding: '1rem',
              background: 'rgba(255, 100, 100, 0.2)',
              border: '1px solid var(--color-danger)',
              'border-radius': 'var(--radius-md)',
              'margin-bottom': '1rem',
              color: 'var(--color-danger)',
            }}
          >
            <strong>Network Error</strong>
            <p style={{ 'margin-top': '0.5rem', 'font-size': '0.875rem' }}>{networkError()}</p>
          </div>
        </Show>

        {/* Action button */}
        <GlassButton
          variant="primary"
          onClick={installationCompleted() ? handleContinue : handleInstall}
          disabled={installationStarted() && !installationCompleted()}
          style={{ width: '100%' }}
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
