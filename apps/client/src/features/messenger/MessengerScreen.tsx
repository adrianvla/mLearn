import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FlatList, Platform, ScrollView, View, useWindowDimensions, type ViewToken } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import type { Contact, Conversation, ConversationMessage } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { AppShell, Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { SegmentedControl } from '@mlearn/ui/segmented-control';
import { KeyboardAvoidingView } from '@mlearn/ui/keyboard-avoiding-view';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { AnnotatedText } from '../annotated-text';
import { Inspector, type Inspection } from '../inspector';
import { ActionFeedback, ContactEditor, ConversationEditor, ProviderDialog, RuntimeTrace } from './MessengerDialogs';
import { MessageActions } from './MessageActions';
import { messageAnchor, shouldSendComposer } from './messageFlow';
import { useMessenger } from './useMessenger';
import { ConversationSource } from './ConversationSource';

/** Return-to-message hook: /messenger?id=<conversationId>&messageId=<messageId>. */
export function MessengerScreen() {
  const host = useRuntime();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; messageId?: string; messageSequence?: string;
    materialId?: string; reviewSessionId?: string; reviewEncounterId?: string }>();
  if (!host.available) return <AppShell header={<Row>
    <Button label="Home" variant="quiet" onPress={() => router.dismissTo('/')} />
    <Text variant="heading" accessibilityRole="header">Conversation</Text>
  </Row>}><Text accessibilityRole="alert">{host.reason}</Text></AppShell>;
  return <MessengerWorkspace client={host.client} initialId={typeof params.id === 'string' ? params.id : ''}
    focusMessageId={typeof params.messageId === 'string' ? params.messageId : undefined}
    focusSequence={typeof params.messageSequence === 'string' && /^\d+$/.test(params.messageSequence)
      && Number(params.messageSequence) < 4294967295 ? Number(params.messageSequence) : undefined}
    materialId={typeof params.materialId === 'string' ? params.materialId : undefined}
    reviewSessionId={typeof params.reviewSessionId === 'string' ? params.reviewSessionId : undefined}
    reviewEncounterId={typeof params.reviewEncounterId === 'string' ? params.reviewEncounterId : undefined}
    windowControlsWidth={host.windowControlsWidth ?? 0} />;
}

