/**
 * Structured selection creates conversations through main-owned publication.
 * Temporary practice saves an independent sandbox; persistent scope publishes
 * a permanent Room through the same Director boundary. Intent stays separate
 * from the selected identities and prepares a Director proposal for review
 * before atomic activation.
 */

import { Component, For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { threadContextId, type Participant, type WorldSnapshot, type ScenarioCreation } from '../../../shared/world';
import { resolveParticipant } from '../../services/participantConstruction';
import { Avatar, Button, Disclosure, FormField, HintText, Input, ListRow, ModalForm, PlusIcon, RadioChoice, SearchIcon, Textarea } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import './NewConversationModal.css';
import { ParticipantEditorModal } from './ParticipantEditorModal';
import { conversationRecoveryKey } from './errorUtils';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger('renderer.tutor.start');

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
  mediaName?: string;
  onContactCreated?: (person: Participant) => void;
  onCreated: (result: NewConversationResult) => void | Promise<void>;
  onClose: () => void;
}

export function firstCapitalizedWordSequence(text: string): string {
  return text.match(/\b[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*/u)?.[0] ?? '';
}

export const NewConversationModal: Component<NewConversationModalProps> = (props) => {
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const saved = props.initialIntent ? undefined : props.world?.scenarioCreations?.findLast(item => item.status === 'ready' || item.status === 'generating');
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
  let stopConsentWait: (() => void) | undefined;
  onCleanup(() => stopConsentWait?.());
  const [query, setQuery] = createSignal('');
  const [addingContact, setAddingContact] = createSignal(false);
  const [createdContacts, setCreatedContacts] = createSignal<Participant[]>([]);
  const contacts = createMemo(() => [...new Map([...(props.world?.participants ?? []), ...createdContacts()].map(person => [person.id, person])).values()]);
  const visibleContacts = createMemo(() => contacts().filter(person => person.displayName.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase())));
  const changeScope = (value: 'sandbox' | 'persistent'): void => {
    setScope(value);
    if (value === 'persistent') setSelectedIds(current => new Set([...current].filter(id => contacts().some(person => person.id === id && person.kind === 'persistent'))));
  };

  const isSelected = (participant: Participant): boolean => selectedIds().has(participant.id);

  const toggleParticipant = (participant: Participant): void => {
    if (busy() || (scope() === 'persistent' && participant.kind !== 'persistent')) return;
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
    stopConsentWait?.();
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
    const startedAt = performance.now();
    log.info('Tutor Start', { stage: 'action', selectedCount: ids.length, intentCharacters: text.length, resumingPreview: Boolean(preview()) });
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
      }, contacts().filter(person => scope() !== 'persistent' || person.kind === 'persistent'));
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
      log.info('Tutor Start', { stage: 'failed', elapsedMs: Math.round(performance.now() - startedAt), errorName: err instanceof Error ? err.name : 'unknown' });
      setError(err instanceof Error ? err.message : t('mlearn.ConversationAgent.NewConversation.Failed'));
    } finally {
      log.info('Tutor Start', { stage: 'ui-publication', elapsedMs: Math.round(performance.now() - startedAt), previewReady: Boolean(preview()) });
      setBusy(false);
    }
  };

  // Persistent scope is Living World state: start stays blocked until the
  // user consents. The consent action persists the setting, then proceeds.
  const enableLivingWorldAndStart = async (): Promise<void> => {
    if (busy()) return;
    setError(null);
    setBusy(true);
    const bridge = getBridge().settings;
    const stopSaved = bridge.onSettingsSaved(() => bridge.getSettings());
    const stopSettings = bridge.onSettings((persisted) => {
      if (!persisted.livingWorldEnabled) return;
      stopConsentWait?.();
      setBusy(false);
      void handleStart();
    });
    stopConsentWait = () => {
      stopSaved();
      stopSettings();
      stopConsentWait = undefined;
    };
    updateSettings({ livingWorldEnabled: true });
  };

  return (<>
    <ModalForm
      isOpen={!addingContact()}
      onClose={() => { void close(); }}
      title={t('mlearn.ConversationAgent.NewConversation.Title')}
      size="sm"
      showCloseButton={true}
      closeOnOverlay={!busy()}
      closeOnEscape={!busy()}
      onSubmit={handleStart}
      footer={
        <div class="new-conversation-actions">
          <Button variant="ghost" onClick={() => { void close(); }}>{t('mlearn.ConversationAgent.NewConversation.Cancel')}</Button>
          <Show when={preview()}>
            <Button variant="ghost" disabled={busy()} onClick={() => { void changeScenario().catch(err => setError(String(err))); }}>{t('mlearn.ConversationAgent.NewConversation.ChangeScenario')}</Button>
          </Show>
          <Button
            variant="primary"
            aria-label={t(preview() ? 'mlearn.ConversationAgent.NewConversation.UseScenario' : 'mlearn.ConversationAgent.NewConversation.StartAria')}
            onClick={handleStart}
            disabled={busy() || (!preview() && selectedIds().size === 0 && !intent().trim())
              || (!preview() && scope() === 'persistent' && !settings.livingWorldEnabled)}
          >
            {busy() ? t('mlearn.ConversationAgent.NewConversation.Starting') : t(preview() ? 'mlearn.ConversationAgent.NewConversation.UseScenario' : 'mlearn.ConversationAgent.NewConversation.Start')}
          </Button>
        </div>
      }
    >
      <div class="new-conversation-form">
        <Show when={props.mediaName}>
          <p class="new-conversation-media-context">{t('mlearn.ConversationAgent.NewConversation.MediaContext', { media: props.mediaName! })}</p>
        </Show>
        <Show when={!preview()}>
          <div class="new-conversation-people">
            <Input type="search" value={query()} onInput={event => setQuery(event.currentTarget.value)}
              leftIcon={<SearchIcon size={16} />} placeholder={t('mlearn.ConversationAgent.Contacts.Search')}
              aria-label={t('mlearn.ConversationAgent.Contacts.Search')} disabled={busy()} />
            <ListRow class="new-conversation-add" headline={t('mlearn.ConversationAgent.Contacts.Add')}
              leading={<PlusIcon size={20} />} onClick={() => setAddingContact(true)} disabled={busy()} />
            <div class="new-conversation-people-list" aria-label={t('mlearn.ConversationAgent.NewConversation.PeopleLabel')}>
              <For each={visibleContacts()}>{person => <ListRow
                class="new-conversation-person" leading={<Avatar name={person.displayName} src={person.profilePhoto} size="sm" />}
                headline={person.displayName} selected={isSelected(person)} aria-pressed={isSelected(person)}
                aria-label={t('mlearn.ConversationAgent.NewConversation.ToggleParticipant', { name: person.displayName })}
                description={scope() === 'persistent' && person.kind !== 'persistent' ? t('mlearn.ConversationAgent.Contacts.PracticeOnly') : undefined}
                disabled={busy() || (scope() === 'persistent' && person.kind !== 'persistent')}
                onClick={() => toggleParticipant(person)} />}</For>
              <Show when={visibleContacts().length === 0}><HintText>{t('mlearn.ConversationAgent.Contacts.EmptyContacts')}</HintText></Show>
            </div>
          </div>
          <fieldset class="new-conversation-scope">
            <legend class="new-conversation-scope-label">{t('mlearn.ConversationAgent.NewConversation.ScopeLabel')}</legend>
            <div class="new-conversation-scope-options" role="radiogroup" aria-label={t('mlearn.ConversationAgent.NewConversation.ScopeLabel')}>
              <RadioChoice name="conversation-scope" size="sm" class="new-conversation-scope-option" label={t('mlearn.ConversationAgent.NewConversation.ScopeTemporary')} checked={scope() === 'sandbox'} onChange={() => changeScope('sandbox')} disabled={busy()} />
              <RadioChoice name="conversation-scope" size="sm" class="new-conversation-scope-option" label={t('mlearn.ConversationAgent.NewConversation.ScopePersistent')} checked={scope() === 'persistent'} onChange={() => changeScope('persistent')} disabled={busy()} />
            </div>
            <Show when={scope() === 'persistent' && !settings.livingWorldEnabled}>
              <HintText>{t('mlearn.ConversationAgent.LivingWorld.ConsentHint')}</HintText>
              <Button variant="primary" disabled={busy()} onClick={() => { void enableLivingWorldAndStart(); }}>
                {t('mlearn.ConversationAgent.LivingWorld.EnableAndContinue')}
              </Button>
            </Show>
          </fieldset>
          <Disclosure title={t('mlearn.ConversationAgent.Contacts.OptionalGoal')} open={Boolean(props.initialIntent || saved?.request.intent)}>
          <FormField label={t(props.initialIntent || saved?.request.intent
            ? 'mlearn.ConversationAgent.NewConversation.PreparedGoalLabel'
            : 'mlearn.ConversationAgent.NewConversation.IntentLabel')}>
            <Textarea
              value={intent()}
              onInput={(event) => setIntent(event.currentTarget.value)}
              placeholder={t('mlearn.ConversationAgent.NewConversation.Placeholder')}
              rows={3}
            />
          </FormField>
          </Disclosure>
          <Show when={candidates().length > 0}>
            <div class="new-conversation-disambiguation">
              <span>{t('mlearn.ConversationAgent.NewConversation.DidYouMean')}</span>
              <div class="new-conversation-people-list">
                <For each={candidates()}>
                  {(participant) => (
                    <Button variant="ghost" class="new-conversation-person" onClick={() => toggleParticipant(participant)} disabled={busy()}>
                      {participant.displayName}
                    </Button>
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
                  const existing = reference.kind === 'existing' ? prepared.bindings.find(item => item.baseline.id === reference.participantId)?.baseline : undefined;
                  return <Disclosure title={profile?.name ?? existing?.displayName ?? ''}>
                    <p>{profile?.personaText ?? existing?.personaText}</p>
                    <Show when={profile}>
                      <HintText>{t('mlearn.ConversationAgent.NewConversation.PrivatePreview')}</HintText>
                      <For each={profile?.goals ?? []}>{goal => <p>{goal}</p>}</For>
                      <For each={profile?.initialKnowledge ?? []}>{fact => <p>{fact.text}</p>}</For>
                    </Show>
                  </Disclosure>;
                }}
              </For>
            </div>
          )}
        </Show>
        <Show when={error()}>
          <div class="new-conversation-error" role="alert">
            <p>{t(conversationRecoveryKey(error()))}</p>
            <Button variant="ghost" onClick={() => getBridge().window.openWindow({ type: 'settings', context: { section: 'ai' } })}>{t('mlearn.ConversationAgent.Recovery.Settings')}</Button>
            <Disclosure title={t('mlearn.Knowledge.Projection.Relations.Advanced')}><p>{error()}</p></Disclosure>
          </div>
        </Show>
      </div>
    </ModalForm>
    <Show when={addingContact()}><ParticipantEditorModal onClose={() => setAddingContact(false)} onCreate={async input => {
      const person = await getBridge().world.createParticipant(input);
      setCreatedContacts(current => [...current, person]);
      props.onContactCreated?.(person);
      if (scope() === 'persistent' && person.kind !== 'persistent') setScope('sandbox');
      setSelectedIds(current => new Set([...current, person.id]));
      setQuery(''); setAddingContact(false);
    }} /></Show>
  </>);
};
