/**
 * Structured selection creates conversations through main-owned publication.
 * Temporary practice saves an independent sandbox; persistent scope publishes
 * a permanent Room through the same Director boundary. Intent stays separate
 * from the selected identities and prepares a Director proposal for review
 * before atomic activation.
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { threadContextId, type Participant, type WorldSnapshot, type ScenarioCreation } from '../../../shared/world';
import { resolveParticipant } from '../../services/participantConstruction';
import { Btn, FormField, HintText, ModalForm, RadioChoice, Textarea } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import './NewConversationModal.css';
import { conversationRecoveryKey } from './errorUtils';

export interface NewConversationResult {
  roomId: string;
  /** Sandbox threads select themselves; persistent rooms may open Sea scope. */
  threadId: string | null;
  /** Optional user goal, passed to the orchestrator as setup context. */
  intent?: string;
}

interface NewConversationModalProps {
  world: WorldSnapshot | null;
  initialIntent?: string;
  onCreated: (result: NewConversationResult) => void | Promise<void>;
  onClose: () => void;
}

export function firstCapitalizedWordSequence(text: string): string {
  return text.match(/\b[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*/u)?.[0] ?? '';
}

function participantInitial(participant: Participant): string {
  return participant.displayName.trim().charAt(0).toUpperCase() || '?';
}

export const NewConversationModal: Component<NewConversationModalProps> = (props) => {
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const saved = props.initialIntent ? undefined : props.world?.scenarioCreations?.findLast(item => item.status === 'ready' || item.status === 'generating' || item.status === 'failed');
  const [intent, setIntent] = createSignal(props.initialIntent ?? saved?.request.intent ?? '');
  const [scope, setScope] = createSignal<'sandbox' | 'persistent'>(saved?.request.scope === 'persistent' ? 'persistent' : 'sandbox');
  const [selectedIds, setSelectedIds] = createSignal<ReadonlySet<string>>(new Set(saved?.request.participantIds ?? []));
  const [preview, setPreview] = createSignal<ScenarioCreation | null>(saved?.status === 'ready' ? saved : null);
  const [candidates, setCandidates] = createSignal<Participant[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(saved?.error ?? null);
  let creationKey: string | undefined = saved ? JSON.stringify({ ids: saved.request.participantIds, intent: saved.request.intent?.trim() ?? '' }) : undefined;
  let creationOperationId: string | undefined = saved?.operationId;
  let generation = 0;
  const persistentParticipants = createMemo(() => (props.world?.participants ?? []).filter((participant) => participant.kind === 'persistent'));

  const isSelected = (participant: Participant): boolean => selectedIds().has(participant.id);

  const toggleParticipant = (participant: Participant): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(participant.id)) next.delete(participant.id);
      else next.add(participant.id);
      return next;
    });
    setCandidates([]);
    setError(null);
  };

  const close = async (): Promise<void> => {
    generation++;
    try {
      if (creationOperationId) await getBridge().world.cancelScenario(creationOperationId);
      props.onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const changeScenario = async (): Promise<void> => {
    if (creationOperationId) await getBridge().world.cancelScenario(creationOperationId);
    setPreview(null); creationKey = undefined; creationOperationId = undefined;
  };

  const startWithSelection = async (ids: string[]): Promise<void> => {
    const bridge = getBridge().world;
    const trimmedIntent = intent().trim();
    const persistent = scope() === 'persistent';
    const key = JSON.stringify({ ids, intent: trimmedIntent, scope: scope() });
    if (key !== creationKey) { creationKey = key; creationOperationId = crypto.randomUUID(); }
    const request = { operationId: creationOperationId!, participantIds: ids,
      ...(persistent ? { scope: 'persistent' as const } : {}),
      ...(trimmedIntent ? { intent: trimmedIntent } : {}) };
    if (trimmedIntent) {
      const current = ++generation;
      const prepared = await bridge.prepareScenario(request);
      if (current === generation) setPreview(prepared);
      return;
    }
    if (persistent) {
      const room = await bridge.createPersistentRoom(request);
      await props.onCreated({ roomId: room.id, threadId: null });
      return;
    }
    const thread = await bridge.createSandbox(request);
    await props.onCreated({ roomId: threadContextId(thread), threadId: thread.id });
  };

  const handleStart = async (): Promise<void> => {
    const ids = [...selectedIds()];
    const text = intent().trim();
    if (busy() || (!preview() && ids.length === 0 && !text)) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = preview();
      if (prepared) {
        const activated = await getBridge().world.activateScenario(prepared.operationId);
        await props.onCreated('participantIds' in activated
          ? { roomId: activated.id, threadId: null }
          : { roomId: threadContextId(activated), threadId: activated.id, intent: text });
        return;
      }
      if (ids.length > 0) {
        await startWithSelection(ids);
        return;
      }

      const resolution = resolveParticipant({
        characterName: firstCapitalizedWordSequence(text),
        freeFormText: text,
      }, props.world?.participants ?? []);
      if (resolution.kind === 'ambiguous') {
        setCandidates(resolution.candidates);
        return;
      }
      if (resolution.kind === 'existing') {
        await startWithSelection([resolution.participant.id]);
        return;
      }

      await startWithSelection([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mlearn.ConversationAgent.NewConversation.Failed'));
    } finally {
      setBusy(false);
    }
  };

  // Persistent scope is Living World state: start stays blocked until the
  // user consents. The consent action persists the setting, then proceeds.
  const enableLivingWorldAndStart = async (): Promise<void> => {
    if (busy()) return;
    setError(null);
    updateSettings({ livingWorldEnabled: true });
    await handleStart();
  };

  return (
    <ModalForm
      isOpen={true}
      onClose={() => { void close(); }}
      title={t('mlearn.ConversationAgent.NewConversation.Title')}
      size="md"
      showCloseButton={true}
      closeOnOverlay={!busy()}
      closeOnEscape={!busy()}
      onSubmit={handleStart}
      footer={
        <div class="new-conversation-actions">
          <Btn variant="ghost" onClick={() => { void close(); }}>{t('mlearn.ConversationAgent.NewConversation.Cancel')}</Btn>
          <Show when={preview()}>
            <Btn variant="ghost" disabled={busy()} onClick={() => { void changeScenario().catch(err => setError(String(err))); }}>{t('mlearn.ConversationAgent.NewConversation.ChangeScenario')}</Btn>
          </Show>
          <Btn
            variant="primary"
            aria-label={t(preview() ? 'mlearn.ConversationAgent.NewConversation.UseScenario' : 'mlearn.ConversationAgent.NewConversation.StartAria')}
            onClick={handleStart}
            disabled={busy() || (!preview() && selectedIds().size === 0 && !intent().trim())
              || (!preview() && scope() === 'persistent' && !settings.livingWorldEnabled)}
          >
            {busy() ? t('mlearn.ConversationAgent.NewConversation.Starting') : t(preview() ? 'mlearn.ConversationAgent.NewConversation.UseScenario' : 'mlearn.ConversationAgent.NewConversation.Start')}
          </Btn>
        </div>
      }
    >
      <div class="new-conversation-form">
        <Show when={!preview()}>
          <fieldset class="new-conversation-scope">
            <legend class="new-conversation-scope-label">{t('mlearn.ConversationAgent.NewConversation.ScopeLabel')}</legend>
            <div class="new-conversation-scope-options" role="radiogroup" aria-label={t('mlearn.ConversationAgent.NewConversation.ScopeLabel')}>
              <RadioChoice name="conversation-scope" class="new-conversation-scope-option" label={t('mlearn.ConversationAgent.NewConversation.ScopeTemporary')} checked={scope() === 'sandbox'} onChange={() => setScope('sandbox')} disabled={busy()} />
              <RadioChoice name="conversation-scope" class="new-conversation-scope-option" label={t('mlearn.ConversationAgent.NewConversation.ScopePersistent')} checked={scope() === 'persistent'} onChange={() => setScope('persistent')} disabled={busy()} />
            </div>
            <Show when={scope() === 'persistent' && !settings.livingWorldEnabled}>
              <HintText>{t('mlearn.ConversationAgent.LivingWorld.ConsentHint')}</HintText>
              <Btn variant="primary" disabled={busy()} onClick={() => { void enableLivingWorldAndStart(); }}>
                {t('mlearn.ConversationAgent.LivingWorld.EnableAndContinue')}
              </Btn>
            </Show>
          </fieldset>
          <Show when={persistentParticipants().length > 0}>
            <fieldset class="new-conversation-people">
              <legend class="new-conversation-people-label">{t('mlearn.ConversationAgent.NewConversation.PeopleLabel')}</legend>
              <div class="new-conversation-people-list">
                <For each={persistentParticipants()}>
                  {(participant) => (
                    <Btn
                      variant="ghost"
                      class={`new-conversation-person ${isSelected(participant) ? 'new-conversation-person--selected' : ''}`}
                      aria-label={t('mlearn.ConversationAgent.NewConversation.ToggleParticipant', { name: participant.displayName })}
                      aria-pressed={isSelected(participant)}
                      onClick={() => toggleParticipant(participant)}
                      disabled={busy()}
                    >
                      <Show
                        when={participant.profilePhoto}
                        fallback={<span class="new-conversation-avatar">{participantInitial(participant)}</span>}
                      >
                        <img class="new-conversation-avatar" src={participant.profilePhoto} alt="" />
                      </Show>
                      <span class="new-conversation-person-name">{participant.displayName}</span>
                    </Btn>
                  )}
                </For>
              </div>
              <HintText>{t('mlearn.ConversationAgent.NewConversation.PeopleHint')}</HintText>
              <Show when={selectedIds().size > 0}>
                <HintText>{t(scope() === 'persistent'
                  ? 'mlearn.ConversationAgent.NewConversation.PersistentHint'
                  : 'mlearn.ConversationAgent.NewConversation.TemporaryHint')}</HintText>
              </Show>
            </fieldset>
          </Show>
          <FormField label={t(props.initialIntent || saved?.request.intent
            ? 'mlearn.ConversationAgent.NewConversation.PreparedGoalLabel'
            : 'mlearn.ConversationAgent.NewConversation.IntentLabel')}>
            <Textarea
              value={intent()}
              onInput={(event) => setIntent(event.currentTarget.value)}
              placeholder={t('mlearn.ConversationAgent.NewConversation.Placeholder')}
              rows={4}
            />
          </FormField>
          <Show when={candidates().length > 0}>
            <div class="new-conversation-disambiguation">
              <span>{t('mlearn.ConversationAgent.NewConversation.DidYouMean')}</span>
              <div class="new-conversation-people-list">
                <For each={candidates()}>
                  {(participant) => (
                    <Btn variant="ghost" class="new-conversation-person" onClick={() => toggleParticipant(participant)} disabled={busy()}>
                      {participant.displayName}
                    </Btn>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </Show>
        <Show when={preview()} keyed>
          {(prepared) => (
            <div class="new-conversation-preview">
              <HintText>{t('mlearn.ConversationAgent.NewConversation.GeneratedNotice')}</HintText>
              <For each={prepared.scenario?.scene.sharedFacts ?? []}>{fact => <p>{fact}</p>}</For>
              <For each={prepared.scenario?.participants ?? []}>
                {(reference) => {
                  const profile = reference.kind === 'temporary' ? reference.profile : undefined;
                  const existing = reference.kind === 'existing' ? prepared.bindings.find(item => item.originId === reference.participantId)?.baseline : undefined;
                  return <details>
                    <summary>{profile?.name ?? existing?.displayName}</summary>
                    <p>{profile?.personaText ?? existing?.personaText}</p>
                    <Show when={profile}>
                      <HintText>{t('mlearn.ConversationAgent.NewConversation.PrivatePreview')}</HintText>
                      <For each={profile?.goals ?? []}>{goal => <p>{goal}</p>}</For>
                      <For each={profile?.initialKnowledge ?? []}>{fact => <p>{fact.text}</p>}</For>
                    </Show>
                  </details>;
                }}
              </For>
            </div>
          )}
        </Show>
        <Show when={error()}>
          <div class="new-conversation-error" role="alert">
            <p>{t(conversationRecoveryKey(error()))}</p>
            <Btn variant="ghost" onClick={() => getBridge().window.openWindow({ type: 'settings', context: { section: 'ai' } })}>{t('mlearn.ConversationAgent.Recovery.Settings')}</Btn>
            <details><summary>{t('mlearn.Knowledge.Projection.Relations.Advanced')}</summary><p>{error()}</p></details>
          </div>
        </Show>
      </div>
    </ModalForm>
  );
};
