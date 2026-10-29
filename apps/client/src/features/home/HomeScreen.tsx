import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { AppShell, Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import { ActivityCard } from '@mlearn/ui/activity-card';
import { SourceRow } from '@mlearn/ui/source-row';
import { Select } from '@mlearn/ui/select';
import { Progress } from '@mlearn/ui/progress';
import { logoSource } from '@mlearn/ui/brand';
import { useUnistyles } from 'react-native-unistyles';
import type { DocumentRecord, SourceRecord, Snapshot } from '@mlearn/contracts';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { useSourceImport } from '../source-entry';
export function HomeScreen() {
    const host = useRuntime();
    const { width } = useWindowDimensions();
    const { theme } = useUnistyles();
    const router = useRouter();
    const [sources, setSources] = useState<SourceRecord[]>([]);
    const [documents, setDocuments] = useState<DocumentRecord[]>([]);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [selected, setSelected] = useState('');
    const [error, setError] = useState('');
    const sourceImport = useSourceImport(selected);
    const busy = sourceImport.busy;
    const [contentWidth, setContentWidth] = useState(0);
    async function refresh() {
        if (!host.available)
            return;
        const [s, r, d] = await Promise.all([host.client.snapshot(), host.client.recentSources(), host.client.recentDocuments()]);
        setSnapshot(s);
        setSources(r);
        setDocuments(d);
        setSelected(value => value || s.installedPlugins.find(p => p.capabilities.includes('text.analyze.v1'))?.id || '');
    }
    useFocusEffect(useCallback(() => {
        let active = true;
        if (host.available)
            Promise.all([host.client.snapshot(), host.client.recentSources(), host.client.recentDocuments()]).then(([s, r, d]) => {
                if (active) {
                    setSnapshot(s);
                    setSources(r);
                    setDocuments(d);
                    setSelected(value => value || s.installedPlugins.find(p => p.capabilities.includes('text.analyze.v1'))?.id || '');
                }
            }).catch(e => {
                if (active)
                    setError(e.message);
            });
        return () => {
            active = false;
        };
    }, [host]));
    const languages = snapshot?.installedPlugins.filter(p => p.capabilities.includes('text.analyze.v1')) ?? [];
    const latestSource = sources[0];
    const columns = width <= 550 ? 1 : width <= 950 ? 2 : 3;
    const availableWidth = contentWidth || Math.min(1184, width - 48);
    const activityWidth = (availableWidth - theme.spacing.comfortable * (columns - 1)) / columns;
    const recentWidth = width <= 800 ? availableWidth : (availableWidth - theme.spacing.compact) / 2;
    function resume(source: SourceRecord) {
      if (process.env.EXPO_PUBLIC_MLEARN_METRICS === '1')
        console.info(`annotation-ui phase=resume_action timestamp_ms=${Date.now()}`);
      router.push({ pathname: '/watch', params: { id: source.id } });
    }
    return <AppShell header={<>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={logoSource} style={styles.logo} accessibilityLabel="mLearn Logo" />
          <Text variant="shellTitle" accessibilityRole="header" accessibilityLabel="Home">mLearn</Text>
        </View>
        <View style={styles.languages}><Select label="Source language" testID="source-language-select" value={selected}
          options={languages.map(p => ({ value: p.id, label: p.displayName ?? p.id, testID: `language-${p.id}` }))}
          onValueChange={setSelected} disabled={busy} placeholder="Source language" /></View>
      </View>
      <Row>
        <Button label="Settings" icon="settings" size="compact" variant="quiet" onPress={() => router.push('/settings')} />
        <Button label="Knowledge" size="compact" variant="quiet"
          onPress={() => router.navigate({ pathname: '/knowledge', params: { packageId: selected } })} />
        <Button label="Material" size="compact" variant="quiet" onPress={() => router.navigate('/materials')} />
        <Button label="Get language packages" icon="package" size="compact" variant="quiet"
          onPress={() => router.push({ pathname: '/settings', params: { section: 'languages' } })} />
      </Row>
    </>}>
      {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : null}
        {snapshot?.packageIssues?.length ? <Text accessibilityRole="alert">Some language packages are unavailable. Open Settings to repair them; other installed packages remain usable.</Text> : null}
        <View style={styles.activities} onLayout={event => setContentWidth(event.nativeEvent.layout.width)}>
        <View testID="home-read-activity" style={styles.activity(activityWidth)}>
        <ActivityCard title="Read" testID="home-open-read" icon="book" description="Read and look up language in context."
          disabled={busy || !selected} onPress={() => router.push({ pathname: '/reader', params: { packageId: selected } })}>
          {documents[0] ? <Button label={documents[0].title} accessibilityLabel={`Continue ${documents[0].title}`}
            variant="sourcePreview" disabled={busy} onPress={() => {
              const source = documents[0];
              if (source) router.push({ pathname: '/reader', params: { id: source.id } });
            }} /> : <Button label="Open or import material" accessibilityLabel="Open document entry"
              variant="sourcePreview" disabled={busy || !selected}
              onPress={() => router.push({ pathname: '/reader', params: { packageId: selected } })} />}
        </ActivityCard>
        </View>
        <View testID="home-watch-activity" style={styles.activity(activityWidth)}>
        <ActivityCard title="Watch" testID="home-open-watch" icon="video" description="Watch with subtitles and contextual lookup."
          disabled={busy || !selected} onPress={() => router.push({ pathname: '/watch', params: { packageId: selected } })}>
          {latestSource ? <View style={styles.preview}>
              <Button label={`Continue ${latestSource.title}`} icon="play" iconOnly variant="preview"
                disabled={busy} onPress={() => resume(latestSource)} />
              <View style={styles.previewFooter}>
                <View style={styles.previewTitle}><Text variant="detail" numberOfLines={1}>{latestSource.title}</Text></View>
                {latestSource.durationMs > 0 ? <Progress label={`Continue ${latestSource.title} progress`}
                  value={latestSource.positionMs / latestSource.durationMs * 100} style={styles.previewProgress} /> : null}
              </View>
          </View> : <Button label="Open or import material" accessibilityLabel="Open video entry" icon="play"
            variant="sourcePreview" disabled={busy || !selected}
            onPress={() => router.push({ pathname: '/watch', params: { packageId: selected } })} />}
        </ActivityCard>
        </View>
        <View testID="home-conversation-activity" style={styles.activity(activityWidth)}>
        <ActivityCard title="Messenger" icon="conversation" description="Continue your conversations."
          onPress={() => router.push('../messenger')}>
          <Row>
            <Button testID="home-open-conversation" label="Conversation" variant="quiet" size="compact" onPress={() => router.push('../messenger')} />
          </Row>
        </ActivityCard>
        </View>
        <View testID="home-review-activity" style={styles.activity(activityWidth)}>
        <ActivityCard title="Review" accessibilityLabel="Open Review" icon="book" onPress={() => router.push('../review')}>
          <Row>
            <Button testID="home-open-review" label="Review" variant="quiet" size="compact" onPress={() => router.push('../review')} />
          </Row>
        </ActivityCard>
        </View>
        </View>
        {sourceImport.opening ? <Row>
          <Text accessibilityLiveRegion="polite">Opening dropped source…</Text>
          <Button label="Cancel opening" variant="secondary" onPress={sourceImport.cancel} />
        </Row> : null}
        {sourceImport.error ? <Text accessibilityRole="alert">{sourceImport.error}</Text> : null}
        {error ? <>
          <Text accessibilityRole="alert">{error}</Text>
          <Button label="Retry sources" variant="secondary" disabled={busy}
            onPress={() => void refresh().then(() => setError('')).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))} />
        </> : null}
        {host.available ? <>
        {documents.length ? <View style={styles.recents}>
          <Text variant="section" accessibilityRole="header">Recent documents</Text>
          <View style={styles.sourceList}>{documents.map(source => <View key={source.id} style={styles.recent(recentWidth)}>
            <SourceRow title={source.title} icon="book" disabled={busy}
              detail={`${source.format.toUpperCase()} · ${languages.find(language => language.id === source.packageId)?.displayName ?? source.packageId}${source.position ? ` · ${source.position.resource} · byte ${source.position.offset}` : ''}`}
              onPress={() => router.push({ pathname: '../reader', params: { id: source.id } })} />
          </View>)}</View>
        </View> : null}
        <View style={styles.recents}>
          <Text variant="section" accessibilityRole="header">Recent sources</Text>
          <View style={styles.sourceList}>{sources.length ? sources.map(source => {
            const language = languages.find(p => p.id === source.packageId);
            const seconds = Math.floor(source.positionMs / 1000);
            return <View key={source.id} style={styles.recent(recentWidth)}>
              <SourceRow title={source.title} icon="video" disabled={busy}
                detail={`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${language ? language.displayName ?? 'Language name unavailable' : 'Language package unavailable'}${source.subtitlePath ? ' · Subtitles' : ''}`}
                progress={source.durationMs > 0 ? source.positionMs / source.durationMs * 100 : undefined}
                onPress={() => resume(source)} />
            </View>;
          }) : <Text muted>No recent sources. Open a local video to begin.</Text>}</View>
        </View>
        </> : null}
    </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium },
  brand: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.compact },
  logo: { width: 28, height: 28 },
  languages: { width: 300, maxWidth: '100%', flexShrink: 1, minWidth: 0 },
  activities: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.comfortable, marginTop: theme.spacing.compact },
  activity: (width: number) => ({ width, minWidth: 0, maxWidth: '100%' }),
  preview: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.small, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius, backgroundColor: theme.surfaces.glass, overflow: 'hidden',
    _web: { boxShadow: `inset 0 0 0 1px ${theme.colors.border}` } },
  previewFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: theme.spacing.tiny,
    paddingHorizontal: theme.spacing.small, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small,
    borderTopWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.controls.field },
  previewTitle: { flex: 1, minWidth: 0 },
  previewProgress: { flex: 1 },
  recents: { gap: theme.spacing.compact },
  sourceList: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.compact },
  recent: (width: number) => ({ width, maxWidth: '100%', minWidth: 0 }),
}));
