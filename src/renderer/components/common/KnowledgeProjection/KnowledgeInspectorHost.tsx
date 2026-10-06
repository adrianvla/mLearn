import { Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { useFlashcards } from '../../../context/FlashcardContext';
import { useKnowledgeProjection } from '../../../hooks/useKnowledgeProjection';
import { eventsVersion, getEvents } from '../../../services/knowledgeEvents';
import { closeKnowledgeInspector, knowledgeInspection } from '../../../services/openKnowledgeInspector';
import { openGraphInspector } from '../../../services/openGraphInspector';
import { hashWordSync } from '../../../services/srsAlgorithm';
import { KnowledgeProjectionDrawer } from './KnowledgeProjection';
import { assembleWordKnowledgeModel } from './wordKnowledgeModel';

/** One lazily queried inspector per window, independent of source-page navigation. */
export const KnowledgeInspectorHost: Component = () => {
  const { getComprehensiveWordStatusWithSourceSync, setWordClaim, setAccessClaim, clearAccessClaim } = useFlashcards();
  const { projection, retry } = useKnowledgeProjection(knowledgeInspection);
  const [historySnapshot, setHistorySnapshot] = createSignal<{ key: string; events: KnowledgeEvent[] }>();
  const [historyFailureKey, setHistoryFailureKey] = createSignal<string>();
  const [historyRetry, setHistoryRetry] = createSignal(0);
  const inspectionKey = () => {
    const inspection = knowledgeInspection();
    return inspection ? JSON.stringify([
      inspection.language,
      hashWordSync(inspection.surface),
      inspection.target.kind,
      inspection.target.id,
    ]) : undefined;
  };
  const events = createMemo(() => {
    const snapshot = historySnapshot();
    return snapshot && snapshot.key === inspectionKey() ? snapshot.events : undefined;
  });
  const historyFailed = createMemo(() => {
    const key = inspectionKey();
    return key !== undefined && historyFailureKey() === key;
  });
  createEffect(() => {
    const inspection = knowledgeInspection();
    eventsVersion();
    historyRetry();
    if (!inspection) return;
    const key = inspectionKey()!;
    let disposed = false;
    void getEvents([`${inspection.language}:${hashWordSync(inspection.surface)}`]).then(
      (value) => { if (!disposed) { setHistorySnapshot({ key, events: value }); setHistoryFailureKey(undefined); } },
      () => { if (!disposed) setHistoryFailureKey(key); },
    );
    onCleanup(() => { disposed = true; });
  });
  const model = createMemo(() => {
    const inspection = knowledgeInspection();
    return assembleWordKnowledgeModel({
      projection: projection(), events: events(),
      comprehensive: inspection ? getComprehensiveWordStatusWithSourceSync(inspection.surface, inspection.language) : undefined,
    });
  });
  return <Show when={knowledgeInspection()}>{(inspection) => <KnowledgeProjectionDrawer
    open
    onClose={closeKnowledgeInspector}
    surface={inspection().surface}
    target={inspection().target}
    language={inspection().language}
    model={model()}
    onRetryProjection={retry}
    historyFailed={historyFailed()}
    onRetryHistory={() => setHistoryRetry(value => value + 1)}
    policyTrace={inspection().policyTrace}
    policyBrief={inspection().policyBrief}
    onGraph={(entityId) => openGraphInspector({ entityId })}
    onWordClaim={(claim) => setWordClaim(inspection().surface, claim, inspection().language)}
    onAccessClaim={(capability, claim) => {
      if (claim === null) return clearAccessClaim(inspection().surface, capability, inspection().language);
      return setAccessClaim(inspection().surface, capability, claim, inspection().language);
    }}
  />}</Show>;
};
