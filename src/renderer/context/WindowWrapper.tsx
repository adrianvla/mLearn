/**
 * Window Wrapper Component
 * Provides nested context providers for all windows (Russian Doll pattern)
 */

import { ParentComponent, Component, JSX, Show, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { SettingsProvider, useSettings } from './SettingsContext';
import './WindowWrapper.css';
import { LanguageProvider } from './LanguageContext';
import { FlashcardProvider } from './FlashcardContext';
import { FlashcardCreationChoiceModal } from '../components/flashcard';
import { ServerProvider, useServer } from './ServerContext';
import { LocalizationProvider, useLocalization } from './LocalizationContext';
import { ResponsiveProvider } from './ResponsiveContext';
import { ToastContainer, showToast } from '../components/common/Feedback/Toast';
import { Btn, ErrorModal, EulaModal } from '../components/common';
import { WindowDragRegion } from '../components/utils/WindowDragRegion';
import { TitleBar } from '../components/common';
import { CloudReLoginModal } from '../components/cloud/CloudReLoginModal';
import { ActiveGroupGate } from '../components/cloud/ActiveGroupSelector';
import { getLocalStorageMigrationInfo, resetLocalStorageMigrationInfo } from '../services/statsService';
import { consumePendingFlashcardMigration, setMigrationListenerReady } from './migrationSignals';
import { createAnkiCacheToastGate } from './windowWrapperNotifications';
import { LowPowerGateProvider } from './LowPowerGateContext';
import { isElectron } from '../../shared/platform';
import { getBridge } from '../../shared/bridges';
import { installRendererLogSink } from '../utils/installLogSink';
import { getLogger } from '../../shared/utils/logger';
import { activityHub, setActivityPolicyScope } from '../services/activityHubRuntime';
import { createElectronPluginActivityAdapter } from '../services/electronPluginActivityAdapter';
import { createManagementAnalyticsAdapter } from '../services/managementAnalyticsAdapter';

const log = getLogger("renderer.context.windowWrapper");

installRendererLogSink();

const ankiCacheToastGate = createAnkiCacheToastGate();

const LanguageProviderBridge: Component<{ children?: JSX.Element }> = (props) => {
  const { settings, isLoading } = useSettings();

  return (
    <Show when={!isLoading()}>
      <LanguageProvider language={settings.language}>
        {props.children}
      </LanguageProvider>
    </Show>
  );
};

/**
 * MigrationHandler - Handles showing notifications for v1 data migration
 * Must be placed OUTSIDE FlashcardProvider so listener is ready before flashcards load
 * 
 * Note: Word statuses are loaded automatically at statsService module init time.
 * This handler only shows the migration toast notification.
 */
const MigrationHandler: ParentComponent = (props) => {
  const { t } = useLocalization();

  onMount(() => {
    const showFlashcardMigrationToast = (info: { occurred: boolean; backupPath: string | null; fromVersion: number | null } | undefined) => {
      if (!info?.occurred) {
        return;
      }

      showToast({
        variant: 'success',
        title: t('mlearn.Notifications.MigrationComplete'),
        message: info.backupPath
          ? t('mlearn.Notifications.MigrationFlashcards', { version: info.fromVersion ?? '' })
          : t('mlearn.Notifications.MigrationFlashcardsNoBackup', { version: info.fromVersion ?? '' }),
        duration: 10000,
      });
    };

    // Check if localStorage migration occurred (word statuses already loaded by statsService)
    const lsInfo = getLocalStorageMigrationInfo();
    if (lsInfo.occurred) {
      showToast({
        variant: 'info',
        title: t('mlearn.Notifications.MigrationComplete'),
        message: t('mlearn.Notifications.MigrationWordStatuses', { count: lsInfo.migratedWordCount }),
        duration: 8000,
      });
      resetLocalStorageMigrationInfo();
    }
    
    // Listen for flashcard migration events from electron
    const handleFlashcardMigration = (e: Event) => {
      const info = (e as CustomEvent).detail;
      log.info('[MigrationHandler] Received flashcard migration event:', info);
      showFlashcardMigrationToast(info);
    };

    window.addEventListener('mlearn-flashcard-migration', handleFlashcardMigration);

    // Signal that listener is ready
    setMigrationListenerReady(true);
    showFlashcardMigrationToast(consumePendingFlashcardMigration() ?? undefined);
    log.info('[MigrationHandler] Migration listener registered');

    onCleanup(() => {
      setMigrationListenerReady(false);
      window.removeEventListener('mlearn-flashcard-migration', handleFlashcardMigration);
    });
  });
  
  return props.children;
};

/**
 * Loading screen shown during initial window load.
 * Prevents light theme flash before settings/theme are applied.
 * Uses pure CSS spinner to avoid component dependencies.
 */
const WindowLoadingScreen: Component<{ transparent?: boolean }> = (props) => {
  const { isLoading } = useSettings();
  const [visible, setVisible] = createSignal(true);
  const [fadeOut, setFadeOut] = createSignal(false);

  createEffect(() => {
    if (!isLoading()) {
      setFadeOut(true);
      const timer = setTimeout(() => setVisible(false), 300);
      onCleanup(() => clearTimeout(timer));
    }
  });

  return (
      <Show when={visible()}>
      <div class={`window-loading-overlay ${fadeOut() ? 'fade-out' : ''} ${props.transparent ? 'transparent-bg' : ''}`}>
        <svg width="40" height="40" viewBox="0 0 48 48" aria-label="Loading">
          <title>Loading</title>
          <rect x="2" y="2" width="44" height="44" fill="none" stroke="currentColor" stroke-opacity="0.1" stroke-width="8"/>
          <rect x="2" y="2" width="44" height="44" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="square" stroke-dasharray="44 132" class="window-loading-spinner-dash"/>
        </svg>
      </div>
    </Show>
  );
};

// /**
//  * DevToastTester - Fires a test toast on mount in dev mode
//  */
// const DevToastTester: Component = () => {
//   const { settings } = useSettings();
//
//   onMount(() => {
//     if (settings.devMode || true) {
//       showToast({
//         variant: 'info',
//         title: 'test',
//         message: 'Toast system operational',
//         duration: 3000,
//       });
//       log.info('[DevToastTester] Toast fired');
//     }
//     log.info('[DevToastTester] a');
//   });
//
//   return null;
// };

/**
 * ServerStatusObserver - Watches server status messages and shows localized toasts.
 * Must be inside LocalizationProvider to access t().
 */
const ServerStatusObserver: Component = () => {
  const { statusMessage } = useServer();
  const { isLoaded, t } = useLocalization();

  createEffect(() => {
    const msg = statusMessage();
    const localizationReady = isLoaded();

    if (ankiCacheToastGate.shouldShow(msg, localizationReady)) {
      showToast({
        message: t('mlearn.Notifications.AnkiCacheLoaded'),
        variant: 'info',
        duration: 5000,
      });
    }
  });

  return null;
};

const GlobalCloudReLoginModal: Component = () => {
  const { isCloudReLoginModalOpen, closeCloudReLoginModal } = useSettings();

  return (
    <CloudReLoginModal
      isOpen={isCloudReLoginModalOpen()}
      onClose={closeCloudReLoginModal}
    />
  );
};

const GlobalRuntimeRestartModal: Component = () => {
  const {
    isRuntimeRestartRequired,
    restartAppForRuntimeSettings,
  } = useSettings();
  const { t } = useLocalization();
  const isSetupWindow = () => (
    typeof window !== 'undefined' && window.location.pathname.endsWith('/welcome.html')
  );

  return (
    <Show when={isRuntimeRestartRequired() && !isSetupWindow()}>
      <ErrorModal
        isOpen={true}
        severity="warning"
        title={t('mlearn.RuntimeRestart.Title')}
        message={t('mlearn.RuntimeRestart.Message')}
        showRetry={false}
        showQuit={false}
        actions={(
          <Btn
            variant="primary"
            onClick={restartAppForRuntimeSettings}
          >
            {t('mlearn.RuntimeRestart.RestartNow')}
          </Btn>
        )}
      />
    </Show>
  );
};

const ActivityRuntimeBridge: Component = () => {
  const { settings, managedPolicy } = useSettings();
  let analytics: ReturnType<typeof createManagementAnalyticsAdapter> | null = null;

  onMount(() => {
    const disposeAdapter = createElectronPluginActivityAdapter(activityHub);
    analytics = createManagementAnalyticsAdapter({ getSettings: () => settings as typeof settings });
    analytics.updateScope(settings as typeof settings);
    analytics.start();
    onCleanup(() => { disposeAdapter(); void analytics?.stop(); analytics = null; });
  });

  createEffect(() => {
    analytics?.updateScope(settings as typeof settings);
    const policy = managedPolicy();
    const activeGroupId = settings.cloudAuthActiveGroupId?.trim();
    const scope = settings.cloudAuthStatus === 'signed-in'
      && activeGroupId
      && policy?.activeGroupId === activeGroupId
      ? { activeGroupId, policyVersionId: policy.policyVersionId }
      : null;
    setActivityPolicyScope(scope);
  });

  onCleanup(() => setActivityPolicyScope(null));
  return null;
};


async function computeSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const GlobalEulaModal: Component = () => {
  const { settings, updateSettings, isLoading } = useSettings();
  const [eulaContent, setEulaContent] = createSignal('');
  const [currentHash, setCurrentHash] = createSignal('');
  const needsAcceptance = createMemo(() => {
    const hash = currentHash();
    return Boolean(hash && settings.eulaAcceptedHash !== hash);
  });

  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.server.onLegalDocumentReceive(async (content) => {
      setEulaContent(content);
      const hash = await computeSha256(content);
      setCurrentHash(hash);
    });
    bridge.server.getLegalDocument('EULA');
    onCleanup(() => cleanup());
  });

  const handleAccept = () => {
    updateSettings({
      eulaAccepted: true,
      eulaAcceptedVersion: '1.0',
      eulaAcceptedAt: Date.now(),
      eulaAcceptedHash: currentHash(),
    });
  };

  return (
    <Show when={needsAcceptance() && !isLoading()}>
      <EulaModal content={eulaContent()} onAccept={handleAccept} />
    </Show>
  );
};

