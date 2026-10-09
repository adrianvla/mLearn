/**
 * Conversation Details — answers "what is this thread, who is in it, and what
 * context governs it" from the canonical world model (Thread / Room roster /
 * Participants). Media analysis is a collapsed secondary section tied to the
 * thread's own mediaRef; global learning stats live in Statistics, not here.
 */

import { Component, For, Show, createSignal } from 'solid-js';
import type { StoryFollowMode, UpdateStoryBranchInput } from '../../../shared/story';
import type { ConversationAgentContext } from '../../../shared/types';
import type { ThreadMediaRef, AutonomyJobRecord, ContactRecord, Participant, Thread, ScenarioSpec, ReflectionRunRecord } from '../../../shared/world';
import { Avatar, Button, Disclosure, FormField, Input, Select, Tag, Textarea } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import { ParticipantEditorModal } from './ParticipantEditorModal';
import './ThreadInfoPanel.css';

interface ThreadInfoPanelProps {
  generationAvailable?: boolean;
  onRequestGenerationAccess?: () => boolean;
  roomTitle?: string;
  roomId?: string;
  roomScenario?: ScenarioSpec;
  thread: Thread | null;
  context: ConversationAgentContext | null;
  roomMediaRef?: ThreadMediaRef;
  mediaReferences?: ThreadMediaRef[];
  mediaReferenceSaving?: boolean;
  mediaReferenceError?: string;
  onChangeMediaReference?: (reference?: ThreadMediaRef) => Promise<void>;
  participants: Participant[];
  availableParticipants?: Participant[];
  membershipDisabled?: boolean;
  onChangeMembership?: (participantId: string, kind: 'add' | 'remove') => Promise<void>;
  /** Durable reflection/evolution runs for this context; visible in Details. */
  reflectionRuns?: ReflectionRunRecord[];
  autonomyJobs?: AutonomyJobRecord[];
  autonomyEnabled?: boolean;
  contacts?: Omit<ContactRecord, 'prepared'>[];
  contactEnabled?: boolean;
  roomContactMuted?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  onRenameThread: (title: string) => Promise<void> | void;
  onUpdateParticipant: (participant: Participant) => Promise<void> | void;
  onDeleteThread: () => Promise<void> | void;
  onIntegrate?: () => void | Promise<void>;
  onUpdateStoryBranch?: (input: UpdateStoryBranchInput) => Promise<void>;
  onRetryMaintenance?: (reflectionId: string) => Promise<void> | void;
  onSetAutonomyEnabled?: (enabled: boolean) => Promise<void> | void;
  onSetContactEnabled?: (enabled: boolean) => Promise<void> | void;
  onSetRoomContactMuted?: (muted: boolean) => Promise<void> | void;
  onSetQuietHours?: (value: { enabled?: boolean; start?: string; end?: string }) => Promise<void> | void;
  onSetParticipantMuted?: (participantId: string, muted: boolean) => Promise<void> | void;
  onSetParticipantCallsAllowed?: (participantId: string, allowed: boolean) => Promise<void> | void;
  mutedParticipantIds?: string[];
  callMutedParticipantIds?: string[];
}

