/**
 * Integration review — the production boundary between a disposable Thread
 * and the persistent world. Main-owned preview computes exactly what a
 * selection admits (memories, people, situation) into the chosen persistent
 * Room; commit is one idempotent operation, so retrying after a failure is
 * always safe.
 */

import { Component, For, Show, createEffect, createSignal } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type {
  IntegrationPreview,
  IntegrateThreadResult,
  MemoryEntry,
  Room,
  Thread,
} from '../../../shared/world';
import { Btn, HintText, ModalForm, Tag } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import { WORLD_CONTINUITY_ID } from '../../../shared/world';
import './IntegrationModal.css';

interface IntegrationModalProps {
  thread: Thread;
  rooms: Room[];
  /** Called after a committed integration so the owner can refresh world state. */
  onIntegrated: () => void | Promise<void>;
  onClose: () => void;
}

const KIND_LABEL_KEYS: Record<MemoryEntry['kind'], string> = {
  belief: 'mlearn.ConversationAgent.Integration.KindBelief',
  episode: 'mlearn.ConversationAgent.Integration.KindEpisode',
  'open-loop': 'mlearn.ConversationAgent.Integration.KindOpenLoop',
  relationship: 'mlearn.ConversationAgent.Integration.KindRelationship',
  fact: 'mlearn.ConversationAgent.Integration.KindFact',
};

