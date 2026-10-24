import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Conversation, ConversationGeneration, ConversationMessage } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { messageAnchor } from './messageFlow';
import { ActionFeedback } from './MessengerDialogs';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { SourceActions } from '../explanation';

type Actions = {
  readonly client: RuntimeClient; readonly busy: boolean; readonly error: string; readonly origin: string;
  readonly retry: { readonly origin: string; readonly run: () => Promise<void> } | null;
  readonly act: (action: { readonly origin: string; readonly run: () => Promise<void> }) => Promise<void>;
  readonly refreshCurrent: () => Promise<void>;
};
export function MessageActions({ actions, message, conversation, packageVersion, onReply, onTrace }: {
  readonly actions: Actions; readonly message: ConversationMessage; readonly conversation: Conversation;
  readonly packageVersion: string | null;
  readonly onReply: () => void; readonly onTrace: () => void;
}) {
  const host = useRuntime();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const [feedback, setFeedback] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const origin = `message:${message.id}`;
  const mutable = !['pending', 'partial', 'deleted'].includes(message.status);
  function edit(remove: boolean) {
    const command = remove ? actions.client.prepareConversationMessageDelete(message)
      : actions.client.prepareConversationMessageEdit(message, text);
    void actions.act({ origin, run: async () => {
      await actions.client.changeConversationMessage(command);
      if (alive.current) { setFeedback(remove ? 'Message deleted.' : 'Message updated.'); setEditing(false); }
      await actions.refreshCurrent();
    } });
  }
  function retryGeneration() {
    const generationId = message.generationId;
    if (!generationId) return;
    let retry: ReturnType<RuntimeClient['prepareConversationRetry']> | null = null;
    let previous: ConversationGeneration | null = null;
    void actions.act({ origin, run: async () => {
      if (!retry) {
        const [generation, current] = await Promise.all([
          actions.client.conversationGeneration(generationId), actions.client.conversation(conversation.id),
        ]);
        previous = generation;
        retry = actions.client.prepareConversationRetry(generation, current);
      }
      if (!previous) return;
      await actions.client.retryConversationGeneration(retry, previous);
      await actions.refreshCurrent();
    } });
  }
  const source = packageVersion && message.status === 'complete' && message.text
    ? messageAnchor(message, conversation.packageId, packageVersion, { start: 0, end: new TextEncoder().encode(message.text).length })
    : null;
  return <View>
    <Dialog open={open} onOpenChange={value => { if (!actions.busy) setOpen(value); }}
      title={message.role === 'user' ? 'Your message' : 'Message'}
      description={`Message ${message.sequence} · ${message.status}`}
      trigger={<Button label="Message actions" icon="more" iconOnly variant="quiet" size="compact" disabled={actions.busy} />}>
      <Text selectable>{message.text || message.status}</Text>
      <Row>
        <Button label="Reply" variant="secondary" disabled={actions.busy || message.status === 'deleted'}
          onPress={() => { onReply(); setOpen(false); }} />
        {mutable ? <><Button label="Edit message" variant="secondary" disabled={actions.busy} onPress={() => setEditing(true)} />
          <Button label="Delete message" variant="quiet" disabled={actions.busy} onPress={() => edit(true)} /></> : null}
        <Button label="Copy message" variant="quiet" disabled={actions.busy} onPress={() => {
          void actions.act({ origin, run: async () => {
            if (!host.available) throw new Error(host.reason);
            await host.copyText(message.text);
            if (alive.current) setFeedback('Copied.');
          } });
        }} />
      </Row>
      {editing ? <>
        <TextField label="Message text" value={text} onChangeText={setText} multiline editable={!actions.busy} maxLength={8192} />
        <Row><Button label="Save message" disabled={actions.busy || !text.trim()} onPress={() => edit(false)} />
          <Button label="Cancel edit" variant="quiet" disabled={actions.busy} onPress={() => { setEditing(false); setText(message.text); }} /></Row>
      </> : null}
      {message.generationId ? <Button label="Inspect execution" variant="secondary" onPress={() => { onTrace(); setOpen(false); }} /> : null}
      {message.generationId && ['failed', 'cancelled', 'interrupted'].includes(message.status)
        ? <Button label="Retry response" disabled={actions.busy} onPress={retryGeneration} /> : null}
      {source ? <SourceActions client={actions.client} source={source} />
        : message.status === 'complete' ? <Text muted variant="caption">Message analysis must be available before contextual feedback.</Text> : null}
      <ActionFeedback actions={actions} origin={origin} />
      {feedback ? <><Text variant="caption" muted>Action feedback · not learner evidence</Text><Text selectable>{feedback}</Text></> : null}
    </Dialog>
    {!open ? <ActionFeedback actions={actions} origin={origin} /> : null}
  </View>;
}
