import { For, Show, type Component } from 'solid-js';
import type { LanguageDataInstallProgress } from '../../../../shared/types';
import { useLocalization } from '../../../context';
import './LanguageDataJobProgress.css';

export const LanguageDataJobProgress: Component<{ jobs: LanguageDataInstallProgress[] }> = props => {
  const { t } = useLocalization();
  return <div class="language-data-jobs" aria-live="polite">
    <For each={props.jobs}>{job => <div class="language-data-job" data-operation-id={job.operationId}>
      <span>{job.language}{job.dictionaryTargetLanguage ? ` → ${job.dictionaryTargetLanguage}` : ''}</span>
      <span>{t(`mlearn.LanguageSetup.Phases.${job.phase}`)}</span>
      <Show when={job.phase === 'downloading'}>
        <Show when={job.expectedBytes && job.expectedBytes > 0}
          fallback={<progress aria-label={t('mlearn.LanguageSetup.Phases.downloading')} />}>
          <progress aria-label={t('mlearn.LanguageSetup.Phases.downloading')}
            max={job.expectedBytes} value={job.downloadedBytes ?? 0} />
        </Show>
        <Show when={job.downloadedBytes !== undefined}>
          <span>{job.downloadedBytes?.toLocaleString()}{job.expectedBytes && job.expectedBytes > 0 ? ` / ${job.expectedBytes.toLocaleString()}` : ''} {t('mlearn.LanguageSetup.Bytes')}</span>
        </Show>
      </Show>
      <Show when={job.error}><span role="alert">{job.error}</span></Show>
    </div>}</For>
  </div>;
};
