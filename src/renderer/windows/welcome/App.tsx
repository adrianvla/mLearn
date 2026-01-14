/**
 * Welcome Window App Component
 * Initial setup and language installation
 */

import { Component, Show, For, createSignal, createEffect, onMount } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useSettings } from '../../context';
import { useServer } from '../../context';
import { useIPC, useBackendStatus } from '../../hooks';
import { GlassPanel, GlassButton, GlassCard } from '../../components/common';

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

const WelcomeContent: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { isConnected } = useServer();
  const { isElectron, openWindow, getVersion } = useIPC();
  const backendStatus = useBackendStatus();

  const [step, setStep] = createSignal(0);
  const [selectedLanguage, setSelectedLanguage] = createSignal<string>('ja');
  const [isInstalling, setIsInstalling] = createSignal(false);
  const [installProgress, setInstallProgress] = createSignal(0);

  const steps = [
    { title: 'Welcome', subtitle: 'Get started with mLearn' },
    { title: 'Language', subtitle: 'Choose your target language' },
    { title: 'Setup', subtitle: 'Installing language support' },
    { title: 'Ready', subtitle: 'You\'re all set!' },
  ];

  const handleLanguageSelect = (code: string) => {
    setSelectedLanguage(code);
  };

  const handleInstall = async () => {
    setStep(2);
    setIsInstalling(true);

    // Simulate installation progress
    // In production, this would call the backend to install language packages
    for (let i = 0; i <= 100; i += 5) {
      await new Promise(resolve => setTimeout(resolve, 100));
      setInstallProgress(i);
    }

    setIsInstalling(false);
    updateSettings({ language: selectedLanguage() });
    setStep(3);
  };

  const handleComplete = () => {
    updateSettings({ hasCompletedSetup: true });
    openWindow('main');
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        padding: '2rem',
        'background': 'linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%)',
      }}
    >
      {/* Progress indicator */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          'margin-bottom': '2rem',
        }}
      >
        <For each={steps}>
          {(_, index) => (
            <div
              style={{
                width: '2rem',
                height: '4px',
                'border-radius': 'var(--radius-full)',
                'background-color': index() <= step() ? 'var(--color-primary)' : 'var(--glass-border)',
                transition: 'background-color 0.3s ease',
              }}
            />
          )}
        </For>
      </div>

      <GlassPanel
        variant="dark"
        blur="lg"
        rounded="xl"
        padding="xl"
        style={{
          'max-width': '600px',
          width: '100%',
          'min-height': '400px',
          display: 'flex',
          'flex-direction': 'column',
        }}
      >
        {/* Step 0: Welcome */}
        <Show when={step() === 0}>
          <div style={{ 'text-align': 'center', flex: '1', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center' }}>
            <div style={{ 'font-size': '4rem', 'margin-bottom': '1rem' }}>🎓</div>
            <h1
              style={{
                'font-size': '2rem',
                'font-weight': '700',
                color: 'var(--text-primary)',
                'margin-bottom': '0.5rem',
              }}
            >
              Welcome to mLearn
            </h1>
            <p
              style={{
                color: 'var(--text-secondary)',
                'margin-bottom': '2rem',
                'line-height': '1.6',
              }}
            >
              Learn languages through immersion with videos, subtitles, and flashcards.
              Let's get you set up!
            </p>
            <GlassButton variant="primary" onClick={() => setStep(1)}>
              Get Started
            </GlassButton>
            <p
              style={{
                'margin-top': '2rem',
                'font-size': '0.75rem',
                color: 'var(--text-muted)',
              }}
            >
              Version {getVersion()}
            </p>
          </div>
        </Show>

        {/* Step 1: Language Selection */}
        <Show when={step() === 1}>
          <div style={{ flex: '1', display: 'flex', 'flex-direction': 'column' }}>
            <h2
              style={{
                'font-size': '1.5rem',
                'font-weight': '600',
                color: 'var(--text-primary)',
                'margin-bottom': '0.5rem',
              }}
            >
              Choose Your Language
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                'margin-bottom': '1.5rem',
              }}
            >
              Select the language you want to learn
            </p>

            <div
              style={{
                display: 'grid',
                'grid-template-columns': 'repeat(2, 1fr)',
                gap: '0.75rem',
                flex: '1',
              }}
            >
              <For each={LANGUAGES}>
                {(lang) => (
                  <button
                    disabled={!lang.available}
                    onClick={() => handleLanguageSelect(lang.code)}
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

            <div style={{ display: 'flex', gap: '1rem', 'margin-top': '1.5rem' }}>
              <GlassButton onClick={() => setStep(0)}>Back</GlassButton>
              <GlassButton variant="primary" onClick={handleInstall}>
                Continue
              </GlassButton>
            </div>
          </div>
        </Show>

        {/* Step 2: Installation */}
        <Show when={step() === 2}>
          <div style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', 'text-align': 'center' }}>
            <div style={{ 'font-size': '3rem', 'margin-bottom': '1rem' }}>⚙️</div>
            <h2
              style={{
                'font-size': '1.5rem',
                'font-weight': '600',
                color: 'var(--text-primary)',
                'margin-bottom': '0.5rem',
              }}
            >
              Setting Up
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                'margin-bottom': '2rem',
              }}
            >
              Installing language support...
            </p>

            <div
              style={{
                width: '100%',
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
                  width: `${installProgress()}%`,
                  'background-color': 'var(--color-primary)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>

            <p style={{ 'font-size': '0.875rem', color: 'var(--text-muted)' }}>
              {installProgress()}% complete
            </p>
          </div>
        </Show>

        {/* Step 3: Complete */}
        <Show when={step() === 3}>
          <div style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', 'text-align': 'center' }}>
            <div style={{ 'font-size': '4rem', 'margin-bottom': '1rem' }}>🎉</div>
            <h2
              style={{
                'font-size': '1.5rem',
                'font-weight': '600',
                color: 'var(--text-primary)',
                'margin-bottom': '0.5rem',
              }}
            >
              You're All Set!
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                'margin-bottom': '2rem',
                'line-height': '1.6',
              }}
            >
              mLearn is ready to help you learn {LANGUAGES.find(l => l.code === selectedLanguage())?.name}.
              Start by dropping a video file into the app.
            </p>
            <GlassButton variant="primary" onClick={handleComplete}>
              Start Learning
            </GlassButton>
          </div>
        </Show>
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
