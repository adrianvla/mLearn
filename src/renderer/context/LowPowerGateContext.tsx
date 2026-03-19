/**
 * Low Power Gate Context
 * Intercepts local neural network calls (LLM, TTS, OCR) when low battery mode is active.
 * Shows a modal prompt letting the user Allow/Deny per-request or per-session.
 */

import { createContext, useContext, ParentComponent, createSignal, batch } from 'solid-js';
import { useSettings } from './SettingsContext';
import { useLocalization } from './LocalizationContext';
import { Modal } from '../components/common/Modal/Modal';
import { Btn } from '../components/common/Button';
import './LowPowerGateContext.css';

export type GateBackendType = 'llm' | 'tts' | 'ocr';

interface LowPowerGateContextValue {
  /** Request access to a local backend. Returns true if allowed, false if denied. */
  requestAccess: (backendType: GateBackendType) => Promise<boolean>;
  /** Whether low battery mode is currently active */
  isActive: () => boolean;
}

const LowPowerGateContext = createContext<LowPowerGateContextValue>();

export const LowPowerGateProvider: ParentComponent = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();

  // Session-level decisions: once set, don't ask again for that backend type
  const [sessionDecisions, setSessionDecisions] = createSignal<Record<string, boolean>>({});

  // Modal state
  const [pendingBackend, setPendingBackend] = createSignal<GateBackendType | null>(null);
  let resolveGate: ((allowed: boolean) => void) | null = null;

  const isActive = () => settings.lowBatteryMode;

  const requestAccess = (backendType: GateBackendType): Promise<boolean> => {
    // If low battery mode is off, always allow
    if (!settings.lowBatteryMode) return Promise.resolve(true);

    // Check session decision
    const decisions = sessionDecisions();
    if (backendType in decisions) {
      return Promise.resolve(decisions[backendType]);
    }

    // Show modal and wait for user decision
    return new Promise<boolean>((resolve) => {
      resolveGate = resolve;
      setPendingBackend(backendType);
    });
  };

  const handleDecision = (allowed: boolean, forSession: boolean) => {
    const backend = pendingBackend();
    if (!backend) return;

    if (forSession) {
      setSessionDecisions((prev) => ({ ...prev, [backend]: allowed }));
    }

    batch(() => {
      setPendingBackend(null);
    });
    resolveGate?.(allowed);
    resolveGate = null;
  };

  const backendLabel = () => {
    const backend = pendingBackend();
    if (!backend) return '';
    const labels: Record<GateBackendType, string> = {
      llm: 'LLM',
      tts: 'TTS',
      ocr: 'OCR',
    };
    return labels[backend];
  };

  const footer = () => (
    <div class="low-power-gate-actions">
      <div class="low-power-gate-actions-row">
        <Btn variant="danger" onClick={() => handleDecision(false, false)}>
          {t('mlearn.LowPowerGate.Deny')}
        </Btn>
        <Btn variant="primary" onClick={() => handleDecision(true, false)}>
          {t('mlearn.LowPowerGate.Allow')}
        </Btn>
      </div>
      <div class="low-power-gate-actions-row">
        <Btn variant="danger" onClick={() => handleDecision(false, true)}>
          {t('mlearn.LowPowerGate.DenySession')}
        </Btn>
        <Btn variant="primary" onClick={() => handleDecision(true, true)}>
          {t('mlearn.LowPowerGate.AllowSession')}
        </Btn>
      </div>
    </div>
  );

  const value: LowPowerGateContextValue = {
    requestAccess,
    isActive,
  };

  return (
    <LowPowerGateContext.Provider value={value}>
      {props.children}
      <Modal
        isOpen={pendingBackend() !== null}
        onClose={() => handleDecision(false, false)}
        title={t('mlearn.LowPowerGate.Title')}
        size="sm"
        footer={footer()}
        closeOnOverlay={false}
        closeOnEscape={false}
        showCloseButton={false}
      >
        <p class="low-power-gate-message">
          {t('mlearn.LowPowerGate.Message', { backendType: backendLabel() })}
        </p>
      </Modal>
    </LowPowerGateContext.Provider>
  );
};

export function useLowPowerGate(): LowPowerGateContextValue {
  const ctx = useContext(LowPowerGateContext);
  if (!ctx) {
    // Fallback for contexts where the provider isn't mounted (e.g., tests)
    return {
      requestAccess: () => Promise.resolve(true),
      isActive: () => false,
    };
  }
  return ctx;
}
