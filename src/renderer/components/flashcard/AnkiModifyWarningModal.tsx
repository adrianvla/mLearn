/**
 * AnkiModifyWarningModal
 * Shared warning modal shown before modifying Anki card ease/repositioning.
 * Used by WordHover (single word) and route-level Add All flows.
 */

import { Component, createSignal, Show } from 'solid-js';
import { Btn, Modal, ToggleSwitch } from '../common';
import { useLocalization } from '../../context';
import './AnkiModifyWarningModal.css';

export interface AnkiModifyWarningModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  onConfirm: (dontRemind: boolean) => void;
  onConfirmBuiltInOnly?: (dontRemind: boolean) => void;
  onCancel: () => void;
  dontRemindLabel?: string;
}

export const AnkiModifyWarningModal: Component<AnkiModifyWarningModalProps> = (props) => {
  const { t } = useLocalization();
  const [dontRemind, setDontRemind] = createSignal(false);

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onCancel}
      title={props.title}
    >
      <div class="anki-modify-warning">
        <p class="anki-modify-warning__message">
          {props.message}
        </p>
        <div class="anki-modify-warning__toggle-row">
          <ToggleSwitch
            checked={dontRemind()}
            onChange={setDontRemind}
            label={props.dontRemindLabel ?? t('mlearn.WordHover.AnkiModifyWarning.DontRemind')}
          />
        </div>
        <div class="anki-modify-warning__actions">
          <Btn variant="secondary" onClick={props.onCancel}>
            {t('mlearn.Global.Cancel')}
          </Btn>
          <Show when={props.onConfirmBuiltInOnly}>
            <Btn variant="secondary" onClick={() => props.onConfirmBuiltInOnly?.(dontRemind())}>
              {t('mlearn.WordHover.AnkiModifyWarning.BuiltInOnly')}
            </Btn>
          </Show>
          <Btn variant="primary" onClick={() => props.onConfirm(dontRemind())}>
            {props.confirmText}
          </Btn>
        </div>
      </div>
    </Modal>
  );
};
