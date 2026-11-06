import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { AppShell, Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import { ActivityCard } from '@mlearn/ui/activity-card';
import { logoSource } from '@mlearn/ui/brand';
import { SourceRow } from '@mlearn/ui/source-row';
import { Select } from '@mlearn/ui/select';
import type { Conversation, ConversationPreview, DocumentRecord, SourceRecord, Snapshot } from '@mlearn/contracts';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { useSourceImport } from '../source-entry';
import { conversationPreviewText } from '../messenger';

export function HomeScreen() {
  const host = useRuntime();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const columns = width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [conversation, setConversation] = useState<{
    readonly chat: Conversation;
    readonly preview: ConversationPreview | undefined;
  } | null>(null);
  const [conversationPending, setConversationPending] = useState(true);
  const [conversationError, setConversationError] = useState('');
  const [conversationReload, setConversationReload] = useState(0);
  const sourceImport = useSourceImport(selected);
  const busy = sourceImport.busy;

  async function refresh() {
    if (!host.available) return;
    const [value, recentSources, recentDocuments] = await Promise.all([
      host.client.snapshot(), host.client.recentSources(), host.client.recentDocuments(),
    ]);
    setSnapshot(value);
    setSources(recentSources);
    setDocuments(recentDocuments);
    setSelected(current => current || value.installedPlugins.find(plugin => plugin.capabilities.includes('text.analyze.v1'))?.id || '');
  }
  useFocusEffect(useCallback(() => {
    let active = true;
    if (host.available) void (async () => {
      const value = await host.client.snapshot();
      if (!active) return;
      const recentSources = await host.client.recentSources();
      if (!active) return;
      const recentDocuments = await host.client.recentDocuments();
      if (!active) return;
      setSnapshot(value);
      setSources(recentSources);
      setDocuments(recentDocuments);
      setSelected(current => current || value.installedPlugins.find(plugin => plugin.capabilities.includes('text.analyze.v1'))?.id || '');
      setError('');
    })().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [host]));

  useFocusEffect(useCallback(() => {
    let active = true;
    if (host.available) {
      setConversationPending(true);
      setConversationError('');
      void host.client.conversations('').then(page => {
        if (!active) return;
        const chat = page.items[0];
        setConversation(chat ? { chat, preview: page.previews.find(item => item.conversationId === chat.id) } : null);
      }).catch((cause: unknown) => {
        if (active) setConversationError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (active) setConversationPending(false);
      });
    }
    return () => { active = false; };
  }, [host, conversationReload]));

  const languages = snapshot?.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')) ?? [];
  function resume(source: SourceRecord) {
    if (process.env.EXPO_PUBLIC_MLEARN_METRICS === '1')
      console.info(`annotation-ui phase=resume_action timestamp_ms=${Date.now()}`);
    router.push({ pathname: '/watch', params: { id: source.id } });
  }
  const openRead = () => router.push({ pathname: '/reader', params: { packageId: selected } });
  const openWatch = () => router.push({ pathname: '/watch', params: { packageId: selected } });
  const openReview = () => router.push({ pathname: '/review', params: selected ? { packageId: selected } : {} });
  const openSync = () => router.push({ pathname: '/review', params: { packageId: selected, activity: 'calibration' } });
  function documentRow(source: DocumentRecord) {
    return <SourceRow key={source.id} title={source.title} icon="book" disabled={busy}
      detail={`${source.format.toUpperCase()} · ${languages.find(language => language.id === source.packageId)?.displayName ?? 'Language package unavailable'}`}
      onPress={() => router.push({ pathname: '/reader', params: { id: source.id } })} />;
  }
  function videoRow(source: SourceRecord) {
    const seconds = Math.floor(source.positionMs / 1000);
    const language = languages.find(plugin => plugin.id === source.packageId);
    return <SourceRow key={source.id} title={source.title} icon="video" disabled={busy}
      detail={`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${language?.displayName ?? 'Language package unavailable'}${source.subtitlePath ? ' · Subtitles' : ''}`}
      progress={source.durationMs > 0 ? source.positionMs / source.durationMs * 100 : undefined}
      onPress={() => resume(source)} />;
  }

  return <AppShell header={<View style={styles.header}>
    <View style={styles.topRow}>
      <View style={styles.brand}>
        <Image source={logoSource} style={styles.logo} accessibilityLabel="mLearn Logo" />
        <Text variant="shellTitle" accessibilityRole="header" accessibilityLabel="Home">mLearn</Text>
      </View>
      <Row>
        <View style={styles.languages}><Select label="Source language" testID="source-language-select" value={selected}
          options={languages.map(plugin => ({ value: plugin.id, label: plugin.displayName ?? plugin.id, testID: `language-${plugin.id}` }))}
          onValueChange={setSelected} disabled={busy} placeholder="Source language" /></View>
        <Button label="Get language packages" icon="package" iconOnly size="compact" variant="quiet"
          onPress={() => router.push({ pathname: '/settings', params: { section: 'languages' } })} />
      </Row>
    </View>
    <Row>
      <Button label="Settings" icon="settings" variant="quiet" size="compact" onPress={() => router.push('/settings')} />
      <Button label="Knowledge" variant="quiet" size="compact"
        onPress={() => router.navigate({ pathname: '/knowledge', params: selected ? { packageId: selected } : {} })} />
      <Button label="Material" variant="quiet" size="compact" onPress={() => router.navigate('/materials')} />
    </Row>
  </View>}>
    {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : null}
    {snapshot?.packageIssues?.length ? <Text accessibilityRole="alert">
      Some language packages are unavailable. Open Settings to repair them; other installed packages remain usable.
    </Text> : null}
    {sourceImport.opening ? <Row>
      <Text accessibilityLiveRegion="polite">Opening dropped source…</Text>
      <Button label="Cancel opening" variant="secondary" onPress={sourceImport.cancel} />
    </Row> : null}
    {sourceImport.error ? <Text accessibilityRole="alert">{sourceImport.error}</Text> : null}
    {error ? <View style={styles.feedback}><Text accessibilityRole="alert">{error}</Text>
      <Button label="Retry sources" variant="secondary" disabled={busy}
        onPress={() => void refresh().then(() => setError('')).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))} />
    </View> : null}
    {host.available && snapshot && !languages.length ? <Text muted>Choose a language package to get started.</Text> : null}
    <View style={styles.content}>
      <View style={styles.activities}>
        <View style={styles.activity(columns)}>
          <ActivityCard title="Read" icon="book" onPress={openRead} disabled={busy || !selected}>
            {documents[0] ? documentRow(documents[0]) : null}
            <Button testID="home-open-read" label="Open document" icon="book"
              variant="quiet" size="compact" disabled={busy || !selected} onPress={openRead} />
          </ActivityCard>
        </View>
        <View style={styles.activity(columns)}>
          <ActivityCard title="Watch" icon="video" onPress={openWatch} disabled={busy || !selected}>
            {sources[0] ? videoRow(sources[0]) : null}
            <Button testID="home-open-watch" label="Open video" icon="video"
              variant="quiet" size="compact" disabled={busy || !selected} onPress={openWatch} />
          </ActivityCard>
        </View>
        <View style={styles.activity(columns)}>
          <ActivityCard title="Messenger" icon="conversation" onPress={() => router.push('/messenger')}>
            {conversation ? <Button testID="home-continue-conversation" label={conversation.chat.title}
              accessibilityLabel={`Continue ${conversation.chat.title}`} variant="navigation" size="row"
              description={conversation.chat.purpose || undefined}
              detail={conversation.preview ? conversationPreviewText(conversation.preview) : undefined}
              onPress={() => router.push({ pathname: '/messenger', params: { id: conversation.chat.id } })} />
              : host.available && !conversationPending && !conversationError ? <Text muted>No conversations.</Text> : null}
            {host.available && conversationPending ? <Text muted accessibilityLiveRegion="polite">Loading conversations…</Text> : null}
            {conversationError ? <>
              <Text accessibilityRole="alert">{conversationError}</Text>
              <Button label="Retry conversation preview" variant="quiet" disabled={conversationPending}
                onPress={() => setConversationReload(value => value + 1)} />
            </> : null}
            <Button testID="home-open-conversation" label="Conversation" variant="quiet" onPress={() => router.push('/messenger')} />
          </ActivityCard>
        </View>
        <View style={styles.activity(columns)}>
          <ActivityCard title="Review" icon="book" testID="home-open-review" onPress={openReview}>
            <Button label="Open Review" onPress={openReview} />
          </ActivityCard>
        </View>
        <View style={styles.activity(columns)}>
          <ActivityCard title="Word Sync" icon="sync" testID="home-open-sync" onPress={openSync} disabled={!selected}>
            <Button label="Open Word Sync" disabled={!selected} onPress={openSync} />
          </ActivityCard>
        </View>
      </View>
      {documents.length > 1 || sources.length > 1 ? <View style={styles.recent}>
        <Text variant="section" accessibilityRole="header">Recent sources</Text>
        {documents.length > 1 ? <View style={styles.group}>
          <Text variant="groupTitle">Documents</Text>{documents.slice(1).map(documentRow)}
        </View> : null}
        {sources.length > 1 ? <View style={styles.group}>
          <Text variant="groupTitle">Videos</Text>{sources.slice(1).map(videoRow)}
        </View> : null}
      </View> : null}
    </View>
  </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  header: { gap: theme.spacing.small },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'space-between', gap: theme.spacing.medium },
  brand: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small },
  logo: { width: 24, height: 24 },
  languages: { width: 220, maxWidth: '100%', minWidth: 0, flexShrink: 1 },
  content: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: theme.spacing.section },
  activities: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: theme.spacing.section },
  activity: (columns: number) => ({ flexGrow: 1, flexBasis: columns === 1 ? '100%' : 300,
    maxWidth: columns === 3 ? '32%' : columns === 2 ? '48%' : '100%', minWidth: 0 }),
  group: { flex: 1, minWidth: 0, gap: theme.spacing.compact },
  recent: { gap: theme.spacing.medium },
  feedback: { alignItems: 'flex-start', gap: theme.spacing.small },
}));