export function MessengerWorkspace({ client, initialId = '', focusMessageId, focusSequence, windowControlsWidth = 0,
  materialId, reviewSessionId, reviewEncounterId }: {
  readonly client: RuntimeClient; readonly initialId?: string; readonly focusMessageId?: string;
  readonly focusSequence?: number; readonly windowControlsWidth?: number;
  readonly materialId?: string; readonly reviewSessionId?: string; readonly reviewEncounterId?: string;
}) {
  const messenger = useMessenger(client, initialId, focusSequence);
  const actions = { ...messenger, client };
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 760;
  const [tab, setTab] = useState<'chats' | 'people'>('chats');
  const [filter, setFilter] = useState('all');
  const [rail, setRail] = useState(!initialId);
  const [directPerson, setDirectPerson] = useState<Contact | null>(null);
  const [directLanguage, setDirectLanguage] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [traceId, setTraceId] = useState<string | null>(null);
  const [traceOpenRevision, setTraceOpenRevision] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [shownAnalysis, setShownAnalysis] = useState<ReadonlySet<string>>(new Set());
  const [following, setFollowing] = useState(true);
  messenger.setFollowing(following);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const list = useRef<FlatList<ConversationMessage>>(null);
  const position = useRef({ y: 0, height: 0, viewport: 0 });
  const prepend = useRef<{ id: string; y: number } | null>(null);
  const rows = useRef(new Map<string, View>());
  const visibleIds = useRef<string[]>([]);
  const chat = messenger.conversation;
  useEffect(() => { setShownAnalysis(new Set()); }, [chat?.id]);
  const selected = useRef(messenger.id); selected.current = messenger.id;
  const visibleChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<ConversationMessage>[] }) => {
    const ids = viewableItems.filter(item => item.isViewable).map(item => item.item.id);
    visibleIds.current = ids; messenger.setVisibleMessages(ids);
  }).current;
  function restorePrepend() {
    const previous = prepend.current;
    if (!previous) return;
    const node = rows.current.get(previous.id);
    if (!node) return;
    prepend.current = null;
    node.measureInWindow((_x, y) => {
      list.current?.scrollToOffset({ offset: Math.max(0, position.current.y + y - previous.y), animated: false });
    });
  }
  useLayoutEffect(() => { restorePrepend(); }, [messenger.messages]);
  useEffect(() => {
    setParticipantId(chat?.participants[0] ?? ''); setInspection(null); setTraceId(null); setTraceOpenRevision(0);
    setDirectPerson(null); setToolsOpen(false);
  }, [chat?.id]);
  useEffect(() => {
    if (!inspection?.sourceAnchor || inspection.sourceAnchor.locator.kind !== 'message') return;
    const locator = inspection.sourceAnchor.locator;
    if (locator.conversationId !== messenger.id || !messenger.messages.some(message =>
      message.id === locator.messageId && message.revision === locator.messageRevision)) setInspection(null);
  }, [messenger.id, messenger.messages, inspection]);
  useEffect(() => {
    if (!focusMessageId) return;
    const index = messenger.messages.findIndex(message => message.id === focusMessageId);
    if (index >= 0) { setRail(false); setFollowing(false); list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.4 }); }
  }, [focusMessageId, messenger.messages.some(message => message.id === focusMessageId)]);
  function select(id: string) { void messenger.select(id); setRail(false); setFollowing(true); setInspection(null); }
  async function openCreated(value: Conversation) { messenger.refreshLists(); await messenger.select(value.id); setRail(false); setFollowing(true); }
  function messagePerson(contact: Contact) {
    if (!directLanguage) return;
    const command = client.prepareConversation({ kind: 'direct', title: contact.name, purpose: '',
      packageId: directLanguage, participants: [contact.id] });
    void messenger.act({ origin: 'people', run: async () => {
      const owned = selected.current;
      const value = await client.createConversation(command);
      if (selected.current !== owned) return;
      setDirectPerson(null); await openCreated(value);
    } });
  }
  function archive(contact: Contact) {
    const command = client.prepareConversationContact({ ...contact, archived: !contact.archived });
    void messenger.act({ origin: 'people', run: async () => {
      const saved = await client.saveConversationContact(command);
      await messenger.contactChanged(saved);
    } });
  }
  function discard() {
    if (!chat) return;
    const command = client.prepareConversationDiscard(chat);
    void messenger.act({ origin: 'header', run: async () => {
      await client.discardConversation(command); messenger.refreshLists(); messenger.leaveDiscarded(command.id); setRail(true);
    } });
  }
  function stop() {
    const generationId = messenger.generation?.id
      ?? messenger.messages.find(message => ['pending', 'partial'].includes(message.status))?.generationId;
    if (!generationId) return;
    const command = client.prepareConversationStop(generationId);
    void messenger.act({ origin: 'composer', run: async () => {
      await client.stopConversationGeneration(command); await messenger.refreshCurrent();
    } });
  }
  async function older() {
    setFollowing(false); setLoadingOlder(true);
    await messenger.act({ origin: 'history', run: () => messenger.olderPage(async () => {
      const first = visibleIds.current[0];
      const node = rows.current.get(first);
      if (Platform.OS !== 'web' || !node) return;
      await new Promise<void>(resolve => {
        node.measureInWindow((_x, y) => { prepend.current = { id: first, y }; resolve(); });
      });
    }) });
    setLoadingOlder(false);
  }
  const active = messenger.messages.some(message => ['pending', 'partial'].includes(message.status));
  const chats = messenger.chats.filter(value => filter === 'all' || value.kind === filter);
  const selectedTrace = traceId ?? [...messenger.messages].reverse().find(message => message.generationId)?.generationId ?? null;
  return <View style={styles.screen(insets.top, insets.bottom)}><KeyboardAvoidingView style={styles.workspace}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
    {wide || rail ? <View style={styles.rail(wide, windowControlsWidth)}>
      <View style={styles.railHeader}><Row>
        <Button label="Home" icon="arrowLeft" iconOnly variant="quiet" size="compact" disabled={messenger.busy}
          onPress={() => void messenger.act({ origin: 'rail', run: async () => { await messenger.persistDraft(); router.dismissTo('/'); } })} />
        <View style={styles.grow}><Text variant="heading">{tab === 'chats' ? 'Chats' : 'People'}</Text></View>
        {tab === 'chats' ? <ConversationEditor key={`new:${messenger.id}`} actions={actions} conversation={null}
          people={messenger.contacts} languages={messenger.languages} onSaved={openCreated}
          trigger={<Button label="New Thread" variant="quiet" size="compact" disabled={messenger.busy} />} />
          : <ContactEditor actions={actions} contact={null} onSaved={messenger.contactChanged}
            trigger={<Button label="New person" variant="quiet" size="compact" disabled={messenger.busy} />} />}
      </Row></View>
      <View style={styles.railControls}>
        <TextField testID="conversation-search" label={tab === 'chats' ? 'Search conversations and history' : 'Search People'} variant="search"
          value={messenger.listQuery} onChangeText={messenger.setListQuery} maxLength={256} />
        <SegmentedControl value={tab} options={[{ value: 'chats', label: 'Chats' }, { value: 'people', label: 'People' }]}
          onValueChange={value => setTab(value === 'people' ? 'people' : 'chats')} />
        {tab === 'chats' ? <Select label="Conversation filter" value={filter} onValueChange={setFilter}
          options={[{ value: 'all', label: 'All conversations' }, { value: 'direct', label: 'Direct conversations' }, { value: 'thread', label: 'Temporary Threads' }]} />
          : <Select label="People filter" value={messenger.archived ? 'archived' : 'active'} onValueChange={value => messenger.setArchived(value === 'archived')}
            options={[{ value: 'active', label: 'Active People' }, { value: 'archived', label: 'Archived People' }]} />}
        <ActionFeedback actions={actions} origin="rail" />
        {messenger.error && messenger.origin === 'rail' ? <Button label="Retry loading lists" variant="quiet" size="compact"
          onPress={messenger.refreshLists} /> : null}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.railList} keyboardShouldPersistTaps="handled">
        {tab === 'chats' ? <>
          {chats.map(value => {
            const preview = messenger.previews.find(item => item.conversationId === value.id);
            return <Button key={value.id} label={value.title}
              description={value.purpose || (value.kind === 'thread' ? 'Temporary Thread' : undefined)}
              detail={preview ? preview.status === 'complete' ? preview.text
                : `${preview.status.replaceAll('_', ' ')}${preview.text ? ` · ${preview.text}` : ''}` : undefined}
              meta={preview ? new Date(preview.createdAtMs).toLocaleDateString([], { month: 'short', day: 'numeric' }) : undefined}
              variant="navigation" size="row" accessibilityState={{ selected: messenger.id === value.id }} disabled={messenger.busy}
              onPress={() => select(value.id)} />;
          })}
          {!chats.length ? <Text muted variant="caption">No matching conversations.</Text> : null}
        </> : <>
          {messenger.contacts.map(contact => <View key={contact.id} style={styles.person}>
            <ContactEditor key={`${contact.id}:${contact.revision}`} actions={actions} contact={contact} onSaved={messenger.contactChanged}
              trigger={<Button label={contact.name} detail={contact.description} variant="navigation" size="row" disabled={messenger.busy} />} />
            <Row>
              {!contact.archived ? <Dialog open={directPerson?.id === contact.id}
                onOpenChange={value => { if (!messenger.busy) { setDirectPerson(value ? contact : null); if (value) setDirectLanguage(messenger.languages[0]?.id ?? ''); } }}
                title={`Message ${contact.name}`} description="Reuse this person's conversation in the selected language."
                trigger={<Button label="Message" variant="quiet" size="compact" disabled={messenger.busy} />}>
                <Select label="Language for direct conversation" value={directLanguage} onValueChange={setDirectLanguage}
                  options={messenger.languages.map(language => ({ value: language.id, label: language.displayName ?? language.id }))} />
                <Button label="Open conversation" disabled={!directLanguage || messenger.busy} onPress={() => messagePerson(contact)} />
                <ActionFeedback actions={actions} origin="people" />
              </Dialog> : null}
              <Button label={contact.archived ? 'Restore' : 'Archive'} variant="quiet" size="compact"
                disabled={messenger.busy} onPress={() => archive(contact)} />
            </Row>
          </View>)}
          {!messenger.contacts.length ? <Text muted variant="caption">No matching People.</Text> : null}
          <ActionFeedback actions={actions} origin="people" />
        </>}
        {(tab === 'people' ? messenger.contactNext : messenger.chatNext) ? <Button label={tab === 'people' ? 'More People' : 'More conversations'}
          variant="quiet" size="compact" disabled={messenger.busy}
          onPress={() => void messenger.act({ origin: 'rail', run: () => messenger.moreLists(tab === 'people') })} /> : null}
      </ScrollView>
    </View> : null}
    {wide || !rail ? <View style={styles.main}>
      <View style={styles.header(wide ? 0 : windowControlsWidth)}>
        {!wide ? <Button label="Chats and People" icon="arrowLeft" iconOnly variant="quiet" size="compact" onPress={() => setRail(true)} /> : null}
        <View style={styles.grow}><Text variant="section" numberOfLines={1}>{chat?.title ?? 'Messenger'}</Text>
          {chat?.purpose ? <Text muted variant="caption" numberOfLines={1}>{chat.purpose}</Text> : null}</View>
        {chat ? <ConversationEditor key={`details:${chat.id}`} actions={actions} conversation={chat}
          people={[...messenger.participants, ...messenger.contacts.filter(contact => !messenger.participants.some(person => person.id === contact.id))]}
          languages={messenger.languages} onSaved={openCreated}
          trigger={<Button label="Conversation details" icon="settings" iconOnly variant="quiet" size="compact" disabled={messenger.busy} />} /> : null}
        <Button label="Conversation actions" icon="more" iconOnly variant="quiet" size="compact"
          accessibilityState={{ expanded: toolsOpen }} onPress={() => setToolsOpen(value => !value)} />
      </View>
      <View style={[styles.tools, !toolsOpen && styles.closedTools]}>
        <Row>
        <ProviderDialog client={client} />
        <RuntimeTrace key={messenger.id} client={client} generationId={selectedTrace} openRevision={traceOpenRevision} />
        {chat?.kind === 'thread' ? <Button label="Discard Thread" variant="quiet" size="compact"
          disabled={messenger.busy || active} onPress={discard} /> : null}
        </Row>
        {chat ? <TextField label="Search this history" variant="search" value={messenger.historyQuery}
          onChangeText={value => { setFollowing(false); messenger.setHistoryQuery(value); }} maxLength={256} /> : null}
      </View>
      <ActionFeedback actions={actions} origin="header" />
      {messenger.pending ? <Text accessibilityLiveRegion="polite">Loading conversation…</Text> : null}
      {chat ? <>
        <FlatList ref={list} testID="conversation-history" style={styles.scroll} contentContainerStyle={styles.history}
          data={messenger.messages} keyExtractor={message => message.id}
          keyboardShouldPersistTaps="handled" onViewableItemsChanged={visibleChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 1 }}
          maintainVisibleContentPosition={Platform.OS === 'web' ? undefined : { minIndexForVisible: 0 }}
          onLayout={event => { position.current.viewport = event.nativeEvent.layout.height; }}
          onScroll={event => {
            const y = event.nativeEvent.contentOffset.y;
            // Content growth can emit a scroll event without moving the view.
            // That is not the learner leaving the live tail.
            if (y !== position.current.y)
              setFollowing(!messenger.historyQuery && event.nativeEvent.contentSize.height - y - event.nativeEvent.layoutMeasurement.height < 64);
            position.current.y = y;
          }}
          scrollEventThrottle={64}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          }}
          onContentSizeChange={(_width, height) => {
            const previous = prepend.current; position.current.height = height;
            if (previous) {
              restorePrepend();
            } else if (following && !messenger.historyQuery && !focusMessageId) {
              // FlatList.scrollToEnd estimates unmeasured variable-height rows;
              // content-size callbacks already supply the real layout extent.
              list.current?.scrollToOffset({ offset: Math.max(0, height - position.current.viewport), animated: false });
            }
          }}
          ListHeaderComponent={<View style={styles.historyTools}>
            {messenger.older !== null ? <Button label="Older messages" variant="quiet" size="compact" busy={loadingOlder} onPress={() => void older()} /> : null}
            <ActionFeedback actions={actions} origin="history" />
          </View>}
          ListEmptyComponent={<Text muted>No messages in this view.</Text>}
          renderItem={({ item: message }) => {
            const analyzed = messenger.analysis?.messages.find(value => value.messageId === message.id
              && value.messageRevision === message.revision && value.contentRevision === message.contentRevision);
            return <View ref={node => { if (node) rows.current.set(message.id, node); else rows.current.delete(message.id); }}
              style={[styles.messageRow, message.role === 'user' && styles.authoredRow]}>
              {message.role === 'assistant' ? <Text muted variant="caption">{messenger.participants.find(contact => contact.id === message.participantId)?.name
                ?? (message.participantId ? message.participantId : 'Assistant')}</Text> : null}
              <View style={[styles.bubble, message.role === 'user' && styles.authoredBubble]}>
                {message.status === 'deleted' ? <Text muted>Message deleted</Text> : <AnnotatedText variant="body" rawText={message.text}
                  analysis={message.status === 'complete' && shownAnalysis.has(message.id) ? analyzed ?? null : null}
                  annotations={messenger.analysis?.annotations.filter(annotation => annotation.messageId === message.id) ?? []}
                  onInspect={(token, anchor) => {
                    if (!messenger.analysis || !analyzed) return;
                    const sourceAnchor = messageAnchor(message, messenger.analysis.packageId, messenger.analysis.packageVersion, token);
                    setInspection({ sourceForm: token.text, targets: token.targets, anchor, sourceAnchor,
                      context: sourceAnchor.text, packageRevision: messenger.analysis.packageRevision, showContext: true });
                  }} />}
              </View>
              <Row><Text muted variant="detail">{new Date(message.createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {message.status !== 'complete' ? ` · ${message.status}` : ''}</Text>
                {message.status === 'complete' ? <Button
                  label={shownAnalysis.has(message.id) ? 'Hide analysis' : 'Show analysis'} variant="quiet" size="compact"
                  disabled={!analyzed} accessibilityState={{ expanded: shownAnalysis.has(message.id) }}
                  onPress={() => setShownAnalysis(previous => {
                    const present = new Set(messenger.messages.map(value => value.id));
                    const next = new Set([...previous].filter(id => present.has(id)));
                    if (next.has(message.id)) next.delete(message.id); else next.add(message.id);
                    return next;
                  })} /> : null}
                <MessageActions key={`${message.id}:${message.revision}`} actions={actions} message={message} conversation={chat}
                  packageVersion={messenger.analysis?.packageVersion ?? null}
                  onReply={() => messenger.changeDraft(messenger.draft?.text ?? '', { id: message.id, revision: message.revision })}
                  onTrace={() => { setToolsOpen(true); setTraceId(message.generationId); setTraceOpenRevision(value => value + 1); }} /></Row>
              {messenger.generation?.assistantMessageId === message.id && messenger.generation.error
                ? <Text variant="caption" accessibilityRole="alert">{messenger.generation.error}</Text> : null}
            </View>;
          }} />
        {messenger.analysisError ? <Row><Text accessibilityRole="alert" variant="caption">{messenger.analysisError}</Text>
          <Button label="Retry message analysis" variant="quiet" size="compact" onPress={messenger.retryAnalysis} /></Row> : null}
        <View style={styles.composer}>
          {!following || messenger.historyQuery ? <Button label="Latest" variant="secondary" size="compact"
            onPress={() => { setFollowing(true); messenger.latest(); list.current?.scrollToOffset({
              offset: Math.max(0, position.current.height - position.current.viewport), animated: false,
            }); }} /> : null}
          {messenger.draft?.replyTo ? <Row><Text variant="caption">Replying to message {messenger.draft.replyTo.id}</Text>
            <Button label="Cancel reply" variant="quiet" size="compact" onPress={() => messenger.changeDraft(messenger.draft?.text ?? '', null)} /></Row> : null}
          {chat.participants.length > 1 ? <Select label="Responding participant" value={participantId} onValueChange={setParticipantId}
            options={chat.participants.map(id => ({ value: id, label: messenger.participants.find(contact => contact.id === id)?.name ?? id }))} /> : null}
          <TextField testID="conversation-composer" label="Message" placeholder="Message…" variant="composer" multiline value={messenger.draft?.text ?? ''}
            trailing={active ? <Button label="Stop" icon="stop" iconOnly variant="quiet" size="compact"
              disabled={messenger.busy} onPress={stop} />
              : <Button label="Send" icon="send" iconOnly variant="quiet" size="compact"
                disabled={messenger.busy || messenger.retry?.origin === 'composer' || !messenger.draft?.text.trim() || !participantId}
                onPress={() => messenger.send(participantId)} />}
            onChangeText={messenger.changeDraft} editable={Boolean(messenger.draft) && !messenger.busy} maxLength={8192} onBlur={messenger.saveDraftOnBlur}
            onKeyPress={event => {
              const native = event.nativeEvent;
              const shift = 'shiftKey' in native && native.shiftKey === true;
              const composing = 'isComposing' in native && native.isComposing === true;
              const code = 'keyCode' in native && typeof native.keyCode === 'number' ? native.keyCode : undefined;
              if (Platform.OS === 'web' && shouldSendComposer(native.key, shift, composing, code)) {
                event.preventDefault(); if (!active && !messenger.busy) messenger.send(participantId);
              }
            }} />
          <ActionFeedback actions={actions} origin="composer" />
        </View>
      </> : !messenger.pending ? <View style={styles.empty}><Text muted>Select a conversation or message someone in People.</Text>
        <ActionFeedback actions={actions} origin="history" />
        {messenger.error && messenger.origin === 'history' ? <Button label="Reload conversation" variant="secondary" onPress={messenger.reload} /> : null}</View> : null}
    </View> : null}
    {inspection && chat ? <Inspector inspection={inspection} packageId={chat.packageId} client={client}
      onBeforeOpenMaterial={messenger.persistDraft}
      onChanged={async () => { messenger.retryAnalysis(); }} onClose={() => setInspection(null)} /> : null}
    {materialId || reviewSessionId && reviewEncounterId ? <ConversationSource client={client}
      materialId={materialId} reviewSessionId={reviewSessionId} reviewEncounterId={reviewEncounterId}
      onKnowledgeChanged={messenger.retryAnalysis} /> : null}
  </KeyboardAvoidingView></View>;
}

