import { useCallback, useRef, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Screen, Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import type { SourceRecord, Snapshot } from '@mlearn/contracts';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
export function HomeScreen() {
    const busyRef = useRef(false);
    const host = useRuntime();
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
    return <Screen>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">Home</Text>
        <Button label="Settings" variant="quiet" onPress={() => router.push('/settings')} />
      </View>
      {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : <>
        {snapshot?.packageIssues?.length ? <Text accessibilityRole="alert">Some language packages are unavailable. Open Settings to repair them; other installed packages remain usable.</Text> : null}
        <View style={styles.entry}>
          <Text variant="section" accessibilityRole="header">Watch</Text>
          <Text variant="caption" muted>Source language</Text>
          <Row>{languages.map(p => <Button key={p.id}
            testID={`language-${p.id}`}
            label={`${selected === p.id ? '✓ ' : ''}${p.displayName ?? p.id}`}
            accessibilityLabel={p.displayName ?? p.id}
            accessibilityState={{ selected: selected === p.id }}
            variant="secondary" disabled={busy} onPress={() => setSelected(p.id)} />)}</Row>
          <Row>
            <Button label="Open local video" disabled={busy || !selected} busy={busy} onPress={() => void action(open)} />
            <Button label="Get language packages" variant="quiet"
              onPress={() => router.push({ pathname: '/settings', params: { section: 'languages' } })} />
            {opening ? <Button label="Cancel opening" variant="secondary" onPress={() => {
              if (host.available) void host.client.cancelSourceOpen().catch(e => setError(e.message));
            }} /> : null}
          </Row>
          {!selected ? <Text muted>Install a language package before opening a source.</Text> : null}
          {error ? <>
            <Text accessibilityRole="alert">{error}</Text>
            <Row><Button label="Retry sources" variant="secondary" disabled={busy} onPress={() => void action(refresh)} /></Row>
          </> : null}
        </View>
        <View style={styles.recents}>
          <Text variant="section" accessibilityRole="header">Recent sources</Text>
          {sources.length ? sources.map(source => {
            const language = languages.find(p => p.id === source.packageId);
            const seconds = Math.floor(source.positionMs / 1000);
            return <View key={source.id} style={styles.sourceRow}>
              <View style={styles.sourceText}>
                <Text selectable numberOfLines={2}>{source.title}</Text>
                <Text muted variant="caption">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · {language ? language.displayName ?? 'Language name unavailable' : 'Language package unavailable'}{source.subtitlePath ? ' · Subtitles' : ''}</Text>
              </View>
              <Button label="Resume" accessibilityLabel={`Resume ${source.title}`} variant="secondary" disabled={busy}
                onPress={() => router.push({ pathname: '/watch', params: { id: source.id } })} />
            </View>;
          }) : <Text muted>No recent sources. Open a local video to begin.</Text>}
        </View>
      </>}
    </Screen>;
}

const styles = StyleSheet.create(theme => ({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium },
  entry: { gap: theme.spacing.compact, paddingVertical: theme.spacing.medium },
  recents: { gap: theme.spacing.small },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.medium, paddingVertical: theme.spacing.medium, borderBottomWidth: 1, borderColor: theme.colors.border },
  sourceText: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
}));
