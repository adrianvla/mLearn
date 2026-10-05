import { createEffect, createSignal, For, onCleanup, Show, type Component, type JSX } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../context';
import { ActionCard, Button, TargetIcon } from '../../components/common';
import type { ReviewPositionSwitch } from '../../../shared/reviewPresentationWrite';
import { getBridge } from '../../../shared/bridges';
import './ReviewWorkspace.css';
import { reviewSessionRemaining } from '../../../shared/reviewSession';

/** Admission changes only the canonical cursor; the existing reviewer owns encounters and evidence. */
export const ReviewWorkspace: Component<{
  launchContext?: Record<string, unknown>;
  /** Direct Review entry; the legacy chooser remains available to explicit callers. */
  autoEnter?: boolean;
  onReturn: () => void;
  children: JSX.Element;
}> = props => {
  const { store, isKnowledgeReady, switchReviewPosition } = useFlashcards();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const [active, setActive] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [resuming, setResuming] = createSignal(false);
  let retry: (() => void) | undefined;
  let requested = false;
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const currentId = () => {
    const session = store.meta.reviewSessions?.[settings.language];
    return session ? reviewSessionRemaining(session) > 0 ? session.id : undefined
      : store.meta.reviewPresentations?.[settings.language]?.id;
  };
  const saved = () => Object.entries(store.meta.suspendedReviews?.[settings.language] ?? {})
    .filter(([, position]) => position.session ? reviewSessionRemaining(position.session) > 0 : position.presentation !== undefined);
  const admit = (resumeId?: string) => {
    if (pending()) return;
    const language = settings.language;
    const command: ReviewPositionSwitch = JSON.parse(JSON.stringify({ kind: 'switch', language,
      expectedPresentation: store.meta.reviewPresentations?.[language] ?? null,
      expectedSession: store.meta.reviewSessions?.[language] ?? null,
      ...(resumeId !== undefined ? { resumeId } : {}),
    }));
    retry = () => admit(resumeId);
    setPending(true); setFailed(false); setResuming(resumeId !== undefined);
    void switchReviewPosition(command).then(() => {
      if (!disposed && settings.language === language) setActive(true);
    }).catch(() => {
      if (!disposed && settings.language === language) setFailed(true);
    }).finally(() => { if (!disposed) setPending(false); });
  };
  createEffect(() => {
    if (requested || !isKnowledgeReady()) return;
    requested = true;
    const context = props.launchContext;
    if (context?.intent === 'resume') {
      if (typeof context.sessionId !== 'string' || !context.sessionId) { setFailed(true); setResuming(true); return; }
      admit(context.sessionId);
    } else if (context?.intent === 'start' || context?.session !== undefined) admit();
    else if (props.autoEnter) admit(currentId());
  });
  return <Show when={active()} fallback={
    <section class="product-workspace">
      <h1>{t('mlearn.Flashcards.UI.Tabs.Review')}</h1>
      <Show when={failed()}><p role="alert">{t(resuming() ? 'mlearn.Product.ResumeUnavailable' : 'mlearn.WordSync.SessionStartFailed')}</p>
        <Show when={retry}><Button disabled={pending()} onClick={() => retry?.()}>{t('mlearn.Global.TryAgain')}</Button></Show>
      </Show>
      <Show when={pending() || (props.autoEnter && !failed())} fallback={<>
        <div class="study-chooser-primary"><ActionCard icon={<TargetIcon size={24} />} primary
          title={`${t(currentId() ? 'mlearn.StudyEncounter.Resume' : 'mlearn.LevelStudy.Mock.Start')} · ${t('mlearn.Flashcards.UI.Tabs.Review')}`}
          description={t('mlearn.Product.ReviewDescription')} disabled={!isKnowledgeReady()}
          onClick={() => admit(currentId())} /></div>
        <div class="study-chooser-alternatives">
          <ActionCard icon={<TargetIcon size={20} />} title={t('mlearn.Product.WordPractice')}
            description={t('mlearn.Product.WordPracticeDescription')}
            onClick={() => getBridge().window.openWindow({ type: 'level-study', context: { activity: 'practice' } })} />
          <ActionCard icon={<TargetIcon size={20} />} title={t('mlearn.Product.GrammarPractice')}
            description={t('mlearn.Product.GrammarPracticeDescription')}
            onClick={() => getBridge().window.openWindow({ type: 'level-study', context: { activity: 'grammar' } })} />
        </div>
        <Show when={currentId() || saved().length}><details class="study-chooser-saved">
          <summary>{t('mlearn.Product.OtherSessions')}</summary>
          <div class="product-workspace-actions">
            <Show when={currentId()}><Button onClick={() => admit()}>{t('mlearn.LevelStudy.Mock.Start')} · {t('mlearn.Flashcards.UI.Tabs.Review')}</Button></Show>
            <For each={saved()}>{([id, position]) => <Button onClick={() => admit(id)}>
              {t('mlearn.StudyEncounter.Resume')} · {t('mlearn.Flashcards.UI.Tabs.Review')}
              <Show when={position.session?.startedAt ?? position.presentation?.decision?.at}>{at => <>{' · '}{new Date(at()).toLocaleString(settings.uiLanguage)}</>}</Show>
            </Button>}</For>
          </div>
        </details></Show>
        <Button variant="ghost" onClick={props.onReturn}>{t('mlearn.Product.Return')}</Button>
      </>}><p role="status">{t('mlearn.Global.Loading')}</p></Show>
    </section>
  }>{props.children}</Show>;
};
