import { Show, type Component } from 'solid-js';
import { useLocalization } from '../../../context';
import { Button } from '../Button/Button';
import './MediaUsageSaveStatus.css';

export const MediaUsageSaveStatus: Component<{ error: unknown; retry: () => Promise<void> }> = props => {
  const { t } = useLocalization();
  return <Show when={props.error}><div class="media-usage-save-status" role="alert">
    <span>{t('mlearn.Media.UsageSaveFailed')}</span>
    <Button onClick={() => { void props.retry().catch(() => {}); }}>{t('mlearn.Media.RetryUsageSave')}</Button>
  </div></Show>;
};
