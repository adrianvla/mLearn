/**
 * New conversation — two separate concepts:
 *  1. Participants: structured selection over known persistent people/agents;
 *     selection stores participant IDs and they join the room roster through
 *     journaled membership events.
 *  2. Intent: optional free text handed to the room orchestrator as setup
 *     context. It never replaces or becomes a participant.
 *
 * With nobody selected, the legacy free-text resolution still applies
 * (existing identity → disambiguation → new partner described by the text) —
 * the only bootstrap path when no persistent participants exist yet.
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { Participant, WorldSnapshot } from '../../../shared/world';
import { resolveParticipant } from '../../services/participantConstruction';
import { Btn, FormField, HintText, ModalForm, Textarea } from '../../components/common';
import { useLocalization } from '../../context';
import './NewConversationModal.css';

export interface NewConversationResult {
  roomId: string;
  threadId: string;
  /** Optional user goal, passed to the orchestrator as setup context. */
  intent?: string;
}

interface NewConversationModalProps {
  world: WorldSnapshot | null;
  onCreated: (result: NewConversationResult) => void | Promise<void>;
  onClose: () => void;
}

export function firstCapitalizedWordSequence(text: string): string {
  return text.match(/\b[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*/u)?.[0] ?? '';
}

export function temporaryParticipantName(text: string): string {
  const match = text.match(/["“]([^"”]+)["”]|^talk to ([^,.]+)/i);
  return match?.[1]?.trim() || match?.[2]?.trim() || 'Partner';
}

function participantInitial(participant: Participant): string {
  return participant.displayName.trim().charAt(0).toUpperCase() || '?';
}

export const NewConversationModal: Component<NewConversationModalProps> = (props) => {
  const { t } = useLocalization();
  const [intent, setIntent] = createSignal('');
  const [selectedIds, setSelectedIds] = createSignal<ReadonlySet<string>>(new Set());
  const [candidates, setCandidates] = createSignal<Participant[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
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

  /**
   * Creates the room, journals membership for every selected ID, opens the
   * thread. `resolve` are participants to consult for the room title beyond
   * props.world — e.g. one created in this same submission, which the stale
   * snapshot cannot know about.
   */
  const startWithSelection = async (ids: string[], resolve: Participant[] = []): Promise<void> => {
    const bridge = getBridge().world;
    const known = [...(props.world?.participants ?? []), ...resolve];
    const selected = ids
      .map((id) => known.find((participant) => participant.id === id))
      .filter((participant): participant is Participant => participant !== undefined);
    const room = await bridge.createRoom(selected.map((participant) => participant.displayName).join(', '));
    for (const id of ids) {
      await bridge.applyMembership(room.id, id, 'add');
    }
    const thread = await bridge.createThread(room.id);
    const trimmedIntent = intent().trim();
    if (trimmedIntent) await bridge.updateThread({ ...thread, intent: trimmedIntent });
    await props.onCreated({ roomId: room.id, threadId: thread.id, ...(trimmedIntent ? { intent: trimmedIntent } : {}) });
  };

  const handleStart = async (): Promise<void> => {
    const ids = [...selectedIds()];
    const text = intent().trim();
    if (busy() || (ids.length === 0 && !text)) return;

    setBusy(true);
    setError(null);
    try {
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

      // No structured selection matched: the existing bootstrap path creates a
      // temporary conversation partner described by the text.
      const participant = await getBridge().world.createParticipant({
        displayName: temporaryParticipantName(text),
        kind: 'temporary',
        personaText: text,
      });
      await startWithSelection([participant.id], [participant]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mlearn.ConversationAgent.NewConversation.Failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalForm
      isOpen={true}
      onClose={props.onClose}
      title={t('mlearn.ConversationAgent.NewConversation.Title')}
      size="md"
      showCloseButton={true}
      closeOnOverlay={!busy()}
      closeOnEscape={!busy()}
      onSubmit={handleStart}
      footer={
        <div class="new-conversation-actions">
          <Btn variant="ghost" onClick={props.onClose} disabled={busy()}>{t('mlearn.ConversationAgent.NewConversation.Cancel')}</Btn>
          <Btn
            variant="primary"
            aria-label={t('mlearn.ConversationAgent.NewConversation.StartAria')}
            onClick={handleStart}
            disabled={busy() || (selectedIds().size === 0 && !intent().trim())}
          >
            {busy() ? t('mlearn.ConversationAgent.NewConversation.Starting') : t('mlearn.ConversationAgent.NewConversation.Start')}
          </Btn>
        </div>
      }
    >
      <div class="new-conversation-form">
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
          </fieldset>
        </Show>
        <FormField label={t('mlearn.ConversationAgent.NewConversation.IntentLabel')}>
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
        <Show when={error()}>
          <div class="new-conversation-error">{error()}</div>
        </Show>
      </div>
    </ModalForm>
  );
};
