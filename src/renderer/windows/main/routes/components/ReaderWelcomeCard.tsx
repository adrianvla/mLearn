/**
 * Reader Welcome Card Component
 * Displayed when no book is loaded
 */

import { Component, Accessor } from 'solid-js';
import { useLocalization } from '../../../../context';
import { Btn } from '../../../../components/common';
import './ReaderWelcomeCard.css';

interface ReaderWelcomeCardProps {
  isDragging: Accessor<boolean>;
  onOpenFolder?: () => void;
  onOpenPdf?: () => void;
}

export const ReaderWelcomeCard: Component<ReaderWelcomeCardProps> = (props) => {
  const { t } = useLocalization();

  return (
      <div class="reader-welcome">
        <div class={`reader-welcome-card ${props.isDragging() ? 'dragging' : ''}`}>
          <h2>{t('mlearn.Reader.UI.WelcomeSplash.Title')}</h2>
          <p class="reader-welcome-intro">
            {t('mlearn.Reader.UI.WelcomeSplash.TitleDescription')}
          </p>
          <div class={`reader-welcome-dropzone ${props.isDragging() ? 'dragging' : ''}`}>
            {t('mlearn.Reader.UI.WelcomeSplash.DropZone')}
          </div>

          {/* Open buttons for Electron users */}
          {(props.onOpenFolder || props.onOpenPdf) && (
              <div class="reader-welcome-buttons">
                {props.onOpenFolder && (
                    <Btn variant="secondary" onClick={props.onOpenFolder}>
                      {t('mlearn.Reader.UI.WelcomeSplash.OpenFolder')}
                    </Btn>
                )}
                {props.onOpenPdf && (
                    <Btn variant="secondary" onClick={props.onOpenPdf}>
                      {t('mlearn.Reader.UI.WelcomeSplash.OpenPdf')}
                    </Btn>
                )}
              </div>
          )}

        </div>
      </div>
  );
};

export default ReaderWelcomeCard;
