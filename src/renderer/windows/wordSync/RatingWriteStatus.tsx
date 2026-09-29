/**
 * Save-state banner for a rating submission, driven by the shared study
 * session contract. Assessment and drill rating both render this so the
 * "saving" / "save failed" wording and the retry affordance cannot drift.
 */
import { Component, Show } from 'solid-js';
import { Button } from '../../components/common';
import { useLocalization } from '../../context';
import type { StudySessionState } from '../../learning/studySession';

interface RatingWriteStatusProps {
  presentation: StudySessionState;
  /** The pending write to retry. Present exactly while the write has failed. */
  retry: unknown | null | undefined;
  onRetry: () => void;
  /** Class applied to the saving banner, for the surface's styling hooks. */
  class?: string;
  /** Extra class applied only to the failure banner. */
  failedClass?: string;
}

function bannerClass(base?: string, extra?: string): string | undefined {
  if (!base) return extra;
  return extra ? `${base} ${extra}` : base;
}

export const RatingWriteStatus: Component<RatingWriteStatusProps> = (props) => {
  const { t } = useLocalization();
  return (
    <>
      <Show when={props.presentation.phase === 'saving'}>
        <div class={props.class} role="status" aria-live="polite">{t('mlearn.WordSync.SavingRating')}</div>
      </Show>
      <Show when={props.presentation.phase === 'save-failed'}>
        <div class={bannerClass(props.class, props.failedClass)} role="alert">
          <span>{t('mlearn.WordSync.SaveFailed')}</span>
          <Button variant="primary" size="sm" onClick={() => { if (props.retry) props.onRetry(); }}>
            {t('mlearn.Global.TryAgain')}
          </Button>
        </div>
      </Show>
    </>
  );
};
