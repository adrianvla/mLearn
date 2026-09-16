/**
 * Conversation Details — answers "what is this thread, who is in it, and what
 * context governs it" from the canonical world model (Thread / Room roster /
 * Participants). Media analysis is a collapsed secondary section tied to the
 * thread's own mediaRef; global learning stats live in Statistics, not here.
 */

import { Component, For, Show, createSignal } from 'solid-js';
import type { ConversationAgentContext } from '../../../shared/types';
import type { Participant, Thread, ScenarioSpec, ReflectionRunRecord } from '../../../shared/world';
import { Btn, FormField, Input, Tag } from '../../components/common';
import { useLocalization } from '../../context';
import { ParticipantEditorModal } from './ParticipantEditorModal';
import './ThreadInfoPanel.css';

interface ThreadInfoPanelProps {
  roomTitle?: string;
  roomId?: string;
  roomScenario?: ScenarioSpec;
  thread: Thread | null;
  context: ConversationAgentContext | null;
  participants: Participant[];
  /** Durable reflection/evolution runs for this context; visible in Details. */
  reflectionRuns?: ReflectionRunRecord[];
  onRenameThread: (title: string) => Promise<void> | void;
  onUpdateParticipant: (participant: Participant) => Promise<void> | void;
  onDeleteThread: () => Promise<void> | void;
  onIntegrate?: () => void | Promise<void>;
}

