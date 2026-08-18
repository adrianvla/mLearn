import { Component, For, Show, createSignal } from 'solid-js';
import type { ConversationAgentContext } from '../../../shared/types';
import type { Participant, Thread } from '../../../shared/world';
import { Btn, FormField, Input, Textarea } from '../../components/common';
import { MediaStatsTab } from './MediaStatsTab';
import './ThreadInfoPanel.css';

interface ThreadInfoPanelProps {
  thread: Thread | null;
  context: ConversationAgentContext | null;
  participants: Participant[];
  onUpdateParticipant: (participant: Participant) => Promise<void> | void;
  onDeleteThread: () => Promise<void> | void;
}

export const ThreadInfoPanel: Component<ThreadInfoPanelProps> = (props) => {
  const [editingParticipantId, setEditingParticipantId] = createSignal<string | null>(null);
  const [displayName, setDisplayName] = createSignal('');
  const [personaText, setPersonaText] = createSignal('');
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const mediaRef = () => props.thread?.mediaRef;
  const mediaKey = () => mediaRef()?.mediaHash ?? props.context?.mediaHash ?? null;
  const statsContext = () => {
    const media = mediaRef();
    const context = props.context;
    return media && context ? { ...context, ...media } : context;
  };
  const startEditing = (participant: Participant): void => {
    setEditingParticipantId(participant.id);
    setDisplayName(participant.displayName);
    setPersonaText(participant.personaText);
  };
  const saveParticipant = async (participant: Participant): Promise<void> => {
    await props.onUpdateParticipant({ ...participant, displayName: displayName().trim(), personaText: personaText() });
    setEditingParticipantId(null);
  };

  return (
    <div class="ca-thread-info">
      <div class="ca-thread-info-heading">
        <span class="ca-thread-info-label">Thread</span>
        <span class="ca-thread-info-title">{props.thread?.title || 'Untitled thread'}</span>
      </div>
      <Show when={mediaRef()}>
        {(media) => (
          <div class="ca-thread-media-card">
            <span class="ca-thread-media-name">{media().mediaName}</span>
            <span class="ca-thread-media-meta">
              {media().mediaType}{media().assessedLevelName ? ` · ${media().assessedLevelName}` : ''}
            </span>
          </div>
        )}
      </Show>
      <Show when={mediaKey()} keyed fallback={<MediaStatsTab context={statsContext()} />}>
        <MediaStatsTab context={statsContext()} />
      </Show>
      <section class="ca-thread-participants">
        <span class="ca-thread-info-label">Participants</span>
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
                    <span class="ca-thread-participant-kind">{participant.kind}</span>
                  </div>
                  <Btn variant="ghost" size="sm" onClick={() => startEditing(participant)}>Edit</Btn>
                </div>
                <Show when={editingParticipantId() === participant.id} fallback={<p class="ca-thread-participant-persona">{participant.personaText.slice(0, 120)}</p>}>
                  <div class="ca-thread-participant-form">
                    <FormField label="Name">
                      <Input value={displayName()} onInput={(event) => setDisplayName(event.currentTarget.value)} />
                    </FormField>
                    <FormField label="Persona">
                      <Textarea value={personaText()} onInput={(event) => setPersonaText(event.currentTarget.value)} rows={4} />
                    </FormField>
                    <div class="ca-thread-participant-actions">
                      <Btn variant="ghost" size="sm" onClick={() => setEditingParticipantId(null)}>Cancel</Btn>
                      <Btn variant="primary" size="sm" onClick={() => { void saveParticipant(participant); }}>Save</Btn>
                    </div>
                  </div>
                </Show>
              </article>
            )}
          </For>
        </div>
      </section>
      <Show when={props.thread}>
        <section class="ca-thread-actions">
          <span class="ca-thread-info-label">Thread</span>
          <Show
            when={confirmingDelete()}
            fallback={<Btn variant="danger" onClick={() => setConfirmingDelete(true)}>Delete thread</Btn>}
          >
            <div class="ca-thread-delete-confirm">
              <span>Delete thread?</span>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>Cancel</Btn>
              <Btn variant="danger" size="sm" onClick={() => { void props.onDeleteThread(); }}>Confirm delete</Btn>
            </div>
          </Show>
        </section>
      </Show>
    </div>
  );
};
