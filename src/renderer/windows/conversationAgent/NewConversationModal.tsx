import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { Participant, WorldSnapshot } from '../../../shared/world';
import { resolveParticipant } from '../../services/participantConstruction';
import { Btn, FormField, HintText, ModalForm, Textarea } from '../../components/common';
import { useLocalization } from '../../context';
import './NewConversationModal.css';

interface NewConversationModalProps {
  world: WorldSnapshot | null;
  onCreated: (result: { roomId: string; threadId: string }) => void;
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
  const [selectedParticipant, setSelectedParticipant] = createSignal<Participant | null>(null);
  const [candidates, setCandidates] = createSignal<Participant[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const persistentParticipants = createMemo(() => (props.world?.participants ?? []).filter((participant) => participant.kind === 'persistent'));

  const createConversation = async (participant: Participant, title: string): Promise<void> => {
    const bridge = getBridge().world;
    const room = await bridge.createRoom(title);
    await bridge.applyMembership(room.id, participant.id, 'add');
    const thread = await bridge.createThread(room.id);
    props.onCreated({ roomId: room.id, threadId: thread.id });
  };

  const selectParticipant = (participant: Participant): void => {
    setSelectedParticipant(participant);
    setIntent(participant.displayName);
    setCandidates([]);
    setError(null);
  };

  const handleIntentInput = (value: string): void => {
    setIntent(value);
    setSelectedParticipant(null);
    setCandidates([]);
    setError(null);
  };

  const handleStart = async (): Promise<void> => {
    const text = intent().trim();
    const selected = selectedParticipant();
    if (busy() || (!selected && !text)) return;

    setBusy(true);
    setError(null);
    try {
      if (selected) {
        await createConversation(selected, selected.displayName);
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
        await createConversation(resolution.participant, resolution.participant.displayName);
        return;
      }

      const participant = await getBridge().world.createParticipant({
        displayName: temporaryParticipantName(text),
        kind: persistentParticipants().length === 0 ? 'persistent' : 'temporary',
        personaText: text,
      });
      await createConversation(participant, text.slice(0, 40));
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
          <Btn variant="primary" aria-label={t('mlearn.ConversationAgent.NewConversation.StartAria')} onClick={handleStart} disabled={busy() || (!selectedParticipant() && !intent().trim())}>
            {busy() ? t('mlearn.ConversationAgent.NewConversation.Starting') : t('mlearn.ConversationAgent.NewConversation.Start')}
          </Btn>
        </div>
      }
    >
      <div class="new-conversation-form">
        <HintText>{t('mlearn.ConversationAgent.NewConversation.Hint')}</HintText>
        <FormField label={t('mlearn.ConversationAgent.NewConversation.FieldLabel')}>
          <Textarea
            value={intent()}
            onInput={(event) => handleIntentInput(event.currentTarget.value)}
            placeholder={t('mlearn.ConversationAgent.NewConversation.Placeholder')}
            rows={5}
          />
        </FormField>
        <Show when={persistentParticipants().length > 0}>
          <fieldset class="new-conversation-people">
            <legend class="new-conversation-people-label">{t('mlearn.ConversationAgent.NewConversation.PeopleLabel')}</legend>
            <div class="new-conversation-people-list">
              <For each={persistentParticipants()}>
                {(participant) => (
                  <button
                    type="button"
                    class={`new-conversation-person ${selectedParticipant()?.id === participant.id ? 'new-conversation-person--selected' : ''}`}
                    aria-label={t('mlearn.ConversationAgent.NewConversation.TalkTo', { name: participant.displayName })}
                    aria-pressed={selectedParticipant()?.id === participant.id}
                    onClick={() => selectParticipant(participant)}
                    disabled={busy()}
                  >
                    <Show
                      when={participant.profilePhoto}
                      fallback={<span class="new-conversation-avatar">{participantInitial(participant)}</span>}
                    >
                      <img class="new-conversation-avatar" src={participant.profilePhoto} alt="" />
                    </Show>
                    <span>{participant.displayName}</span>
                  </button>
                )}
              </For>
            </div>
          </fieldset>
        </Show>
        <Show when={candidates().length > 0}>
          <div class="new-conversation-disambiguation">
            <span>{t('mlearn.ConversationAgent.NewConversation.DidYouMean')}</span>
            <div class="new-conversation-people-list">
              <For each={candidates()}>
                {(participant) => (
                  <button type="button" class="new-conversation-person" onClick={() => selectParticipant(participant)} disabled={busy()}>
                    {participant.displayName}
                  </button>
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
