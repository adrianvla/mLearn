import { Component } from 'solid-js';
import { useLocalization } from '../../../context/LocalizationContext';
import './ManagedSettingNotice.css';

export interface ManagedSettingNoticeProps {
  sourceGroupName: string;
}

export const ManagedSettingNotice: Component<ManagedSettingNoticeProps> = (props) => {
  const { t } = useLocalization();

  return (
    <span class="managed-setting-notice" role="note">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 10V7a5 5 0 0 1 10 0v3" />
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M12 14v3" />
      </svg>
      <span>{t('mlearn.Management.ManagedBy', { group: props.sourceGroupName })}</span>
    </span>
  );
};

export default ManagedSettingNotice;
