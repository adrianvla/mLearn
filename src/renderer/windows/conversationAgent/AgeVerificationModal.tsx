import { Component } from 'solid-js';
import { useLocalization } from '../../context';
import { Btn, Panel } from '../../components/common';
import './AgeVerificationModal.css';

interface AgeVerificationModalProps {
  onAccept: () => void;
}

export const AgeVerificationModal: Component<AgeVerificationModalProps> = (props) => {
  const { t } = useLocalization();

  return (
    <div class="avm-overlay">
      <Panel variant="solid" rounded="lg" padding="none" class="avm-card">
        <div class="avm-content">
          <h2 class="avm-title">{t('mlearn.ConversationAgent.AgeVerification.Title')}</h2>

          <div class="avm-section">
            <p class="avm-text avm-warning">
              {t('mlearn.ConversationAgent.AgeVerification.AIWarning')}
            </p>
          </div>

          <div class="avm-section">
            <p class="avm-text avm-safety">
              {t('mlearn.ConversationAgent.AgeVerification.SafetyNotice')}
            </p>
          </div>

          <div class="avm-section">
            <p class="avm-text">
              {t('mlearn.ConversationAgent.AgeVerification.AgeVerificationText')}
            </p>
          </div>

          <div class="avm-section">
            <p class="avm-text avm-certify">
              {t('mlearn.ConversationAgent.AgeVerification.Certification')}
            </p>
          </div>
        </div>

        <div class="avm-actions">
          <Btn
            variant="primary"
            size="lg"
            onClick={props.onAccept}
            class="avm-continue-btn"
          >
            {t('mlearn.ConversationAgent.AgeVerification.ContinueButton')}
          </Btn>
        </div>
      </Panel>
    </div>
  );
};
