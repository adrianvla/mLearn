import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { AppShell, Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import { SourceRow } from '@mlearn/ui/source-row';
import { Select } from '@mlearn/ui/select';
import type { DocumentRecord, SourceRecord, Snapshot } from '@mlearn/contracts';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { useSourceImport } from '../source-entry';
import { WorkspaceNavigation } from '../navigation';

export function HomeScreen() {
  const host = useRuntime();
  const router = useRouter();
  const wide = useWindowDimensions().width >= 1000;
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
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

  const languages = snapshot?.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')) ?? [];
  const hasSources = documents.length > 0 || sources.length > 0;
  function resume(source: SourceRecord) {
    if (process.env.EXPO_PUBLIC_MLEARN_METRICS === '1')
      console.info(`annotation-ui phase=resume_action timestamp_ms=${Date.now()}`);
    router.push({ pathname: '/watch', params: { id: source.id } });
  }
  const openActions = <Row>
    <Button testID="home-open-read" label="Open document" icon="book"
      disabled={busy || !selected} onPress={() => router.push({ pathname: '/reader', params: { packageId: selected } })} />
    <Button testID="home-open-watch" label="Open video" icon="video" variant="secondary"
      disabled={busy || !selected} onPress={() => router.push({ pathname: '/watch', params: { packageId: selected } })} />
  </Row>;

  return <AppShell navigationMode="workspace"
    navigation={<WorkspaceNavigation active="home" packageId={selected} />}
    header={<View style={styles.header}>
      <Text variant="entryTitle" accessibilityRole="header" accessibilityLabel="Home">
        {hasSources ? 'Continue' : 'Read and watch'}
      </Text>
      <Row>
        <View style={styles.languages}><Select label="Source language" testID="source-language-select" value={selected}
          options={languages.map(plugin => ({ value: plugin.id, label: plugin.displayName ?? plugin.id, testID: `language-${plugin.id}` }))}
          onValueChange={setSelected} disabled={busy} placeholder="Source language" /></View>
        <Button label="Get language packages" icon="package" iconOnly size="compact" variant="quiet"
          onPress={() => router.push({ pathname: '/settings', params: { section: 'languages' } })} />
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
    {host.available && !hasSources ? <View style={styles.empty}>
      <Text variant="section">Open a source</Text>
      <Text muted>Documents, books, images and videos stay here with your saved place.</Text>
      {!languages.length ? <Text muted>Choose a language package to get started.</Text> : null}
      {openActions}
    </View> : null}
    {host.available && hasSources ? <>
      <View style={styles.continuation(wide)}>
        {documents.length ? <View style={styles.group}>
          <Text variant="section" accessibilityRole="header">Reading</Text>
          {documents.map(source => <SourceRow key={source.id} title={source.title} icon="book" disabled={busy}
            detail={`${source.format.toUpperCase()} · ${languages.find(language => language.id === source.packageId)?.displayName ?? 'Language package unavailable'}`}
            onPress={() => router.push({ pathname: '/reader', params: { id: source.id } })} />)}
        </View> : null}
        {sources.length ? <View style={styles.group}>
          <Text variant="section" accessibilityRole="header">Watching</Text>
          {sources.map(source => {
            const seconds = Math.floor(source.positionMs / 1000);
            const language = languages.find(plugin => plugin.id === source.packageId);
            return <SourceRow key={source.id} title={source.title} icon="video" disabled={busy}
              detail={`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${language?.displayName ?? 'Language package unavailable'}${source.subtitlePath ? ' · Subtitles' : ''}`}
              progress={source.durationMs > 0 ? source.positionMs / source.durationMs * 100 : undefined}
              onPress={() => resume(source)} />;
          })}
        </View> : null}
      </View>
      <View style={styles.openAnother}><Text variant="section" accessibilityRole="header">Open another source</Text>{openActions}</View>
    </> : null}
  </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'space-between', gap: theme.spacing.medium },
  languages: { width: 220, maxWidth: '100%', minWidth: 0, flexShrink: 1 },
  continuation: (wide: boolean) => ({ flexDirection: wide ? 'row' : 'column', gap: theme.spacing.section, minWidth: 0 }),
  group: { flex: 1, minWidth: 0, gap: theme.spacing.compact },
  empty: { maxWidth: 640, gap: theme.spacing.medium, paddingVertical: theme.spacing.section },
  feedback: { alignItems: 'flex-start', gap: theme.spacing.small },
  openAnother: { alignItems: 'flex-start', gap: theme.spacing.medium,
    paddingTop: theme.spacing.large, borderTopWidth: 1, borderColor: theme.colors.border },
}));
