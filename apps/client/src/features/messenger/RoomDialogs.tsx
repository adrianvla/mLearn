import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { Contact, Conversation, ConversationMessage, ConversationWorld } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { failure, type Failure } from '../failure';

export function SceneDialog({ client, conversation }: { readonly client: RuntimeClient; readonly conversation: Conversation }) {
  const [open, setOpen] = useState(false);
  const [world, setWorld] = useState<ConversationWorld | null>(null);
  const [scenario, setScenario] = useState('');
  const [canon, setCanon] = useState<{ position: string; text: string }[]>([]);
  const [progress, setProgress] = useState('0');
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReturnType<RuntimeClient['prepareConversationWorld']> | null>(null);
  async function load() {
    setBusy(true); setError(null);
    try {
      const value = await client.conversationWorld(conversation.id);
      setWorld(value); setScenario(value.scenario); setProgress(String(value.progress));
      setCanon(value.canon.map(entry => ({ position: String(entry.position), text: entry.text })));
    } catch (cause) { setError(failure(cause, 'The scene couldn’t be loaded.')); }
    finally { setBusy(false); }
  }
  const numbers = canon.every(entry => /^\d{1,6}$/.test(entry.position)) && /^\d{1,6}$/.test(progress);
  async function save() {
    if (!world || !numbers) return;
    const command = pending ?? client.prepareConversationWorld({ ...world, scenario, progress: Number(progress),
      canon: canon.filter(entry => entry.text.trim()).map(entry => ({ position: Number(entry.position), text: entry.text.trim() })) });
    setPending(command); setBusy(true); setError(null);
    try { setWorld(await client.saveConversationWorld(command)); setPending(null); }
    catch (cause) { setError(failure(cause, 'The scene wasn’t saved.')); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (busy) return; setOpen(value); setPending(null); if (value) void load(); }}
    title="Scene and canon" trigger={<Button label="Scene and canon" variant="quiet" size="compact" />}>
    <TextField label="Scene" placeholder="Where this happens and what people want" value={scenario} onChangeText={setScenario}
      multiline maxLength={2048} editable={!busy && !pending} />
    <Text variant="caption">Source canon</Text>
    {canon.map((entry, index) => <Row key={index}>
      <View style={styles.position}><TextField label={`Canon ${index + 1} point`} value={entry.position} keyboardType="number-pad"
        onChangeText={value => setCanon(previous => previous.map((item, at) => at === index ? { ...item, position: value } : item))}
        maxLength={6} editable={!busy && !pending} /></View>
      <View style={styles.grow}><TextField label={`Canon ${index + 1}`} value={entry.text} maxLength={600} editable={!busy && !pending}
        onChangeText={value => setCanon(previous => previous.map((item, at) => at === index ? { ...item, text: value } : item))} /></View>
      <Button label="Remove" accessibilityLabel={`Remove canon ${index + 1}`} variant="quiet" size="compact" disabled={busy || Boolean(pending)}
        onPress={() => setCanon(previous => previous.filter((_, at) => at !== index))} />
    </Row>)}
    <Button label="Add canon" variant="quiet" size="compact" disabled={busy || Boolean(pending) || canon.length >= 16}
      onPress={() => setCanon(previous => [...previous, { position: progress, text: '' }])} />
    <TextField label="Your progress point" value={progress} onChangeText={setProgress} keyboardType="number-pad" maxLength={6}
      editable={!busy && !pending} />
    <Text variant="caption" muted>Canon after your progress stays hidden from everyone in this conversation.</Text>
    {!numbers ? <Text variant="caption">Points are whole numbers.</Text> : null}
    {error ? <FailureNotice message={error.message} detail={error.detail}>
      {!world ? <Button label="Retry" accessibilityLabel="Retry loading scene" variant="secondary" onPress={() => void load()} /> : null}
    </FailureNotice> : null}
    <Button label={pending ? 'Retry saving scene' : 'Save scene'} disabled={busy || !world || !numbers} onPress={() => void save()} />
  </Dialog>;
}

