import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { Contact, Conversation, ConversationProviderSettings, ConversationTracePage, PluginSummary } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';

type Action = { readonly origin: string; readonly run: () => Promise<void> };
type Actions = {
  readonly client: RuntimeClient;
  readonly busy: boolean;
  readonly error: string;
  readonly origin: string;
  readonly act: (action: Action) => Promise<void>;
  readonly retry: Action | null;
};
export function ActionFeedback({ actions, origin }: { readonly actions: Actions; readonly origin: string }) {
  if (!actions.error || actions.origin !== origin) return null;
  return <View style={styles.feedback}><Text accessibilityRole="alert" variant="caption">{actions.error}</Text>
    {actions.retry?.origin === origin ? <Button label="Retry action" size="compact" variant="secondary"
      disabled={actions.busy} onPress={() => { if (actions.retry) void actions.act(actions.retry); }} /> : null}</View>;
}

export function ContactEditor({ actions, contact, trigger, onSaved }: {
  readonly actions: Actions; readonly contact: Contact | null; readonly trigger: ReactElement;
  readonly onSaved: (contact: Contact) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact?.name ?? '');
  const [description, setDescription] = useState(contact?.description ?? '');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function save() {
    const command = actions.client.prepareConversationContact({
      ...(contact ?? {}), name, description, archived: contact?.archived ?? false,
    });
    void actions.act({ origin: 'contact-editor', run: async () => {
      const saved = await actions.client.saveConversationContact(command);
      if (alive.current) { await onSaved(saved); setOpen(false); }
    } });
  }
  return <Dialog open={open} onOpenChange={value => {
    if (actions.busy) return;
    if (value) { setName(contact?.name ?? ''); setDescription(contact?.description ?? ''); }
    setOpen(value);
  }}
    title={contact ? 'Edit person' : 'New person'} description="People are independent of conversations."
    trigger={trigger}>
    <TextField testID="conversation-person-name" label="Name" value={name} onChangeText={setName} maxLength={256} editable={!actions.busy} />
    <TextField testID="conversation-person-description" label="Description" value={description} onChangeText={setDescription} multiline maxLength={8192} editable={!actions.busy} />
    <ActionFeedback actions={actions} origin="contact-editor" />
    <Button label="Save person" disabled={!name.trim() || actions.busy} onPress={save} />
  </Dialog>;
}

