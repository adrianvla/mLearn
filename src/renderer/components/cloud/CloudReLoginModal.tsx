/**
 * Cloud Re-Login Modal
 * Shown when the cloud session has expired and the user needs to re-authenticate.
 * Initiates the desktop login flow (opens browser → accepts one-time code).
 */

import { Component, Show, createSignal, onCleanup } from 'solid-js';
import { useSettings } from '../../context/SettingsContext';
import { useLocalization } from '../../context/LocalizationContext';
import { getBridge } from '../../../shared/bridges';
import { Modal, Btn, Input, HintText, WarningIcon } from '../common';
import {
  startCloudDesktopLogin,
  exchangeCloudDesktopCode,
} from '../../services/cloudAuthService';
import { cancelCloudSessionRecovery } from '../../services/cloudSessionManager';
import './CloudReLoginModal.css';

export interface CloudReLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after re-login succeeds so the caller can retry the failed operation */
  onReLoginSuccess?: () => void;
  title?: string;
  warningMessage?: string;
  hint?: string;
  codeHint?: string;
}

export const CloudReLoginModal: Component<CloudReLoginModalProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();

  const [loginPending, setLoginPending] = createSignal(false);
  const [pendingState, setPendingState] = createSignal('');
  const [pendingVerifier, setPendingVerifier] = createSignal('');
  const [manualCode, setManualCode] = createSignal('');
  const [error, setError] = createSignal('');
  const [exchanging, setExchanging] = createSignal(false);

  function resetLocalState(): void {
    setLoginPending(false);
    setPendingState('');
    setPendingVerifier('');
    setManualCode('');
    setError('');
    setExchanging(false);
  }

  async function completeSignIn(code: string): Promise<void> {
    if (!code || !pendingVerifier()) {
      return;
    }

    setExchanging(true);
    setError('');

    try {
      const result = await exchangeCloudDesktopCode(settings, code, pendingVerifier());
      updateSettings({
        cloudAuthAccessToken: result.accessToken,
        cloudAuthToken: '',
        cloudAuthRefreshToken: result.refreshToken,
        cloudAuthUserId: result.userId,
        cloudAuthUserEmail: result.userEmail,
        cloudAuthExpiresAt: result.expiresAt ?? 0,
        cloudAuthStatus: 'signed-in',
      });
      resetLocalState();
      props.onReLoginSuccess?.();
      props.onClose();
    } catch (e) {
      console.error(e);
      setError(String(e));
    } finally {
      setExchanging(false);
    }
  }

  async function handleStartLogin() {
    setError('');
    setLoginPending(true);
    try {
      const login = await startCloudDesktopLogin(settings);
      setPendingState(login.state);
      setPendingVerifier(login.codeVerifier);
      await getBridge().window.openExternalUrl(login.loginUrl);
    } catch (e) {
      console.error(e);
      setError(String(e));
      setLoginPending(false);
    }
  }

  async function handleCompleteLogin() {
    const code = manualCode().trim();
    await completeSignIn(code);
  }

  function handleClose() {
    resetLocalState();
    cancelCloudSessionRecovery();
    props.onClose();
  }

  const cleanupDeepLink = getBridge().window.onAuthDeepLink(async (payload) => {
    if (!payload.code || !payload.state) {
      if (payload.error) {
        setError(payload.error);
      }
      return;
    }

    if (!pendingState() || payload.state !== pendingState()) {
      return;
    }

    await completeSignIn(payload.code);
  });

  onCleanup(() => {
    cleanupDeepLink();
  });

  const footer = (
    <div class="modal-footer-actions">
      <Btn variant="ghost" onClick={handleClose}>
        {t('mlearn.Global.Cancel')}
      </Btn>
      <Show when={!loginPending()}>
        <Btn variant="primary" onClick={handleStartLogin}>
          {t('mlearn.Connection.SignIn')}
        </Btn>
      </Show>
      <Show when={loginPending()}>
        <Btn
          variant="primary"
          onClick={handleCompleteLogin}
          disabled={!manualCode().trim() || exchanging()}
          loading={exchanging()}
        >
          {t('mlearn.Connection.CompleteSignIn')}
        </Btn>
      </Show>
    </div>
  );

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleClose}
      title={props.title || t('mlearn.CloudReLogin.Title')}
      size="sm"
      footer={footer}
    >
      <div class="cloud-relogin-content">
        <div class="cloud-relogin-warning">
          <WarningIcon size={20} />
          <span>{props.warningMessage || t('mlearn.CloudReLogin.SessionExpired')}</span>
        </div>

        <Show when={!loginPending()}>
          <HintText>{props.hint || t('mlearn.CloudReLogin.Hint')}</HintText>
        </Show>

        <Show when={loginPending()}>
          <HintText>{props.codeHint || t('mlearn.CloudReLogin.CodeHint')}</HintText>
          <Input
            value={manualCode()}
            onInput={(e) => setManualCode(e.currentTarget.value)}
            placeholder={t('mlearn.Connection.DesktopCode')}
            fullWidth
          />
        </Show>

        <Show when={error()}>
          <div class="cloud-relogin-error">{error()}</div>
        </Show>
      </div>
    </Modal>
  );
};