export function IntegrateDialog({ client, thread, messages, onIntegrated }: {
  readonly client: RuntimeClient; readonly thread: Conversation; readonly messages: readonly ConversationMessage[];
  readonly onIntegrated: (room: Conversation) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<Conversation[]>([]);
  const [roomId, setRoomId] = useState('');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReturnType<RuntimeClient['prepareThreadIntegration']> | null>(null);
  const complete = messages.filter(message => message.status === 'complete');
  async function load() {
    setBusy(true); setError(null);
    try {
      const page = await client.conversations();
      const matching = page.items.filter(item => item.kind === 'room' && item.packageId === thread.packageId);
      setRooms(matching); setRoomId(matching[0]?.id ?? '');
      setChosen(new Set(complete.map(message => message.id)));
    } catch (cause) { setError(failure(cause, 'Shared conversations couldn’t be loaded.')); }
    finally { setBusy(false); }
  }
  async function integrate() {
    const room = rooms.find(item => item.id === roomId);
    if (!room) return;
    const command = pending ?? client.prepareThreadIntegration(thread, room,
      complete.filter(message => chosen.has(message.id)).map(message => ({ id: message.id, revision: message.revision })));
    setPending(command); setBusy(true); setError(null);
    try { const value = await client.integrateThread(command); setPending(null); setOpen(false); await onIntegrated(value); }
    catch (cause) { setError(failure(cause, 'These messages weren’t added to the shared history.')); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (busy) return; setOpen(value); setPending(null); if (value) void load(); }}
    title="Add to shared history" trigger={<Button label="Add to shared history" variant="quiet" size="compact" />}>
    {rooms.length ? <Select label="Shared conversation" value={roomId} onValueChange={setRoomId} disabled={busy || Boolean(pending)}
      options={rooms.map(room => ({ value: room.id, label: room.title }))} />
      : !busy && !error ? <Text muted>No shared conversation in this language yet.</Text> : null}
    <Text variant="caption">Messages to add</Text>
    {complete.map(message => <Button key={message.id} label={message.text.slice(0, 120) || '—'} variant="secondary" size="compact"
      accessibilityState={{ selected: chosen.has(message.id) }} disabled={busy || Boolean(pending)}
      onPress={() => setChosen(previous => {
        const next = new Set(previous);
        if (next.has(message.id)) next.delete(message.id); else next.add(message.id);
        return next;
      })} />)}
    <Text variant="caption" muted>Only people in both conversations will remember these messages.</Text>
    {error ? <FailureNotice message={error.message} detail={error.detail} /> : null}
    <Button label={pending ? 'Retry adding' : 'Add messages'} disabled={busy || !roomId || !chosen.size} onPress={() => void integrate()} />
  </Dialog>;
}

export function MemoryDialog({ client, conversation, people }: {
  readonly client: RuntimeClient; readonly conversation: Conversation; readonly people: readonly Contact[];
}) {
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState(conversation.participants[0] ?? '');
  const [items, setItems] = useState<ConversationMessage[] | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || !personId) return;
    let active = true;
    setItems(null); setError(null);
    client.conversationMemory(conversation.id, personId).then(page => { if (active) setItems(page.items); })
      .catch(cause => { if (active) setError(failure(cause, 'This memory couldn’t be read.')); });
    return () => { active = false; };
  }, [client, conversation.id, personId, open, attempt]);
  const name = (id: string | null) => people.find(person => person.id === id)?.name ?? 'You';
  return <Dialog open={open} onOpenChange={setOpen} title="What people remember"
    trigger={<Button label="What people remember" variant="quiet" size="compact" />}>
    <Select label="Person" value={personId} onValueChange={setPersonId}
      options={conversation.participants.map(id => ({ value: id, label: name(id) }))} />
    {items === null && !error ? <Text accessibilityLiveRegion="polite">Reading…</Text> : null}
    {items?.length === 0 ? <Text muted>Nothing here yet.</Text> : null}
    {items?.map(message => <View key={message.id} style={styles.memory}>
      <Text variant="caption" muted>{message.role === 'user' ? 'You' : name(message.participantId)}{message.integratedFrom ? ' · added from practice' : ''}</Text>
      <Text selectable>{message.text}</Text>
    </View>)}
    {error ? <FailureNotice message={error.message} detail={error.detail}>
      <Button label="Retry" accessibilityLabel="Retry reading memory" variant="secondary" onPress={() => setAttempt(value => value + 1)} />
    </FailureNotice> : null}
  </Dialog>;
}

const styles = StyleSheet.create(theme => ({
  grow: { flex: 1, minWidth: 0 },
  position: { width: 96 },
  memory: { gap: theme.spacing.tiny, paddingVertical: theme.spacing.small, borderBottomWidth: 1, borderColor: theme.colors.border },
}));
