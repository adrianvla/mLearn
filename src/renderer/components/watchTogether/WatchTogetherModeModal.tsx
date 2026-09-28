import { Component } from 'solid-js';
import { useLocalization } from '../../context';
import { Button, Modal, Panel } from '../common';
import './WatchTogetherModeModal.css';

export interface WatchTogetherModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChooseLocal: () => void;
  onChooseCode: () => void;
}

export const WatchTogetherModeModal: Component<WatchTogetherModeModalProps> = (props) => {
  const { t } = useLocalization();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.WatchTogether.Mode.Title')}
      subtitle={t('mlearn.WatchTogether.Mode.Subtitle')}
      size="md"
    >
      <div class="watch-together-mode-modal">
        <Panel variant="solid" rounded="lg" padding="lg" class="watch-together-mode-card">
          <div class="watch-together-mode-copy">
            <h3>{t('mlearn.WatchTogether.Mode.Local.Title')}</h3>
            <p>{t('mlearn.WatchTogether.Mode.Local.Description')}</p>
          </div>
          <Button variant="secondary" onClick={props.onChooseLocal}>
            {t('mlearn.WatchTogether.Mode.Local.Action')}
          </Button>
        </Panel>

        <Panel variant="solid" rounded="lg" padding="lg" class="watch-together-mode-card">
          <div class="watch-together-mode-copy">
            <h3>{t('mlearn.WatchTogether.Mode.Code.Title')}</h3>
            <p>{t('mlearn.WatchTogether.Mode.Code.Description')}</p>
          </div>
          <Button variant="primary" onClick={props.onChooseCode}>
            {t('mlearn.WatchTogether.Mode.Code.Action')}
          </Button>
        </Panel>
      </div>
    </Modal>
  );
};