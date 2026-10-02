/**
 * Window Wrapper Component
 * Provides nested context providers for all windows (Russian Doll pattern)
 */

import { ParentComponent, Component, JSX, Show, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { SettingsProvider, useSettings } from './SettingsContext';
import './WindowWrapper.css';
import { LanguageProvider } from './LanguageContext';
import { FlashcardProvider, useFlashcards } from './FlashcardContext';
import { FlashcardCreationChoiceModal } from '../components/flashcard';
import { ServerProvider, useServer } from './ServerContext';
import { InstallProgressProvider, useInstallProgress } from './InstallProgressContext';
import { hashWord } from '../services/srsAlgorithm';
import { LocalizationProvider, useLocalization } from './LocalizationContext';
import { ResponsiveProvider } from './ResponsiveContext';
import { ToastContainer, showToast } from '../components/common/Feedback/Toast';
import { Button, ErrorModal, EulaModal, Modal, ProgressBar, Spinner } from '../components/common';
import { WindowDragRegion } from '../components/utils/WindowDragRegion';
import { TitleBar } from '../components/common';
import { CloudReLoginModal } from '../components/cloud/CloudReLoginModal';
import { ActiveGroupGate } from '../components/cloud/ActiveGroupSelector';
import { MigrationHandler } from '../components/migration/MigrationHandler';
import { setBuiltinModelReady } from './llmModelSignals';
import { createAnkiCacheToastGate } from './windowWrapperNotifications';
import { LowPowerGateProvider } from './LowPowerGateContext';
import { GraphProvider } from './GraphContext';
import { KnowledgeInspectorHost } from '../components/common/KnowledgeProjection/KnowledgeInspectorHost';
import { isElectron } from '../../shared/platform';
import { getBridge } from '../../shared/bridges';
import { installRendererLogSink } from '../utils/installLogSink';
import { getWindowControlsInsets } from '../utils/windowChrome';
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
      <LanguageProvider
        language={settings.language}
        frequencyProviderSelections={settings.frequencyProviderSelections}
        frequencyLevelSystemSelections={settings.frequencyLevelSystemSelections}
      >
        {props.children}
      </LanguageProvider>
    </Show>
  );
};

/**
 * Loading screen shown during initial window load.
 * Prevents light theme flash before settings/theme are applied.
 *
 * The overlay is hardcoded black because no palette has been applied yet, so
 * the spinner must state its own foreground rather than inherit
 * `--text-primary` (which resolves to near-black until the theme loads, and
 * rendered the indicator invisibly). `--text-on-strong` is the
 * theme-independent always-light token.
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
        <Spinner size={40} shape="square" strokeWidth={8} cornerRadius={0} class="window-loading-spinner" />
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
          <Button
            variant="primary"
            onClick={restartAppForRuntimeSettings}
          >
            {t('mlearn.RuntimeRestart.RestartNow')}
          </Button>
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
      const hash = await hashWord(content);
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
 * GlobalInstallProgressModal - Non-dismissable modal shown during any
 * background installation (Python runtime, component reconciliation, pip).
 * Suppressed on the welcome window which has its own install UI.
 */
const GlobalInstallProgressModal: Component = () => {
  const { isInstalling, installMessage, installProgress, installError, hasFailed, retry, dismiss } = useInstallProgress();
  const { t } = useLocalization();
  const isSetupWindow = () => (
    typeof window !== 'undefined' && window.location.pathname.endsWith('/welcome.html')
  );

  return (
    <Show when={(isInstalling() || hasFailed()) && !isSetupWindow()}>
      <Modal
        isOpen={true}
        onClose={dismiss}
        title={hasFailed() ? t('mlearn.Installer.Status.ErrorOccurred') : t('mlearn.Installer.Status.InstallingPackages')}
        size="sm"
        closeOnEscape={hasFailed()}
        closeOnOverlay={hasFailed()}
        showCloseButton={hasFailed()}
        headerDraggable
      >
        <div class="install-progress-modal-body">
          <p class="install-progress-message">{installMessage()}</p>
          <Show when={isInstalling()}>
            <ProgressBar
              value={installProgress()}
              indeterminate={installProgress() < 0}
              variant="primary"
              size="md"
              rounded
              animated
              showPercent={installProgress() >= 0}
            />
          </Show>
          <Show when={installError()}>
            <p class="install-progress-error">{installError()}</p>
          </Show>
          <Show when={hasFailed()}>
            <div class="install-progress-actions">
              <Button variant="primary" onClick={retry}>{t('mlearn.Global.TryAgain')}</Button>
              <Button variant="secondary" onClick={dismiss}>{t('mlearn.Global.Close')}</Button>
            </div>
          </Show>
        </div>
      </Modal>
    </Show>
  );
};

/**
 * BuiltinModelStatusListener - Keeps the shared builtinModelReady signal in sync
 * with whether the built-in LLM model and runtime are ready. Reads the selected model
 * reactively and refreshes on provider/model change and on download events.
 * Renders nothing. Only relevant when llmProvider is 'builtin'; for other
 * providers the signal value is unused by the readiness derivation.
 */