const styles = StyleSheet.create(theme => ({
  screen: (top: number, bottom: number) => ({ flex: 1, minHeight: 0, paddingTop: top, paddingBottom: bottom, backgroundColor: theme.shell.canvas }),
  workspace: { flex: 1, minHeight: 0, flexDirection: 'row' },
  rail: (wide: boolean, controls: number) => ({ width: wide ? 300 : '100%', minWidth: 0, backgroundColor: theme.shell.navigation,
    borderRightWidth: wide ? 1 : 0, borderColor: theme.colors.border, paddingTop: Math.max(theme.spacing.small, controls ? 28 : 0), gap: theme.spacing.compact }),
  railHeader: { paddingHorizontal: theme.spacing.compact },
  railControls: { gap: theme.spacing.small, paddingHorizontal: theme.spacing.compact },
  railList: { gap: theme.spacing.tiny, paddingHorizontal: theme.spacing.small, paddingBottom: theme.spacing.medium },
  person: { gap: theme.spacing.tiny },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  grow: { flex: 1, minWidth: 0 },
  header: (controls: number) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.comfortable,
    paddingLeft: Math.max(theme.spacing.comfortable, controls),
    gap: theme.spacing.small, borderBottomWidth: 1, borderColor: theme.colors.border }),
  tools: { paddingHorizontal: theme.spacing.comfortable, paddingVertical: theme.spacing.small, gap: theme.spacing.small },
  closedTools: { display: 'none' },
  scroll: { flex: 1, minHeight: 0 },
  history: { padding: theme.spacing.comfortable, gap: theme.spacing.comfortable },
  historyTools: { gap: theme.spacing.small },
  messageRow: { alignItems: 'flex-start', gap: theme.spacing.tiny, paddingBottom: theme.spacing.medium },
  authoredRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '92%', minWidth: 0, paddingVertical: theme.spacing.small, paddingHorizontal: theme.spacing.compact,
    borderRadius: theme.radius * 2, borderBottomLeftRadius: theme.radius / 2,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.surfaces.secondary },
  authoredBubble: { backgroundColor: theme.surfaces.authored, borderBottomLeftRadius: theme.radius * 2, borderBottomRightRadius: theme.radius / 2 },
  composer: { gap: theme.spacing.small, padding: theme.spacing.comfortable, borderTopWidth: 1, borderColor: theme.colors.border },
  empty: { flex: 1, justifyContent: 'center', padding: theme.spacing.large, gap: theme.spacing.small },
}));