export const ThreadInfoPanel: Component<ThreadInfoPanelProps> = (props) => {
  const { t } = useLocalization();
  const [renaming, setRenaming] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal('');
  const [editingParticipant, setEditingParticipant] = createSignal<Participant | null>(null);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const mediaRef = () => props.thread?.mediaRef;
  // Maintenance runs for THIS context: a sandbox Thread has its own journal;
  // Room turns use the Room's Sea stream (including world continuity for the
  // integration trigger). Only pending/failed runs surface here — committed
  // runs are normal operation, not status the user must act on.
  const contextRuns = () => (props.reflectionRuns ?? []).filter(run => {
    const contextId = props.thread?.sandbox ? props.thread.id : props.roomId;
    return run.contextId === contextId && (run.status === 'pending' || run.status === 'failed');
  });

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
    await props.onUpdateParticipant(participant);
    setEditingParticipant(null);
  };

  return (
    <div class="ca-thread-info">
      <Show when={props.thread?.sandbox}>
        <section class="ca-thread-section">{t('mlearn.ConversationAgent.NewConversation.TemporaryHint')}</section>
      </Show>
      <section class="ca-thread-section">
        <span class="ca-thread-info-label">{t(props.thread ? 'mlearn.ConversationAgent.Details.ThreadLabel' : 'mlearn.ConversationAgent.Details.RoomLabel')}</span>
        <Show
          when={renaming()}
          fallback={
            <div class="ca-thread-title-row">
              <span class="ca-thread-info-title">{props.thread ? props.thread.title || t('mlearn.ConversationAgent.Details.UntitledThread') : props.roomTitle}</span>
              <Show when={props.thread}>
                <Btn variant="ghost" size="sm" onClick={startRename}>{t('mlearn.ConversationAgent.Details.Rename')}</Btn>
              </Show>
            </div>
          }
        >
          <div class="ca-thread-rename">
            <FormField label={t('mlearn.ConversationAgent.Details.NameLabel')}>
              <Input value={titleDraft()} onInput={(event) => setTitleDraft(event.currentTarget.value)} />
            </FormField>
            <div class="ca-thread-rename-actions">
              <Btn variant="ghost" size="sm" onClick={() => setRenaming(false)}>{t('mlearn.ConversationAgent.Details.Cancel')}</Btn>
              <Btn variant="primary" size="sm" onClick={() => { void commitRename(); }}>{t('mlearn.ConversationAgent.Details.Save')}</Btn>
            </div>
          </div>
        </Show>
      </section>

      <Show when={props.thread?.intent}>
        <section class="ca-thread-section">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.NewConversation.IntentLabel')}</span>
          <p>{props.thread?.intent}</p>
        </section>
      </Show>

      <Show when={contextRuns().length > 0}>
        <section class="ca-thread-section">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.WorldActivity')}</span>
          <For each={contextRuns()}>
            {(run) => (
              <article class="ca-thread-world-run">
                <span class="ca-thread-world-run-status">{statusLabel(run)}</span>
                <Show when={run.error}><p class="ca-thread-world-run-error">{run.error}</p></Show>
              </article>
            )}
          </For>
        </section>
      </Show>

      <Show when={(props.thread ? props.thread.scenario : props.roomScenario)} keyed>
        {(scenario) => <section class="ca-thread-section">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.NewConversation.Scene')}</span>
          <For each={scenario.scene.sharedFacts}>{fact => <p>{fact}</p>}</For>
          <For each={scenario.scene.socialConstraints}>{constraint => <p>{constraint}</p>}</For>
        </section>}
      </Show>

      <Show when={mediaRef()}>
        {(media) => (
          <section class="ca-thread-section">
            <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.ContextLabel')}</span>
            <div class="ca-thread-media-card">
              <span class="ca-thread-media-name">{media().mediaName}</span>
              <span class="ca-thread-media-meta">
                {media().mediaType}{media().assessedLevelName ? ` · ${media().assessedLevelName}` : ''}
              </span>
            </div>
          </section>
        )}
      </Show>

      <section class="ca-thread-section">
        <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.ParticipantsLabel')}</span>
        <div class="ca-thread-participant-list">
          <For each={props.participants}>
            {(participant) => (
              <article class="ca-thread-participant-card">
                <div class="ca-thread-participant-header">
                  <Show when={participant.profilePhoto} fallback={<span class="ca-thread-participant-avatar">{participant.displayName.trim().charAt(0).toUpperCase() || '?'}</span>}>
                    <img class="ca-thread-participant-avatar" src={participant.profilePhoto} alt="" />
                  </Show>
                  <div class="ca-thread-participant-identity">
                    <span class="ca-thread-participant-name">{participant.displayName}</span>
                    <Tag class="ca-thread-participant-kind" headless size="sm">{kindLabel(participant)}</Tag>
                  </div>
                  <Btn variant="ghost" size="sm" onClick={() => setEditingParticipant(participant)}>{t('mlearn.ConversationAgent.Details.Edit')}</Btn>
                </div>
                <Show when={participant.personaText.trim()}>
                  <p class="ca-thread-participant-persona">{participant.personaText}</p>
                </Show>
              </article>
            )}
          </For>
        </div>
      </section>

      <Show when={props.thread?.sandbox && props.onIntegrate}>
        <section class="ca-thread-section ca-thread-actions">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Integration.Title')}</span>
          <p class="ca-thread-integration-hint">{t('mlearn.ConversationAgent.Integration.PanelHint')}</p>
          <Btn variant="primary" onClick={() => { void props.onIntegrate?.(); }}>{t('mlearn.ConversationAgent.Integration.Open')}</Btn>
        </section>
      </Show>
      <Show when={props.thread}>
        <section class="ca-thread-section ca-thread-actions">
          <span class="ca-thread-info-label">{t('mlearn.ConversationAgent.Details.DangerZone')}</span>
          <Show
            when={confirmingDelete()}
            fallback={<Btn variant="danger" onClick={() => setConfirmingDelete(true)}>{t('mlearn.ConversationAgent.Details.DeleteThread')}</Btn>}
          >
            <div class="ca-thread-delete-confirm">
              <span>{t('mlearn.ConversationAgent.Details.DeleteThreadConfirm')}</span>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>{t('mlearn.ConversationAgent.Details.Cancel')}</Btn>
              <Btn variant="danger" size="sm" onClick={() => { void props.onDeleteThread(); }}>{t('mlearn.ConversationAgent.Details.ConfirmDelete')}</Btn>
            </div>
          </Show>
        </section>
      </Show>

      <Show when={editingParticipant()} keyed>
        {(participant) => (
          <ParticipantEditorModal
            participant={participant}
            onSave={saveParticipant}
            onClose={() => setEditingParticipant(null)}
          />
        )}
      </Show>
    </div>
  );
};