export function ConversationEditor({ actions, conversation, people, languages, onSaved, trigger }: {
  readonly actions: Actions; readonly conversation: Conversation | null; readonly people: readonly Contact[];
  readonly languages: readonly PluginSummary[]; readonly trigger: ReactElement;
  readonly onSaved: (conversation: Conversation) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(conversation?.title ?? '');
  const [purpose, setPurpose] = useState(conversation?.purpose ?? '');
  const [packageId, setPackageId] = useState(conversation?.packageId ?? languages[0]?.id ?? '');
  const [participants, setParticipants] = useState<string[]>(conversation?.participants ?? []);
  const [available, setAvailable] = useState<Contact[]>([...people]);
  const [query, setQuery] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [peopleError, setPeopleError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const peopleEpoch = useRef(0);
  useEffect(() => {
    const owned = ++peopleEpoch.current;
    if (!open) return;
    actions.client.conversationContacts(query).then(page => {
      if (peopleEpoch.current === owned) { setAvailable(page.items); setNext(page.next); setPeopleError(''); }
    }).catch(cause => { if (peopleEpoch.current === owned) setPeopleError(cause instanceof Error ? cause.message : 'People could not be loaded.'); });
    return () => { if (peopleEpoch.current === owned) peopleEpoch.current++; };
  }, [actions.client, query, open]);
  function save() {
    const value = { title, purpose, packageId, participants, kind: 'thread' as const };
    if (conversation) {
      const command = actions.client.prepareConversationUpdate({ ...conversation, title, purpose, participants });
      void actions.act({ origin: 'conversation-editor', run: async () => {
        const result = await actions.client.updateConversation(command);
        if (alive.current) { await onSaved(result); setOpen(false); }
      } });
    } else {
      const command = actions.client.prepareConversation(value);
      void actions.act({ origin: 'conversation-editor', run: async () => {
        const result = await actions.client.createConversation(command);
        if (alive.current) { await onSaved(result); setOpen(false); }
      } });
    }
  }
  return <Dialog open={open} onOpenChange={value => {
    if (actions.busy) return;
    if (value) {
      setTitle(conversation?.title ?? ''); setPurpose(conversation?.purpose ?? '');
      setPackageId(conversation?.packageId ?? languages[0]?.id ?? '');
      setParticipants(conversation?.participants ?? []); setAvailable([...people]); setQuery('');
    }
    setOpen(value);
  }}
    title={conversation ? 'Conversation details' : 'New temporary Thread'}
    description={conversation?.kind === 'direct' ? 'This conversation keeps the same person and language.' : 'Temporary practice with selected People. Discarding does not remove captured Material.'}
    trigger={trigger}>
    <TextField label="Title" value={title} onChangeText={setTitle} maxLength={256} editable={!actions.busy} />
    <TextField label="Purpose" value={purpose} onChangeText={setPurpose} maxLength={4096} editable={!actions.busy} multiline />
    <Select label="Conversation language" value={packageId} onValueChange={setPackageId}
      disabled={Boolean(conversation) || actions.busy}
      options={[...languages.map(language => ({ value: language.id, label: language.displayName ?? language.id })),
        ...(conversation && !languages.some(language => language.id === conversation.packageId)
          ? [{ value: conversation.packageId, label: conversation.packageId }] : [])]} />
    {conversation?.kind !== 'direct' ? <>
      <Text variant="caption">Participants ({participants.length}/8)</Text>
      {participants.map(id => <Row key={id}>
        <Text>{available.find(person => person.id === id)?.name ?? people.find(person => person.id === id)?.name ?? id}</Text>
        <Button label="Remove" accessibilityLabel={`Remove ${available.find(person => person.id === id)?.name ?? id}`}
          variant="quiet" size="compact" disabled={actions.busy} onPress={() => setParticipants(previous => previous.filter(value => value !== id))} />
      </Row>)}
      <TextField label="Search People" variant="search" value={query} onChangeText={setQuery} maxLength={256} />
      {available.filter(person => !participants.includes(person.id)).map(person => <Button key={person.id}
        label={person.name} detail={person.description} variant="navigation" size="compact"
        disabled={participants.length >= 8 || actions.busy}
        onPress={() => setParticipants(previous => [...previous, person.id])} />)}
      {peopleError ? <Text accessibilityRole="alert">{peopleError}</Text> : null}
      {next ? <Button label="More People" variant="quiet" onPress={() => {
        const owned = peopleEpoch.current;
        void actions.client.conversationContacts(query, false, next).then(page => {
          if (peopleEpoch.current === owned) { setAvailable(page.items); setNext(page.next); }
        }).catch(cause => { if (peopleEpoch.current === owned) setPeopleError(cause instanceof Error ? cause.message : 'People could not be loaded.'); });
      }} /> : null}
    </> : null}
    <ActionFeedback actions={actions} origin="conversation-editor" />
    <Button label={conversation ? 'Save conversation' : 'Create Thread'} disabled={!title.trim() || !packageId || !participants.length || actions.busy} onPress={save} />
  </Dialog>;
}

export function ProviderDialog({ client }: { readonly client: RuntimeClient }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ConversationProviderSettings | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [credential, setCredential] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<ReturnType<RuntimeClient['prepareConversationProvider']> | null>(null);
  const epoch = useRef(0);
  async function load() {
    const owned = ++epoch.current;
    setBusy(true); setError('');
    try {
      const value = await client.conversationProvider();
      if (owned !== epoch.current) return;
      setSettings(value); setEndpoint(value.endpoint); setModel(value.model);
    } catch { if (owned === epoch.current) setError('Provider settings could not be loaded.'); }
    finally { if (owned === epoch.current) setBusy(false); }
  }
  async function save() {
    if (!settings) return;
    const owned = epoch.current;
    const command = pending.current ?? client.prepareConversationProvider(settings.revision, endpoint, model);
    pending.current = command;
    setBusy(true); setError('');
    try {
      const value = await client.saveConversationProvider(command);
      if (owned === epoch.current) { pending.current = null; setSettings(value); }
    } catch (cause) {
      if (owned === epoch.current) {
        // These native validation failures precede admission. Unknown transport
        // or receipt outcomes must retain their original command instead.
        if (cause instanceof RuntimeError && ['provider_unavailable', 'invalid_conversation'].includes(cause.code)) {
          pending.current = null; setError(cause.message);
        } else setError('Provider settings could not be saved. Retry retains the same command.');
      }
    }
    finally { if (owned === epoch.current) setBusy(false); }
  }
  async function setKey(clear = false) {
    const key = clear ? null : credential;
    setCredential(''); setBusy(true); setError('');
    try {
      const ready = await client.setConversationSessionCredential(key);
      setSettings(previous => previous && ({ ...previous, sessionCredentialReady: ready }));
    } catch { setError('Session credential could not be updated. Enter it again to retry.'); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => {
    if (busy) return;
    setOpen(value); setCredential('');
    if (value) void load(); else { epoch.current++; pending.current = null; }
  }} title="Conversation provider" description="Endpoint and model are saved natively. Requests run only when you send or ask for an explanation."
    trigger={<Button label="Provider" size="compact" variant="quiet" />}>
    <TextField testID="conversation-provider-endpoint" label="Chat completions endpoint" value={endpoint} autoCapitalize="none" autoCorrect={false}
      editable={!busy && !pending.current} onChangeText={setEndpoint} maxLength={2048} />
    <TextField testID="conversation-provider-model" label="Model" value={model} autoCapitalize="none" autoCorrect={false}
      editable={!busy && !pending.current} onChangeText={setModel} maxLength={256} />
    <Button label={pending.current ? 'Retry saving settings' : 'Save endpoint and model'} disabled={busy || !settings} onPress={() => void save()} />
    <Text variant="caption">API key: SESSION ONLY. It is held in native memory and is not saved or included in execution traces.</Text>
    <TextField label="Session-only API key" value={credential} onChangeText={setCredential} secureTextEntry
      autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={!busy} maxLength={4096} />
    <Row><Button label="Set session key" disabled={busy || !credential} onPress={() => void setKey()} />
      <Button label="Clear session key" disabled={busy} variant="secondary" onPress={() => void setKey(true)} /></Row>
    <Text variant="caption">{settings?.sessionCredentialReady ? 'Session credential set' : 'No session credential set'}</Text>
    {error ? <><Text accessibilityRole="alert">{error}</Text>
      {!settings ? <Button label="Retry loading settings" variant="secondary" disabled={busy} onPress={() => void load()} /> : null}</> : null}
  </Dialog>;
}

export function RuntimeTrace({ client, generationId, openRevision = 0 }: {
  readonly client: RuntimeClient; readonly generationId: string | null; readonly openRevision?: number;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<ConversationTracePage | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (openRevision > 0) { setAfter(null); setOpen(true); } }, [openRevision]);
  useEffect(() => {
    let active = true;
    setPage(null); setError('');
    if (!open || !generationId) return;
    setBusy(true);
    client.conversationTrace(generationId, after).then(value => { if (active) setPage(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Trace could not be read.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, open, generationId, after, attempt]);
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) setAfter(null); }}
    title="Runtime Inspector" description="Actual native generation records. No external request is made by opening this view."
    trigger={<Button label="Runtime Inspector" variant="quiet" size="compact" />}>
    {!generationId ? <Text muted>Select a generated message to inspect its execution.</Text> : null}
    {busy ? <Text accessibilityLiveRegion="polite">Reading execution trace…</Text> : null}
    {page ? <>
      <Text selectable>{page.generation.id} · {page.generation.status}</Text>
      <Text variant="caption" selectable>Started: {page.generation.startedAtMs ?? 'not started'} · Finished: {page.generation.finishedAtMs ?? 'not finished'}</Text>
      {page.generation.error ? <Text accessibilityRole="alert">{page.generation.error}</Text> : null}
      <Text variant="caption" selectable>Source inputs: {page.inputs.map(input => `${input.id}@${input.revision}`).join(', ') || 'none'}</Text>
      {page.items.map(row => <View key={row.sequence} style={styles.trace}>
        <Text variant="caption" muted>{row.sequence} · {row.kind} · {row.atMs}</Text>
        <Text selectable>{row.content}</Text>
      </View>)}
      {!page.items.length ? <Text muted>No execution rows recorded.</Text> : null}
      <Row><Button label="First trace page" variant="secondary" disabled={busy || after === null} onPress={() => setAfter(null)} />
        <Button label="Next trace page" variant="secondary" disabled={busy || page.next === null} onPress={() => setAfter(page.next)} /></Row>
    </> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {generationId ? <Button label="Refresh trace" disabled={busy} variant="quiet" onPress={() => setAttempt(value => value + 1)} /> : null}
  </Dialog>;
}
const styles = StyleSheet.create(theme => ({
  feedback: { gap: theme.spacing.small },
  trace: { gap: theme.spacing.tiny, paddingVertical: theme.spacing.small, borderBottomWidth: 1, borderColor: theme.colors.border },
}));