/**
 * WindowWrapper wraps all window entry points with necessary providers
 * This ensures consistent context availability across all windows
 * 
 * IMPORTANT: MigrationHandler is placed BEFORE FlashcardProvider so that
 * the migration event listener is registered before flashcards are loaded
 */
const isMacOS = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export const WindowWrapper: ParentComponent<{ showDragRegion?: boolean; showTitleBar?: boolean; transparent?: boolean; showActiveGroupSwitch?: boolean }> = (props) => {
  const needsDragRegion = (props.showDragRegion !== false) && !props.showTitleBar && isElectron();
  const needsTitleBar = props.showTitleBar && isElectron();

  return (
    <ServerProvider>
      <LocalizationProvider>
        <ServerStatusObserver />
        <ResponsiveProvider>
          <SettingsProvider>
            <ActivityRuntimeBridge />
            <WindowLoadingScreen transparent={props.transparent} />
            <GlobalEulaModal />
            <GlobalRuntimeRestartModal />
            <ActiveGroupGate showSwitchTrigger={props.showActiveGroupSwitch} />
            <LowPowerGateProvider>
            <LanguageProviderBridge>
            <MigrationHandler>
                <FlashcardProvider>
                  <Show when={needsTitleBar} fallback={
                    <>
                      <Show when={needsDragRegion}>
                        <WindowDragRegion />
                      </Show>
                      {props.children}
                    </>
                  }>
                    <div class="window-layout-with-titlebar">
                      <Show when={isMacOS} fallback={<TitleBar />}>
                        <div class="window-titlebar-mac" />
                      </Show>
                      <div class="window-content-below-titlebar">
                        {props.children}
                      </div>
                    </div>
                  </Show>
                  <FlashcardCreationChoiceModal />
                  <GlobalCloudReLoginModal />
                </FlashcardProvider>
                <ToastContainer />
              </MigrationHandler>
            </LanguageProviderBridge>
            </LowPowerGateProvider>
          </SettingsProvider>
        </ResponsiveProvider>
      </LocalizationProvider>
    </ServerProvider>
  );
};

export default WindowWrapper;
