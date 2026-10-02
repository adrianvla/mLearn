/**
 * Structured selection creates conversations through main-owned publication.
 * Temporary practice saves an independent sandbox; persistent scope publishes
 * a permanent Room through the same Director boundary. Intent stays separate
 * from the selected identities and prepares a Director proposal for review
 * before atomic activation.
 */

import { Component, For, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { classifyProviderFailure } from '../../services/providerFailure';
import { openCapabilitySettings } from '../../services/capabilityUnavailable';
import { threadContextId, type Participant, type WorldSnapshot, type ScenarioCreation } from '../../../shared/world';
import { resolveParticipant } from '../../services/participantConstruction';
import { Avatar, Button, Disclosure, FormField, HintText, Input, ListRow, ModalForm, PlusIcon, RadioChoice, SearchIcon, Textarea } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import './NewConversationModal.css';
import { ParticipantEditorModal } from './ParticipantEditorModal';
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
  mode?: 'message' | 'practice' | 'scenario';
  initialParticipantId?: string;
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
  const entryMode = props.mode ?? 'scenario';
  const saved = props.initialIntent || props.initialParticipantId ? undefined : props.world?.scenarioCreations?.findLast(item =>
    (item.status === 'ready' || item.status === 'generating')
    && (entryMode === 'practice' ? item.request.interactionMode === 'practice' : item.request.interactionMode !== 'practice'));
  const [intent, setIntent] = createSignal(props.initialIntent ?? saved?.request.intent ?? '');
  const [purpose, setPurpose] = createSignal<'conversation' | 'practice'>((saved?.request.interactionMode ?? entryMode) === 'practice' ? 'practice' : 'conversation');
  const mode = () => purpose() === 'practice' ? 'practice' : intent().trim() ? 'scenario' : 'message';
  const [scope, setScope] = createSignal<'sandbox' | 'persistent'>(saved ? saved.request.scope === 'persistent' ? 'persistent' : 'sandbox' : entryMode === 'message' ? 'persistent' : 'sandbox');
  const [selectedIds, setSelectedIds] = createSignal<ReadonlySet<string>>(new Set(props.initialParticipantId ? [props.initialParticipantId] : saved?.request.participantIds ?? []));
  const [preview, setPreview] = createSignal<ScenarioCreation | null>(saved?.status === 'ready' ? saved : null);
  const [candidates, setCandidates] = createSignal<Participant[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(saved?.error ?? null);
  // The raw text is kept for the technical-details disclosure; what the learner
  // reads and what they are offered come from the one failure owner, so this
  // modal cannot report a provider failure differently from any other surface.
  const failure = createMemo(() => (error() ? classifyProviderFailure(error(), settings.llmProvider) : null));
  let creationKey: string | undefined = saved ? JSON.stringify({ ids: saved.request.participantIds, intent: saved.request.intent?.trim() ?? '', scope: scope(), mode: mode() }) : undefined;
  let creationOperationId: string | undefined = saved?.operationId;
  let generation = 0;
  let stopConsentWait: (() => void) | undefined;
  onCleanup(() => stopConsentWait?.());
  const [query, setQuery] = createSignal('');
  const [addingContact, setAddingContact] = createSignal(false);
  const [createdContacts, setCreatedContacts] = createSignal<Participant[]>([]);
  const contacts = createMemo(() => [...new Map([...(props.world?.participants ?? []), ...createdContacts()].map(person => [person.id, person])).values()]
    .filter(person => !person.archivedAt));
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
    const trimmedIntent = mode() === 'message' ? '' : intent().trim();
    const persistent = scope() === 'persistent';
    const key = JSON.stringify({ ids, intent: trimmedIntent, scope: scope(), mode: mode() });
    if (key !== creationKey) { creationKey = key; creationOperationId = crypto.randomUUID(); }
    const request = { operationId: creationOperationId!, participantIds: ids,
      interactionMode: mode() === 'message' ? 'social' as const : mode() === 'practice' ? 'practice' as const : 'scenario' as const,
      ...(persistent ? { scope: 'persistent' as const } : {}),
      ...(trimmedIntent ? { intent: trimmedIntent } : {}) };
    if (trimmedIntent) {
      const current = ++generation;
      const prepared = await bridge.prepareScenario(request);
      if (current === generation) setPreview(prepared);
      return;
    }
    if (persistent) {
      if (ids.length === 1 && mode() === 'message') {
        const existing = props.world?.rooms.filter(room => room.participantIds.length === 1 && room.participantIds[0] === ids[0]
          && (room.interactionMode ?? 'social') === 'social')
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (existing) { await props.onCreated({ roomId: existing.id, threadId: null }); return; }
      }
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
    if (busy() || (!preview() && ids.length === 0 && (mode() === 'message' || !text))) return;
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
      size="md"
      showCloseButton={true}
      closeOnOverlay={!busy()}
      closeOnEscape={!busy()}
      onSubmit={handleStart}
      footer={
        <div class="new-conversation-actions">
          <p class="new-conversation-summary" aria-live="polite">
            {t(purpose() === 'practice' ? 'mlearn.ConversationAgent.NewConversation.CoachedPractice' : 'mlearn.ConversationAgent.NewConversation.Conversation')} · {t(scope() === 'persistent' ? 'mlearn.ConversationAgent.NewConversation.ScopePersistent' : 'mlearn.ConversationAgent.NewConversation.ScopeTemporary')}
            <Show when={selectedIds().size > 0}> · {t('mlearn.ConversationAgent.NewConversation.SelectedPeople', { count: String(selectedIds().size) })}</Show>
          </p>
          <Button variant="ghost" onClick={() => { void close(); }}>{t('mlearn.ConversationAgent.NewConversation.Cancel')}</Button>
          <Show when={preview()}>
            <Button variant="ghost" disabled={busy()} onClick={() => { void changeScenario().catch(err => setError(String(err))); }}>{t('mlearn.ConversationAgent.NewConversation.ChangeScenario')}</Button>
          </Show>
          <Button
            variant="primary"
            aria-label={t(preview() ? 'mlearn.ConversationAgent.NewConversation.UseScenario' : 'mlearn.ConversationAgent.NewConversation.StartAria')}
            onClick={handleStart}
            disabled={busy() || (!preview() && selectedIds().size === 0 && (mode() === 'message' || !intent().trim()))
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
          <fieldset class="new-conversation-purpose">
            <legend class="new-conversation-scope-label">{t('mlearn.ConversationAgent.NewConversation.Purpose')}</legend>
            <div class="new-conversation-scope-options" role="radiogroup" aria-label={t('mlearn.ConversationAgent.NewConversation.Purpose')}>
              <RadioChoice name="conversation-purpose" size="sm" label={t('mlearn.ConversationAgent.NewConversation.Conversation')} checked={purpose() === 'conversation'} onChange={() => setPurpose('conversation')} disabled={busy()} />
              <RadioChoice name="conversation-purpose" size="sm" label={t('mlearn.ConversationAgent.NewConversation.CoachedPractice')} checked={purpose() === 'practice'} onChange={() => setPurpose('practice')} disabled={busy()} />
            </div>
            <HintText>{t(purpose() === 'practice' ? 'mlearn.ConversationAgent.NewConversation.PracticeHint' : 'mlearn.ConversationAgent.NewConversation.ConversationHint')}</HintText>
          </fieldset>
          <fieldset class="new-conversation-scope">
            <legend class="new-conversation-scope-label">{t('mlearn.ConversationAgent.NewConversation.ScopeLabel')}</legend>
            <div class="new-conversation-scope-options" role="radiogroup" aria-label={t('mlearn.ConversationAgent.NewConversation.ScopeLabel')}>
              <RadioChoice name="conversation-scope" size="sm" class="new-conversation-scope-option" label={t('mlearn.ConversationAgent.NewConversation.ScopeTemporary')} checked={scope() === 'sandbox'} onChange={() => changeScope('sandbox')} disabled={busy()} />
              <RadioChoice name="conversation-scope" size="sm" class="new-conversation-scope-option" label={t('mlearn.ConversationAgent.NewConversation.ScopePersistent')} checked={scope() === 'persistent'} onChange={() => changeScope('persistent')} disabled={busy()} />
            </div>
            <HintText>{t(scope() === 'persistent' ? 'mlearn.ConversationAgent.NewConversation.PersistentHint' : 'mlearn.ConversationAgent.NewConversation.TemporaryHint')}</HintText>
          </fieldset>
          <div class="new-conversation-people">
            <div class="new-conversation-people-tools">
              <Input type="search" value={query()} onInput={event => setQuery(event.currentTarget.value)}
                leftIcon={<SearchIcon size={16} />} placeholder={t('mlearn.ConversationAgent.Contacts.Search')}
                aria-label={t('mlearn.ConversationAgent.Contacts.Search')} disabled={busy()} />
              <Button variant="ghost" size="sm" icon={<PlusIcon size={16} />} onClick={() => setAddingContact(true)} disabled={busy()}>{t('mlearn.ConversationAgent.Contacts.Add')}</Button>
            </div>
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
          <Disclosure title={t(purpose() === 'practice' ? 'mlearn.ConversationAgent.Contacts.OptionalGoal' : 'mlearn.ConversationAgent.NewConversation.OptionalSituation')} open={Boolean(props.initialIntent || saved?.request.intent || contacts().length === 0)}>
            <FormField label={t(purpose() === 'practice' ? 'mlearn.ConversationAgent.NewConversation.PreparedGoalLabel' : 'mlearn.ConversationAgent.NewConversation.Scene')}>
              <Textarea value={intent()} onInput={event => setIntent(event.currentTarget.value)}
                placeholder={t('mlearn.ConversationAgent.NewConversation.SetupPlaceholder')} rows={2} disabled={busy()} />
              <HintText>{t('mlearn.ConversationAgent.NewConversation.SetupHint')}</HintText>
            </FormField>
          </Disclosure>
          <Show when={scope() === 'persistent' && !settings.livingWorldEnabled}>
            <HintText>{t('mlearn.ConversationAgent.LivingWorld.ConsentHint')}</HintText>
            <Button variant="primary" disabled={busy() || (selectedIds().size === 0 && !intent().trim())} onClick={() => { void enableLivingWorldAndStart(); }}>
              {t('mlearn.ConversationAgent.LivingWorld.EnableAndContinue')}
            </Button>
          </Show>
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
        <Show when={failure()}>
          {(classified) => (
            <div class="new-conversation-error" role="alert">
              <p>{t(classified().key)}</p>
              {/* Settings is only offered when it can actually help. A
                  connection that is down, an exhausted quota or a cancelled
                  sign-in is not repaired by a setting, and sending the learner
                  there to find nothing is worse than not offering it. */}
              <Show when={classified().recovery === 'settings'}>
                <Button variant="ghost" onClick={() => openCapabilitySettings('llm')}>{t('mlearn.ConversationAgent.Recovery.Settings')}</Button>
              </Show>
              <Disclosure title={t('mlearn.Knowledge.Projection.Relations.Advanced')}><p>{error()}</p></Disclosure>
            </div>
          )}
        </Show>
      </div>
    </ModalForm>
    <Show when={addingContact()}><ParticipantEditorModal storyTracks={props.world?.storyTracks} persistentOnly={scope() === 'persistent'} onClose={() => setAddingContact(false)} onCreate={async input => {
      const person = await getBridge().world.createParticipant(input);
      if (scope() === 'persistent' && person.kind !== 'persistent') throw new Error('A persistent contact is required for this conversation');
      setCreatedContacts(current => [...current, person]);
      props.onContactCreated?.(person);
      setSelectedIds(current => new Set([...current, person.id]));
      setQuery(''); setAddingContact(false);
    }} /></Show>
  </>);
};
