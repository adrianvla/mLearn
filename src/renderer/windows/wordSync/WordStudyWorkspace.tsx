import { createMemo, Show, type Component } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { Button } from '../../components/common';
import { materialPracticeContext } from '../levelStudy/materialPracticeContext';
import { WordSyncContent } from './App';

/** A route owns launch intent; the existing task owns its evidence and cursor. */
export const WordStudyWorkspace: Component<{
  mode: 'study' | 'assessment';
  launchContext?: Record<string, unknown>;
  onReturn: (path: string) => void;
}> = props => {
  const { settings, isLoading } = useSettings();
  const { t } = useLocalization();
  const material = createMemo(() => materialPracticeContext(props.launchContext?.material, settings.language));
  const valid = () => props.launchContext?.material === undefined || material() !== undefined;
  const session = () => props.launchContext?.session as { encounterLimit?: unknown; requestId?: unknown } | undefined;
  const limit = () => {
    const value = session()?.encounterLimit;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(120, Math.floor(value))) : undefined;
  };
  const requestId = () => typeof session()?.requestId === 'string' ? session()!.requestId as string : undefined;
  const returnPath = () => props.launchContext?.returnTo === 'reader' ? '/reader'
    : props.launchContext?.returnTo === 'video' ? '/video'
    : props.launchContext?.returnTo === 'home' ? '/'
    : material() || props.launchContext?.returnTo === 'material' ? '/knowledge/material'
    : props.launchContext?.returnTo === 'plan' ? '/plan' : props.mode === 'assessment' ? '/evaluate' : '/practise';
  return <Show when={!isLoading()}><Show when={valid()} fallback={
    <section class="product-workspace"><p>{t('mlearn.Goals.Unavailable')}</p>
      <Button onClick={() => props.onReturn(returnPath())}>{t('mlearn.LearningPlan.Back')}</Button></section>
  }>
    <WordSyncContent mode={props.mode}
      intent={props.mode === 'study' && props.launchContext?.activity === 'reinforce' ? 'reinforce' : undefined}
      words={material()?.words} sourceLabel={material()?.label}
      encounterLimit={limit()} sessionRequestId={requestId()}
      launchIntent={props.launchContext?.intent === 'start' || props.launchContext?.intent === 'resume' ? props.launchContext.intent : requestId() || material() ? 'start' : 'open'}
      resumeSessionId={typeof props.launchContext?.sessionId === 'string' ? props.launchContext.sessionId : undefined}
      onClose={() => props.onReturn(returnPath())} onAssessmentApplied={() => props.onReturn('/plan')} />
  </Show></Show>;
};