export const IntegrationModal: Component<IntegrationModalProps> = (props) => {
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const [destinationId, setDestinationId] = createSignal(WORLD_CONTINUITY_ID);
  const [selectedIds, setSelectedIds] = createSignal<ReadonlySet<string>>(new Set());
  const [manualAdoptIds, setManualAdoptIds] = createSignal<ReadonlySet<string>>(new Set());
  const [refresh, setRefresh] = createSignal(0);
  const [adoptIds, setAdoptIds] = createSignal<ReadonlySet<string>>(new Set());
  const [includeScenario, setIncludeScenario] = createSignal(false);
  const [preview, setPreview] = createSignal<IntegrationPreview | null>(null);
  // True while the preview for the CURRENT selection is still in flight; the
  // previous preview stays visible but can no longer enable the commit.
  const [previewPending, setPreviewPending] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [committed, setCommitted] = createSignal<IntegrateThreadResult | null>(null);
  // One stable operation identity per modal session: a retry after a failure
  // replays the same integration instead of admitting a second copy.
  const [integrationId] = createSignal(crypto.randomUUID());
  let previewGeneration = 0;


  createEffect(() => {
    refresh();
    const request = {
      threadId: props.thread.id,
      destinationRoomId: destinationId(),
      memoryEventIds: [...selectedIds()],
      adoptParticipantIds: [...adoptIds()],
      includeScenario: includeScenario(),
    };
    if (!request.destinationRoomId) return;
    const generation = ++previewGeneration;
    setPreviewPending(true);
    getBridge().world.previewIntegration(request).then((next) => {
      if (generation !== previewGeneration) return;
      setPreview(next);
      setPreviewPending(false);
      // Necessary dependencies are checked automatically; the preview then
      // converges on the next pass with a complete selection.
      const effective = new Set([...manualAdoptIds(), ...next.requiredAdoptions]);
      if (effective.size !== adoptIds().size || [...effective].some(id => !adoptIds().has(id))) setAdoptIds(effective);
    }).catch((err) => {
      if (generation !== previewGeneration) return;
      setPreview(null);
      setPreviewPending(false);
      setError(String(err instanceof Error ? err.message : err));
    });
  });

  const toggleItem = (sourceEventId: string): void => {
    setError(null);
    const next = new Set(selectedIds());
    if (next.has(sourceEventId)) next.delete(sourceEventId);
    else next.add(sourceEventId);
    setSelectedIds(next);
  };

  const toggleAdopt = (id: string): void => {
    setError(null);
    const next = new Set(adoptIds());
    if (next.has(id)) {
      if (preview()?.requiredAdoptions.includes(id)) return; // required by the selection
      next.delete(id);
    } else {
      next.add(id);
    }
    setManualAdoptIds(new Set([...next].filter(id => !preview()?.requiredAdoptions.includes(id))));
    setAdoptIds(next);
  };

  const canConfirm = () => Boolean(destinationId())
    && !busy()
    && !committed()
    && settings.livingWorldEnabled
    && !previewPending()
    && Boolean(preview())
    && (selectedIds().size > 0 || includeScenario() || adoptIds().size > 0)
    && (preview()?.problems.length ?? 1) === 0;

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await getBridge().world.integrateThread({
        integrationId: integrationId(),
        threadId: props.thread.id,
        destinationRoomId: destinationId(),
        memoryEventIds: [...selectedIds()].sort(),
        adoptParticipantIds: [...adoptIds()].sort(),
        includeScenario: includeScenario(),
      });
      setCommitted(result);
      await props.onIntegrated();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
      setRefresh(value => value + 1);
    }
  };

  return (
    <ModalForm
      isOpen={true}
      onClose={props.onClose}
      title={t('mlearn.ConversationAgent.Integration.Title')}
      size="md"
      showCloseButton={true}
      closeOnOverlay={!busy()}
      closeOnEscape={!busy()}
      footer={
        <div class="integration-actions">
          <Btn variant="ghost" onClick={props.onClose}>{t('mlearn.ConversationAgent.Integration.Close')}</Btn>
          <Show when={!committed()}>
            {/* Admission extends the persistent world; confirm stays blocked
                until Living World is enabled. */}
            <Show when={!settings.livingWorldEnabled}>
              <HintText>{t('mlearn.ConversationAgent.LivingWorld.ConsentHint')}</HintText>
              <Btn variant="ghost" onClick={() => updateSettings({ livingWorldEnabled: true })}>
                {t('mlearn.ConversationAgent.LivingWorld.EnableAndContinue')}
              </Btn>
            </Show>
            <Btn variant="primary" disabled={!canConfirm()} onClick={() => { void confirm(); }}>
              {busy() ? t('mlearn.ConversationAgent.Integration.Committing') : t('mlearn.ConversationAgent.Integration.Confirm')}
            </Btn>
          </Show>
        </div>
      }
    >
      <div class="integration-form">
        <p class="integration-boundary">{t('mlearn.ConversationAgent.Integration.BoundaryHint')}</p>

        <Show when={!committed()} fallback={
          <div class="integration-done">
            <p>{t('mlearn.ConversationAgent.Integration.Done', { count: String(committed()?.appended.filter(event => event.type === 'memory.belief').length ?? 0) })}</p>
            <Btn variant="primary" onClick={props.onClose}>{t('mlearn.ConversationAgent.Integration.Close')}</Btn>
          </div>
        }>
            <fieldset class="integration-section">
              <legend class="integration-label">{t('mlearn.ConversationAgent.Integration.DestinationLabel')}</legend>
              <select
                class="integration-destination"
                aria-label={t('mlearn.ConversationAgent.Integration.DestinationLabel')}
                value={destinationId()}
                onChange={(event) => setDestinationId(event.currentTarget.value)}
                disabled={busy()}
              >
                <option value={WORLD_CONTINUITY_ID}>{t('mlearn.ConversationAgent.Integration.WorldDestination')}</option>
                <For each={props.rooms}>{(room) => <option value={room.id}>{room.title}</option>}</For>
              </select>
              <HintText>{t('mlearn.ConversationAgent.Integration.DestinationHint')}</HintText>
            </fieldset>

            <Show when={preview()}>
              {(current) => (
                <>
                  <For each={current().operations?.filter(record => record.status !== 'committed')}>
                    {(record) => <div class="integration-error" role="status">
                      <p>{t(record.status === 'pending' ? 'mlearn.ConversationAgent.Integration.Pending' : 'mlearn.ConversationAgent.Integration.Interrupted')}</p>
                      <p>{record.note}</p>
                      <Show when={record.status === 'pending'}>
                        <Btn disabled={busy()} onClick={async () => {
                          setBusy(true);
                          try {
                            setError(null);
                            const result = await getBridge().world.integrateThread({ integrationId: record.integrationId,
                              threadId: record.sourceThreadId, destinationRoomId: record.destinationRoomId,
                              memoryEventIds: record.memoryEventIds, adoptParticipantIds: record.adoptParticipantIds,
                              includeScenario: record.includeScenario });
                            setCommitted(result);
                            await props.onIntegrated();
                          } catch (err) { setError(String(err)); }
                          finally { setBusy(false); setRefresh(value => value + 1); }
                        }}>{t('mlearn.ConversationAgent.Integration.Retry')}</Btn>
                      </Show>
                    </div>}
                  </For>
                  <fieldset class="integration-section">
                    <legend class="integration-label">{t('mlearn.ConversationAgent.Integration.ItemsLabel')}</legend>
                    <Show when={current().items.length > 0} fallback={<HintText>{t('mlearn.ConversationAgent.Integration.NoItemsHint')}</HintText>}>
                      <div class="integration-items">
                        <For each={current().items}>
                          {(item) => (
                            <label
                              class={`integration-item ${item.integratedBy ? 'integration-item--claimed' : ''}`}
                              aria-label={t('mlearn.ConversationAgent.Integration.ToggleItem', { text: item.text })}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds().has(item.sourceEventId)}
                                onChange={() => toggleItem(item.sourceEventId)}
                                disabled={busy() || Boolean(item.integratedBy)}
                              />
                              <span class="integration-item-kind">{t(KIND_LABEL_KEYS[item.kind])}</span>
                              <span class="integration-item-text">{item.text}</span>
                              <span class="integration-item-witnesses">{item.witnesses.join(', ')}</span>
                              <Show when={item.integratedBy}>
                                <span class="integration-item-status"><Tag size="sm">{t('mlearn.ConversationAgent.Integration.AlreadyIntegrated')}</Tag></span>
                              </Show>
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                  </fieldset>

                  <fieldset class="integration-section">
                    <legend class="integration-label">{t('mlearn.ConversationAgent.Integration.PeopleLabel')}</legend>
                    <div class="integration-people">
                      <For each={current().people}>
                        {(person) => (
                          <label class="integration-person">
                            <Show when={person.action === 'adopt'} fallback={<span class="integration-person-action">{t('mlearn.ConversationAgent.Integration.PersonReference')}</span>}>
                              <input
                                type="checkbox"
                                checked={adoptIds().has(person.id)}
                                onChange={() => toggleAdopt(person.id)}
                                disabled={busy()}
                              />
                              <span class="integration-person-action">{t('mlearn.ConversationAgent.Integration.PersonAdopt')}</span>
                            </Show>
                            <span class="integration-person-name">{person.displayName}</span>
                            <Show when={person.required}><Tag size="sm">{t('mlearn.ConversationAgent.Integration.Required')}</Tag></Show>
                            <Show when={person.baselineDrift}><HintText>{t('mlearn.ConversationAgent.Integration.DriftWarning')}</HintText></Show>
                          </label>
                        )}
                      </For>
                    </div>
                  </fieldset>

                  <Show when={Boolean(props.thread.scenario)}>
                    <label class="integration-scenario">
                      <input
                        type="checkbox"
                        checked={includeScenario()}
                        onChange={(event) => { setError(null); setIncludeScenario(event.currentTarget.checked); }}
                        disabled={busy() || !current().scenarioAvailable}
                      />
                      <span>{t('mlearn.ConversationAgent.Integration.ScenarioLabel')}</span>
                      <HintText>{current().scenarioAvailable
                        ? t('mlearn.ConversationAgent.Integration.ScenarioHint')
                        : t(destinationId() === WORLD_CONTINUITY_ID ? 'mlearn.ConversationAgent.Integration.ScenarioNeedsRoom' : 'mlearn.ConversationAgent.Integration.ScenarioUnavailable')}</HintText>
                    </label>
                  </Show>

                  <Show when={current().problems.length > 0}>
                    <ul class="integration-problems">
                      <For each={current().problems}>{(problem) => <li>{problem}</li>}</For>
                    </ul>
                  </Show>
                </>
              )}
            </Show>
        </Show>

        <Show when={error()}>
          <div class="integration-error">{error()}</div>
        </Show>
      </div>
    </ModalForm>
  );
};