const BuiltinModelStatusListener: Component = () => {
  const { settings, isLoading } = useSettings();
  const bridge = getBridge();

  createEffect(() => {
    // The store initially contains defaults. Checking it before the saved
    // selection arrives can load an entirely different multi-GB model.
    if (isLoading()) {
      setBuiltinModelReady(false);
      return;
    }
    // Reactive deps: re-run when provider or selected model changes
    const provider = settings.llmProvider;
    const modelFile = settings.builtinModel;

    if (provider !== 'builtin') {
      setBuiltinModelReady(false);
      return;
    }

    let cancelled = false;

    void bridge.llm.llmCheckModel(modelFile).then((status) => {
      if (!cancelled) setBuiltinModelReady(status.ready);
    }).catch((e) => {
      log.error("[BuiltinModelStatusListener] model check failed", e);
    });

    onCleanup(() => { cancelled = true; });
  });

  onMount(() => {
    const cleanupProgress = bridge.llm.onLLMDownloadProgress((status) => {
      setBuiltinModelReady(status.ready);
    });
    const cleanupStatus = bridge.llm.onLLMModelStatus((status) => {
      setBuiltinModelReady(status.ready);
    });

    onCleanup(() => {
      cleanupProgress();
      cleanupStatus();
    });
  });

  return null;
};

/** Keep every window's recovery action consistent while preserving the view underneath. */
export const LibraryLoadGuard: Component<{ recoveryAccess?: boolean }> = (props) => {
  const flashcards = useFlashcards();
  const { t } = useLocalization();
  const openProtection = () => getBridge().window.openWindow({ type: 'settings', context: { section: 'general' } });
  return <Show when={props.recoveryAccess} fallback={
    <Modal isOpen={!!flashcards.libraryLoadError()} onClose={() => {}}
      title={t('mlearn.LibraryRecovery.Title')} size="sm" showCloseButton={false}
      closeOnEscape={false} closeOnOverlay={false}
      footer={<>
        <Show when={isElectron()}><Button variant="secondary" onClick={openProtection}>{t('mlearn.LibraryRecovery.OpenProtection')}</Button></Show>
        <Button variant="primary" onClick={flashcards.retryLibraryLoad}>{t('mlearn.Global.TryAgain')}</Button>
      </>}>
      <p role="alert">{t('mlearn.LibraryRecovery.Description')}</p>
    </Modal>
  }>
    <Show when={flashcards.libraryLoadError()}>
      <aside class="library-recovery-notice" role="alert">
        <strong>{t('mlearn.LibraryRecovery.Title')}</strong>
        <p>{t('mlearn.LibraryRecovery.Description')}</p>
        <Button onClick={flashcards.retryLibraryLoad}>{t('mlearn.Global.TryAgain')}</Button>
      </aside>
    </Show>
  </Show>;
};

/**
 * WindowWrapper wraps all window entry points with necessary providers
 * This ensures consistent context availability across all windows
 * 
 * IMPORTANT: MigrationHandler is placed BEFORE FlashcardProvider so that
 * the migration event listener is registered before flashcards are loaded
 */
const isMacOS = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export const WindowWrapper: ParentComponent<{ showDragRegion?: boolean; showTitleBar?: boolean; transparent?: boolean; showActiveGroupSwitch?: boolean; showWindowLoadingScreen?: boolean; libraryRecoveryAccess?: boolean }> = (props) => {
  const needsDragRegion = (props.showDragRegion !== false) && !props.showTitleBar && isElectron();
  const needsTitleBar = props.showTitleBar && isElectron();
  const windowControlsInsets = getWindowControlsInsets({
    isElectron: isElectron(),
    isMacOS,
    contentOverlapsNativeControls: !props.showTitleBar,
  });
  const windowChromeStyle: JSX.CSSProperties = {
    '--window-controls-inline-start-inset': windowControlsInsets.inlineStart,
    '--window-controls-block-start-inset': windowControlsInsets.blockStart,
  };

  return (
    <div class="window-chrome-inset-provider" style={windowChromeStyle}>
    <ServerProvider>
      <InstallProgressProvider>
      <LocalizationProvider>
        <ServerStatusObserver />
        <ResponsiveProvider>
          <SettingsProvider>
            <GraphProvider>
            <ActivityRuntimeBridge />
            <Show when={props.showWindowLoadingScreen !== false}>
              <WindowLoadingScreen transparent={props.transparent} />
            </Show>
            <GlobalEulaModal />
            <GlobalRuntimeRestartModal />
            <GlobalInstallProgressModal />
            <BuiltinModelStatusListener />
            <ActiveGroupGate showSwitchTrigger={props.showActiveGroupSwitch} />
            <LowPowerGateProvider>
            <LanguageProviderBridge>
            <MigrationHandler>
                <FlashcardProvider>
                  <LibraryLoadGuard recoveryAccess={props.libraryRecoveryAccess} />
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
                  <KnowledgeInspectorHost />
                  <GlobalCloudReLoginModal />
                </FlashcardProvider>
                <ToastContainer />
              </MigrationHandler>
            </LanguageProviderBridge>
            </LowPowerGateProvider>
            </GraphProvider>
          </SettingsProvider>
        </ResponsiveProvider>
      </LocalizationProvider>
      </InstallProgressProvider>
    </ServerProvider>
    </div>
  );
};

export default WindowWrapper;
