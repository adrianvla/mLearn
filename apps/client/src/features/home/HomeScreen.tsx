import { useCallback, useRef, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { AppShell, Panel, Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import { Icon } from '@mlearn/ui/icon';
import { Select } from '@mlearn/ui/select';
import { logoSource } from '@mlearn/ui/brand';
import { useUnistyles } from 'react-native-unistyles';
import type { SourceRecord, Snapshot } from '@mlearn/contracts';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
export function HomeScreen() {
    const busyRef = useRef(false);
    const host = useRuntime();
    const { width } = useWindowDimensions();
    const { theme } = useUnistyles();
    const router = useRouter();
    const [opening, setOpening] = useState(false);
    const [sources, setSources] = useState<SourceRecord[]>([]);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [selected, setSelected] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function refresh() {
        if (!host.available)
            return;
        const [s, r] = await Promise.all([host.client.snapshot(), host.client.recentSources()]);
        setSnapshot(s);
        setSources(r);
        setSelected(value => value || s.installedPlugins.find(p => p.capabilities.includes('text.analyze.v1'))?.id || '');
    }
    useFocusEffect(useCallback(() => {
        let active = true;
        if (host.available)
            Promise.all([host.client.snapshot(), host.client.recentSources()]).then(([s, r]) => {
                if (active) {
                    setSnapshot(s);
                    setSources(r);
                    setSelected(value => value || s.installedPlugins.find(p => p.capabilities.includes('text.analyze.v1'))?.id || '');
                }
            }).catch(e => {
                if (active)
                    setError(e.message);
            });
        return () => { active = false; };
    }, [host]));
    async function action(fn: () => Promise<void>) {
        if (busyRef.current)
            return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            await fn();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            busyRef.current = false;
            setBusy(false);
        }
    }
    useFocusEffect(useCallback(() => {
        if (!host.available || !host.media.subscribeDrop)
            return;
        let active = true;
        let stop: (() => void) | undefined;
        host.media.subscribeDrop(paths => {
            if (!active)
                return;
            if (paths.length !== 1) {
                setError('Drop one video at a time.');
                return;
            }
            if (!selected) {
                setError('Select a language package before opening the dropped video.');
                return;
            }
            void action(async () => { const opened = await host.client.openSource(paths[0], selected); router.push({
                pathname: '/watch', params: {
                    id: opened.source.id
                }
            }); });
        }).then(unsubscribe => {
            if (active)
                stop = unsubscribe;
            else
                unsubscribe();
        }).catch(e => {
            if (active)
                setError(e.message);
        });
        return () => { active = false; stop?.(); };
    }, [host, selected]));
    async function open() {
        if (!host.available)
            return;
        setOpening(true);
        try {
            const path = await host.media.pick(false);
            if (!path)
                return;
            let opened;
            try {
                opened = await host.client.openSource(path, selected);
            }
            finally {
                await host.media.releasePicked(path);
            }
            router.push({
                pathname: '/watch', params: {
                    id: opened.source.id
                }
            });
        }
        finally {
            setOpening(false);
        }
    }
    const languages = snapshot?.installedPlugins.filter(p => p.capabilities.includes('text.analyze.v1')) ?? [];
    return <AppShell header={<>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={logoSource} style={styles.logo} accessibilityLabel="mLearn Logo" />
          <Text variant="shellTitle" accessibilityRole="header" accessibilityLabel="Home">mLearn</Text>
        </View>
        <View style={styles.languages}><Select label="Source language" value={selected}
          options={languages.map(p => ({ value: p.id, label: p.displayName ?? p.id, testID: `language-${p.id}` }))}
          onValueChange={setSelected} disabled={busy} placeholder="Source language" /></View>
      </View>
      <Row>
        <Button label="Settings" icon="settings" size="compact" variant="quiet" onPress={() => router.push('/settings')} />
        <Button label="Get language packages" icon="package" size="compact" variant="quiet"
          onPress={() => router.push({ pathname: '/settings', params: { section: 'languages' } })} />
      </Row>
    </>}>
      {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : <>
        {snapshot?.packageIssues?.length ? <Text accessibilityRole="alert">Some language packages are unavailable. Open Settings to repair them; other installed packages remain usable.</Text> : null}
        <View style={styles.activities}>
        <View style={styles.activity(width < 700)}>
        <Panel>
          <View style={styles.activityHeader}>
            <View style={styles.icon}><Icon name="video" size={22} color={theme.colors.text} /></View>
            <View style={styles.activityText}>
              <Text variant="section" accessibilityRole="header">Watch</Text>
              <Text variant="caption" muted>Watch with subtitles and contextual lookup.</Text>
            </View>
          </View>
          <View style={styles.preview}>
            <Icon name="play" size={32} color={theme.colors.muted} />
            <Button label="Open local video" variant="quiet" disabled={busy || !selected} busy={busy} onPress={() => void action(open)} />
          </View>
          <Row>
            {opening ? <Button label="Cancel opening" variant="secondary" onPress={() => {
              if (host.available) void host.client.cancelSourceOpen().catch(e => setError(e.message));
            }} /> : null}
          </Row>
          {!selected ? <Text muted>Install a language package before opening a source.</Text> : null}
          {error ? <>
            <Text accessibilityRole="alert">{error}</Text>
            <Row><Button label="Retry sources" variant="secondary" disabled={busy} onPress={() => void action(refresh)} /></Row>
          </> : null}
        </Panel>
        </View>
        </View>
        <View style={styles.recents}>
          <Text variant="section" accessibilityRole="header">Recent sources</Text>
          <View style={styles.sourceGrid}>{sources.length ? sources.map(source => {
            const language = languages.find(p => p.id === source.packageId);
            const seconds = Math.floor(source.positionMs / 1000);
            return <View key={source.id} style={styles.sourceCell(width < 800)}><Panel>
              <View style={styles.sourceRow}>
              <View style={styles.sourceIcon}><Icon name="video" size={24} color={theme.colors.muted} /></View>
              <View style={styles.sourceText}>
                <Text selectable numberOfLines={2}>{source.title}</Text>
                <Text muted variant="caption">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · {language ? language.displayName ?? 'Language name unavailable' : 'Language package unavailable'}{source.subtitlePath ? ' · Subtitles' : ''}</Text>
              </View>
              <Button label="Resume" icon="play" size="compact" accessibilityLabel={`Resume ${source.title}`} variant="secondary" disabled={busy}
                onPress={() => {
                  if (process.env.EXPO_PUBLIC_MLEARN_METRICS === '1')
                    console.info(`annotation-ui phase=resume_action timestamp_ms=${Date.now()}`);
                  router.push({ pathname: '/watch', params: { id: source.id } });
                }} />
            </View></Panel></View>;
          }) : <Text muted>No recent sources. Open a local video to begin.</Text>}</View>
        </View>
      </>}
    </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium },
  brand: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.compact },
  logo: { width: 28, height: 28 },
  languages: { width: 300, maxWidth: '100%', flexShrink: 1, minWidth: 0 },
  activities: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.comfortable },
  activity: (compact: boolean) => ({ width: compact ? '100%' : '32%', minWidth: 260, maxWidth: '100%' }),
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.compact },
  activityText: { flex: 1, minWidth: 0 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius, backgroundColor: theme.controls.surface },
  preview: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.small, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius, backgroundColor: theme.controls.surface },
  recents: { gap: theme.spacing.compact },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.compact },
  sourceCell: (compact: boolean) => ({ width: compact ? '100%' : '49%', minWidth: 0 }),
  sourceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.compact },
  sourceIcon: { alignItems: 'center', justifyContent: 'center', width: 40, height: 40 },
  sourceText: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
}));
