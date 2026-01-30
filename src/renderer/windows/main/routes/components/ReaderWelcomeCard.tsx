/**
 * Reader Welcome Card Component
 * Displayed when no book is loaded
 */

import { Component, Accessor } from 'solid-js';
import { useLocalization } from '../../../../context';
import './ReaderWelcomeCard.css';

interface ReaderWelcomeCardProps {
  isDragging: Accessor<boolean>;
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
        <div class="reader-welcome-grid">
          <div class="reader-welcome-tip">
            <h3>{t('mlearn.Reader.UI.Tips.ShapeView.Title')}</h3>
            <p>{t('mlearn.Reader.UI.Tips.ShapeView.Description')}</p>
          </div>
          <div class="reader-welcome-tip">
            <h3>{t('mlearn.Reader.UI.Tips.SummonOcr.Title')}</h3>
            <p>{t('mlearn.Reader.UI.Tips.SummonOcr.Description')}</p>
          </div>
          <div class="reader-welcome-tip">
            <h3>{t('mlearn.Reader.UI.Tips.NeverLosePlace.Title')}</h3>
            <p>{t('mlearn.Reader.UI.Tips.NeverLosePlace.Description')}</p>
          </div>
        </div>
        <p class="reader-welcome-footer">{t('mlearn.Reader.UI.WelcomeSplash.Footer')}</p>
      </div>
    </div>
  );
};

export default ReaderWelcomeCard;
