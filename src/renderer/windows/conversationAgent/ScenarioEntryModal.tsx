/**
 * ScenarioEntryModal
 * "New scenario" flow — create a persistent Room plus a temporary participant
 * from a free-form description, then land directly in the conversation.
 */

import { Component, createSignal, Show } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { ModalForm, FormField, Textarea, Input, Btn, HintText } from '../../components/common';
import './ScenarioEntryModal.css';

interface ScenarioEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (result: { roomId: string; threadId: string }) => void;
}

export const ScenarioEntryModal: Component<ScenarioEntryModalProps> = (props) => {
  const [description, setDescription] = createSignal('');
  const [name, setName] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleSubmit = async (): Promise<void> => {
    const text = description().trim();
    if (!text || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const participant = await getBridge().world.createParticipant({
        displayName: name().trim() || 'Partner',
        kind: 'temporary',
        personaText: text,
      });
      const room = await getBridge().world.createRoom(text.slice(0, 50));
      await getBridge().world.applyMembership(room.id, participant.id, 'add');
      const thread = await getBridge().world.createThread(room.id);
      props.onCreated({ roomId: room.id, threadId: thread.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scenario');
      setBusy(false);
    }
  };

  return (
    <ModalForm
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="New scenario"
      size="md"
      showCloseButton={true}
      closeOnOverlay={!busy()}
      closeOnEscape={!busy()}
      onSubmit={handleSubmit}
      footer={
        <div class="scenario-entry-actions">
          <Btn variant="ghost" onClick={props.onClose} disabled={busy()}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} disabled={busy() || !description().trim()}>
            {busy() ? 'Creating…' : 'Start scenario'}
          </Btn>
        </div>
      }
    >
      <div class="scenario-entry-form">
        <HintText>Describe the scenario: who is present, the situation, and your objective.</HintText>
        <FormField label="Scenario">
          <Textarea
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="e.g. You are a barista in a busy Tokyo café. I am a customer ordering a matcha latte…"
            rows={5}
          />
        </FormField>
        <FormField label="Participant name (optional)">
          <Input
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="Partner"
          />
        </FormField>
        <Show when={error()}>
          <div class="scenario-entry-error">{error()}</div>
        </Show>
      </div>
    </ModalForm>
  );
};