export const ThreadInfoPanel: Component<ThreadInfoPanelProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const [renaming, setRenaming] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal('');
  const [editingParticipant, setEditingParticipant] = createSignal<Participant | null>(null);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [retryingRunId, setRetryingRunId] = createSignal<string | null>(null);
  const [storyMode, setStoryMode] = createSignal<StoryFollowMode>(props.thread?.storyBranch?.mode ?? 'follow');
  const [adaptations, setAdaptations] = createSignal((props.thread?.storyBranch?.adaptations ?? []).join('\n'));
  const [storySaving, setStorySaving] = createSignal(false);
  const [storyError, setStoryError] = createSignal('');
  const [addingPerson, setAddingPerson] = createSignal(false);
  const [personQuery, setPersonQuery] = createSignal('');
  const [removingPerson, setRemovingPerson] = createSignal<Participant | null>(null);
  const [membershipBusy, setMembershipBusy] = createSignal(false);
  const [membershipError, setMembershipError] = createSignal('');
  const eligiblePeople = () => (props.availableParticipants ?? []).filter(person => !person.archivedAt
    && !props.participants.some(current => current.id === person.id)
    && (props.thread?.sandbox || person.kind === 'persistent')
    && person.displayName.toLocaleLowerCase().includes(personQuery().trim().toLocaleLowerCase()));
  const changeMembership = async (person: Participant, kind: 'add' | 'remove'): Promise<void> => {
    if (!props.onChangeMembership || props.membershipDisabled || membershipBusy()) return;
    if (kind === 'remove' && (props.participants.length <= 1 || !props.participants.some(current => current.id === person.id))) {
      setMembershipError(t('mlearn.ConversationAgent.Details.RosterChanged')); return;
    }
    setMembershipBusy(true); setMembershipError('');
    try {
      await props.onChangeMembership(person.id, kind);
      setAddingPerson(false); setPersonQuery(''); setRemovingPerson(null);
    } catch (error) { setMembershipError(error instanceof Error ? error.message : String(error)); }
    finally { setMembershipBusy(false); }
  };
  const saveStoryBranch = async (): Promise<void> => {
    if (!props.thread || !props.onUpdateStoryBranch || storySaving()) return;
    setStorySaving(true); setStoryError('');
    try { await props.onUpdateStoryBranch({ threadId: props.thread.id,
      expectedRevision: props.thread.storyBranch?.revision ?? 0, mode: storyMode(),
      adaptations: adaptations().split('\n').map(value => value.trim()).filter(Boolean) }); }
    catch (failure) { setStoryError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setStorySaving(false); }
  };
  const mediaRef = () => props.thread ? props.thread.mediaRef : props.roomMediaRef;
  // Maintenance runs for THIS context: a sandbox Thread has its own journal;
  // Room turns use the Room's Sea stream (including world continuity for the
  // integration trigger). Only pending/failed runs surface here — committed
  // runs are normal operation, not status the user must act on.
  const contextRuns = () => (props.reflectionRuns ?? []).filter(run => {
    const contextId = props.thread?.sandbox ? props.thread.id : props.roomId;
    return run.contextId === contextId
      && (run.status === 'pending' || (run.status === 'failed' && run.retryConsumedAt === undefined));
  });
  const roomAutonomyJobs = () => props.thread?.sandbox || !props.roomId
    ? []
    : (props.autonomyJobs ?? []).filter(job => job.roomId === props.roomId).slice(-3).reverse();
  const roomContacts = () => props.thread?.sandbox || !props.roomId
    ? []
    : (props.contacts ?? []).filter(contact => contact.roomId === props.roomId).slice(-3).reverse();

  const autonomyStatus = (job: AutonomyJobRecord): string => {
    switch (job.status) {
      case 'pending': return t('mlearn.ConversationAgent.Details.AutonomyRunning');
      case 'blocked': return t('mlearn.ConversationAgent.Details.AutonomyBlocked');
      case 'failed': return t('mlearn.ConversationAgent.Details.AutonomyFailed');
      case 'committed': return job.result === 'episode'
        ? t('mlearn.ConversationAgent.Details.AutonomyDeveloped')
        : t('mlearn.ConversationAgent.Details.AutonomyIntention');
      case 'cancelled': return t('mlearn.ConversationAgent.Details.AutonomyCancelled');
      default: return t('mlearn.ConversationAgent.Details.AutonomyWaited');
    }
  };

  const retryMaintenance = async (reflectionId: string): Promise<void> => {
    if (!props.onRetryMaintenance) return;
    setRetryingRunId(reflectionId);
    try {
      await props.onRetryMaintenance(reflectionId);
    } finally {
      setRetryingRunId(null);
    }
  };

  const statusLabel = (run: ReflectionRunRecord): string => run.status === 'pending'
    ? t('mlearn.ConversationAgent.Details.WorldActivityPending')
    : t('mlearn.ConversationAgent.Details.WorldActivityFailed');

  const kindLabel = (participant: Participant): string => props.thread?.sandbox
    ? t('mlearn.ConversationAgent.Details.PracticeVersion')
    : participant.kind === 'persistent'
    ? t('mlearn.ConversationAgent.Details.Kind.Persistent')
    : t('mlearn.ConversationAgent.Details.Kind.Temporary');

  const startRename = (): void => {
    setTitleDraft(props.thread?.title ?? '');
    setRenaming(true);
  };

  const commitRename = async (): Promise<void> => {
    await props.onRenameThread(titleDraft().trim());
    setRenaming(false);
  };

  const saveParticipant = async (participant: Participant): Promise<void> => {
    if (props.membershipDisabled || membershipBusy()) throw new Error(t('mlearn.ConversationAgent.Details.PeopleBusyHint'));
    await props.onUpdateParticipant(participant);
    setEditingParticipant(null);
  };

  return (
    <div class="ca-thread-info">
      <section class="ca-thread-section">
        <span class="ca-thread-info-label">{t(props.thread ? 'mlearn.ConversationAgent.Details.ThreadLabel' : 'mlearn.ConversationAgent.Details.RoomLabel')}</span>
        <Show
          when={renaming()}
          fallback={
            <div class="ca-thread-title-row">
              <span class="ca-thread-info-title">{props.thread?.title || props.roomTitle || props.participants.map(person => person.displayName).join(', ') || t('mlearn.ConversationAgent.Details.UntitledThread')}</span>
              <Show when={props.thread}>
                <Button variant="ghost" size="sm" onClick={startRename}>{t('mlearn.ConversationAgent.Details.Rename')}</Button>
              </Show>
            </div>
          }
        >
          <div class="ca-thread-rename">
            <FormField label={t('mlearn.ConversationAgent.Details.NameLabel')}>
              <Input value={titleDraft()} onInput={(event) => setTitleDraft(event.currentTarget.value)} />
            </FormField>
            <div class="ca-thread-rename-actions">
              <Button variant="ghost" size="sm" onClick={() => setRenaming(false)}>{t('mlearn.ConversationAgent.Details.Cancel')}</Button>
              <Button variant="primary" size="sm" onClick={() => { void commitRename(); }}>{t('mlearn.ConversationAgent.Details.Save')}</Button>
            </div>
          </div>
        </Show>
        <p class="ca-thread-scope-hint">{t(props.thread?.sandbox
          ? 'mlearn.ConversationAgent.NewConversation.TemporaryHint' : 'mlearn.ConversationAgent.Details.SharedHistoryHint')}</p>
      </section>

      <section class="ca-thread-section">
        <div class="ca-thread-title-row">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.ParticipantsLabel')}</span>
          <Show when={props.onChangeMembership}><Button variant="secondary" size="sm"
            disabled={props.membershipDisabled || membershipBusy()}
            onClick={() => { setAddingPerson(!addingPerson()); setMembershipError(''); }}>
            {t(addingPerson() ? 'mlearn.ConversationAgent.Details.Cancel' : 'mlearn.ConversationAgent.Details.AddPerson')}
          </Button></Show>
        </div>
        <Show when={props.onChangeMembership}>
          <p class="ca-thread-scope-hint">{t(props.thread?.sandbox
            ? 'mlearn.ConversationAgent.Details.SeparatePeopleHint' : 'mlearn.ConversationAgent.Details.SharedPeopleHint')}</p>
          <Show when={props.membershipDisabled}><p class="ca-thread-scope-hint">{t('mlearn.ConversationAgent.Details.PeopleBusyHint')}</p></Show>
          <Show when={membershipError()}><p role="alert" class="ca-thread-world-run-error">{membershipError()}</p></Show>
          <Show when={addingPerson()}>
            <div class="ca-thread-people-picker">
              <FormField label={t('mlearn.ConversationAgent.Contacts.Search')}>
                <Input value={personQuery()} onInput={event => setPersonQuery(event.currentTarget.value)} />
              </FormField>
              <For each={eligiblePeople()} fallback={<p class="ca-thread-scope-hint">{t('mlearn.ConversationAgent.Details.NoPeopleToAdd')}</p>}>
                {person => <div class="ca-thread-title-row"><span>{person.displayName}</span><Button size="sm"
                  disabled={props.membershipDisabled || membershipBusy()}
                  aria-label={t('mlearn.ConversationAgent.Details.AddNamedPerson', { name: person.displayName })}
                  onClick={() => { void changeMembership(person, 'add'); }}>{t('mlearn.ConversationAgent.Details.AddPerson')}</Button></div>}
              </For>
            </div>
          </Show>
        </Show>
        <div class="ca-thread-participant-list">
          <For each={props.participants}>
            {(participant) => (
              <article class="ca-thread-participant-card">
                <div class="ca-thread-participant-header">
                  <Avatar name={participant.displayName} src={participant.profilePhoto} />
                  <div class="ca-thread-participant-identity">
                    <span class="ca-thread-participant-name">{participant.displayName}</span>
                    <Tag class="ca-thread-participant-kind" headless size="sm">{kindLabel(participant)}</Tag>
                  </div>
                  <div class="ca-thread-participant-actions">
                    <Button variant="ghost" size="sm" disabled={props.membershipDisabled || membershipBusy()}
                      onClick={() => setEditingParticipant(participant)}>{t(props.thread?.sandbox
                        ? 'mlearn.ConversationAgent.Details.EditHere' : 'mlearn.ConversationAgent.Details.EditContact')}</Button>
                    <Show when={props.onChangeMembership}><Button variant="ghost" size="sm"
                      disabled={props.membershipDisabled || membershipBusy() || props.participants.length <= 1}
                      aria-label={t('mlearn.ConversationAgent.Details.RemoveNamedPerson', { name: participant.displayName })}
                      onClick={() => { setRemovingPerson(participant); setMembershipError(''); }}>
                      {t('mlearn.ConversationAgent.Details.RemovePerson')}
                    </Button></Show>
                  </div>
                </div>
                <Show when={settings.devMode && participant.personaText.trim()}>
                  <Disclosure title={t('mlearn.ConversationAgent.Contacts.About')}><p class="ca-thread-participant-persona">{participant.personaText}</p></Disclosure>
                </Show>
                <Show when={!props.thread?.sandbox && props.onSetParticipantMuted}>
                  <div class="ca-contact-controls">
                    <Button variant="ghost" size="sm" onClick={() => { void props.onSetParticipantMuted?.(participant.id, !(props.mutedParticipantIds ?? []).includes(participant.id)); }}>
                      {t((props.mutedParticipantIds ?? []).includes(participant.id)
                        ? 'mlearn.ConversationAgent.Details.UnmutePersonContact'
                        : 'mlearn.ConversationAgent.Details.MutePersonContact')}
                    </Button>
                    <Show when={props.onSetParticipantCallsAllowed}>
                      <Button variant="ghost" size="sm" onClick={() => { void props.onSetParticipantCallsAllowed?.(participant.id, (props.callMutedParticipantIds ?? []).includes(participant.id)); }}>
                        {t((props.callMutedParticipantIds ?? []).includes(participant.id)
                          ? 'mlearn.ConversationAgent.Details.AllowCalls'
                          : 'mlearn.ConversationAgent.Details.MuteCalls')}
                      </Button>
                    </Show>
                  </div>
                </Show>
              </article>
            )}
          </For>
        </div>
        <Show when={removingPerson()} keyed>{person => <div class="ca-thread-people-confirm">
          <p>{t('mlearn.ConversationAgent.Details.RemovePersonHint', { name: person.displayName })}</p>
          <div class="ca-thread-rename-actions">
            <Button variant="ghost" size="sm" disabled={membershipBusy()} onClick={() => setRemovingPerson(null)}>{t('mlearn.ConversationAgent.Details.Cancel')}</Button>
            <Button variant="danger" size="sm" disabled={props.membershipDisabled || membershipBusy() || props.participants.length <= 1 || !props.participants.some(current => current.id === person.id)}
              onClick={() => { void changeMembership(person, 'remove'); }}>{t('mlearn.ConversationAgent.Details.RemovePerson')}</Button>
          </div>
        </div>}</Show>
      </section>

      <Show when={props.thread?.intent}>
        <section class="ca-thread-section">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.NewConversation.IntentLabel')}</span>
          <p>{props.thread?.intent}</p>
        </section>
      </Show>

      <Show when={props.thread?.sandbox && props.onUpdateStoryBranch}>
        <Disclosure title={t('mlearn.ConversationAgent.Story.Branch')}>
          <div class="ca-story-branch">
            <FormField label={t('mlearn.ConversationAgent.Story.BranchMode')}><Select value={storyMode()}
              onChange={event => setStoryMode(event.currentTarget.value as StoryFollowMode)}
              options={[{ value: 'follow', label: t('mlearn.ConversationAgent.Story.Follow') },
                { value: 'pinned', label: t('mlearn.ConversationAgent.Story.Pinned') },
                { value: 'independent', label: t('mlearn.ConversationAgent.Story.Independent') }]} /></FormField>
            <FormField label={t('mlearn.ConversationAgent.Story.AlternatePremises')}><Textarea rows={3} value={adaptations()}
              onInput={event => setAdaptations(event.currentTarget.value)} /></FormField>
            <Button size="sm" loading={storySaving()} onClick={() => { void saveStoryBranch(); }}>{t('mlearn.ConversationAgent.Details.Save')}</Button>
            <Show when={storyError()}><p role="alert" class="ca-thread-world-run-error">{storyError()}</p></Show>
          </div>
        </Disclosure>
      </Show>

      <Show when={settings.devMode && contextRuns().length > 0}>
        <section class="ca-thread-section">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.WorldActivity')}</span>
          <For each={contextRuns()}>
            {(run) => (
              <article class="ca-thread-world-run">
                <span class="ca-thread-world-run-status">{statusLabel(run)}</span>
                <Show when={run.error}><p class="ca-thread-world-run-error">{run.error}</p></Show>
                <Show when={run.status === 'failed' && props.onRetryMaintenance}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={retryingRunId() === run.reflectionId}
                    onClick={() => { void retryMaintenance(run.reflectionId); }}
                  >{t('mlearn.ConversationAgent.Details.RetryWorldActivity')}</Button>
                </Show>
              </article>
            )}
          </For>
        </section>
      </Show>

      <Show when={!props.thread?.sandbox}>
        <Disclosure title={t('mlearn.ConversationAgent.Contacts.Notifications')}>
        <section class="ca-thread-section">
          <div class="ca-thread-title-row">
            <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.Autonomy')}</span>
            <Show when={props.onSetAutonomyEnabled}>
              <Button variant="ghost" size="sm" onClick={() => { void props.onSetAutonomyEnabled?.(!(props.autonomyEnabled ?? true)); }}>
                {t((props.autonomyEnabled ?? true)
                  ? 'mlearn.ConversationAgent.Details.PauseAutonomy'
                  : 'mlearn.ConversationAgent.Details.ResumeAutonomy')}
              </Button>
            </Show>
          </div>
          <p>{t((props.autonomyEnabled ?? true)
            ? 'mlearn.ConversationAgent.Details.AutonomyWaiting'
            : 'mlearn.ConversationAgent.Details.AutonomyPaused')}</p>
          <For each={settings.devMode ? roomAutonomyJobs() : []}>
            {(job) => (
              <article class="ca-thread-world-run">
                <span class="ca-thread-world-run-status">{autonomyStatus(job)}</span>
                <Show when={job.reason && (job.status === 'blocked' || job.status === 'failed')}>
                  <p class="ca-thread-world-run-error">{job.reason}</p>
                </Show>
              </article>
            )}
          </For>
        </section>
        <section class="ca-thread-section">
          <div class="ca-thread-title-row">
            <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.Contact')}</span>
            <Show when={props.onSetContactEnabled}>
              <Button variant="ghost" size="sm" onClick={() => { void props.onSetContactEnabled?.(!(props.contactEnabled ?? true)); }}>
                {t((props.contactEnabled ?? true)
                  ? 'mlearn.ConversationAgent.Details.PauseContact'
                  : 'mlearn.ConversationAgent.Details.ResumeContact')}
              </Button>
            </Show>
          </div>
          <p>{t((props.contactEnabled ?? true)
            ? 'mlearn.ConversationAgent.Details.ContactEnabled'
            : 'mlearn.ConversationAgent.Details.ContactPaused')}</p>
          <Show when={props.roomId && props.onSetRoomContactMuted}>
            <Button variant="ghost" size="sm" onClick={() => { void props.onSetRoomContactMuted?.(!(props.roomContactMuted ?? false)); }}>
              {t((props.roomContactMuted ?? false)
                ? 'mlearn.ConversationAgent.Details.UnmuteRoomContact'
                : 'mlearn.ConversationAgent.Details.MuteRoomContact')}
            </Button>
          </Show>
          <Show when={props.onSetQuietHours}>
            <div class="ca-contact-controls">
              <Button variant="ghost" size="sm" onClick={() => { void props.onSetQuietHours?.({ enabled: !(props.quietHoursEnabled ?? false) }); }}>
                {t((props.quietHoursEnabled ?? false)
                  ? 'mlearn.ConversationAgent.Details.DisableQuietHours'
                  : 'mlearn.ConversationAgent.Details.EnableQuietHours')}
              </Button>
              <Show when={props.quietHoursEnabled}>
                <label>{t('mlearn.ConversationAgent.Details.QuietHoursStart')}
                  <Input type="time" value={props.quietHoursStart ?? ''} onInput={event => { void props.onSetQuietHours?.({ start: event.currentTarget.value }); }} />
                </label>
                <label>{t('mlearn.ConversationAgent.Details.QuietHoursEnd')}
                  <Input type="time" value={props.quietHoursEnd ?? ''} onInput={event => { void props.onSetQuietHours?.({ end: event.currentTarget.value }); }} />
                </label>
              </Show>
            </div>
          </Show>
          <For each={settings.devMode ? roomContacts() : []}>
            {(contact) => <article class="ca-thread-world-run">
              <span class="ca-thread-world-run-status">{t('mlearn.ConversationAgent.Details.ContactStatus', { status: contact.status })}</span>
            </article>}
          </For>
        </section>
        </Disclosure>
      </Show>
      <Show when={(props.thread ? props.thread.scenario : props.roomScenario)} keyed>
        {(scenario) => <Disclosure title={t('mlearn.ConversationAgent.NewConversation.Scene')}>
          <For each={scenario.scene.sharedFacts}>{fact => <p>{fact}</p>}</For>
          <For each={scenario.scene.socialConstraints}>{constraint => <p>{constraint}</p>}</For>
        </Disclosure>}
      </Show>

      <Show when={(props.thread || props.roomId) && props.onChangeMediaReference}>
        <section class="ca-thread-section">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.ContextLabel')}</span>
          <p>{t('mlearn.ConversationAgent.Details.MediaReferenceHint')}</p>
          <Select aria-label={t('mlearn.ConversationAgent.Details.ChangeMedia')} value={mediaRef()?.mediaHash ?? ''}
            disabled={props.mediaReferenceSaving}
            options={[{ value: '', label: t('mlearn.ConversationAgent.Details.NoMedia') },
              ...(props.mediaReferences ?? []).map(ref => ({ value: ref.mediaHash, label: `${ref.mediaName} · ${ref.mediaType} · ${ref.mediaHash.slice(0, 8)}` }))]}
            onChange={event => { const ref = props.mediaReferences?.find(item => item.mediaHash === event.currentTarget.value); void props.onChangeMediaReference?.(ref); }} />
          <Show when={mediaRef()}><Button variant="ghost" disabled={props.mediaReferenceSaving}
            onClick={() => void props.onChangeMediaReference?.()}>{t('mlearn.ConversationAgent.Details.RemoveMedia')}</Button></Show>
          <Show when={props.mediaReferenceError}><p role="alert">{props.mediaReferenceError}</p></Show>
        </section>
      </Show>
      <Show when={mediaRef()}>
        {(media) => (
          <section class="ca-thread-section">
            <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.ContextLabel')}</span>
            <div class="ca-thread-media-card">
              <span class="ca-thread-media-name">{media().mediaName}</span>
              <span>{t('mlearn.ConversationAgent.Details.MediaProvenance', { id: media().mediaHash })}</span>
              <Show when={media().learningContext?.language}><p>{media().learningContext!.language}</p></Show>
              <Show when={typeof media().sourceContext?.progress === 'number'}><p>{t('mlearn.ConversationAgent.Details.SourceProgress', { progress: String(media().sourceContext!.progress) })}</p></Show>
              <Show when={media().sourceContext}><p>{t('mlearn.ConversationAgent.Details.MediaSpoilerScope')}</p></Show>
              <span class="ca-thread-media-meta">
                {media().mediaType}{media().assessedLevelName ? ` · ${media().assessedLevelName}` : ''}
              </span>
            </div>
          </section>
        )}
      </Show>

      <Show when={props.thread?.sandbox && props.onIntegrate}>
        <Disclosure title={t('mlearn.ConversationAgent.Integration.Title')}>
        <section class="ca-thread-section ca-thread-actions">
          <p class="ca-thread-integration-hint">{t('mlearn.ConversationAgent.Integration.PanelHint')}</p>
          <Button variant="primary" onClick={() => { void props.onIntegrate?.(); }}>{t('mlearn.ConversationAgent.Integration.Open')}</Button>
        </section>
        </Disclosure>
      </Show>
      <Show when={props.thread}>
        <Disclosure title={t('mlearn.ConversationAgent.Details.DangerZone')}>
        <section class="ca-thread-section ca-thread-actions">
          <Show
            when={confirmingDelete()}
            fallback={<Button variant="danger" onClick={() => setConfirmingDelete(true)}>{t(props.thread?.sandbox
              ? 'mlearn.ConversationAgent.Details.DeleteConversation' : 'mlearn.ConversationAgent.Details.DeleteThread')}</Button>}
          >
            <div class="ca-thread-delete-confirm">
              <span>{t(props.thread?.sandbox ? 'mlearn.ConversationAgent.Details.DeleteConversationConfirm' : 'mlearn.ConversationAgent.Details.DeleteThreadConfirm')}</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>{t('mlearn.ConversationAgent.Details.Cancel')}</Button>
              <Button variant="danger" size="sm" onClick={() => { void props.onDeleteThread(); }}>{t('mlearn.ConversationAgent.Details.ConfirmDelete')}</Button>
            </div>
          </Show>
        </section>
        </Disclosure>
      </Show>

      <Show when={editingParticipant()} keyed>
        {(participant) => (
          <ParticipantEditorModal
            generationAvailable={props.generationAvailable}
            onRequestGenerationAccess={props.onRequestGenerationAccess}
            participant={participant}
            onSave={saveParticipant}
            onClose={() => setEditingParticipant(null)}
          />
        )}
      </Show>
    </div>
  );
};
