import { useCallback, useRef, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Screen, Stack, Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import type { SourceRecord, PluginSummary, Snapshot } from '@mlearn/contracts';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
export function HomeScreen() {
    const busyRef = useRef(false);
    const host = useRuntime();
    const router = useRouter();
    const [opening, setOpening] = useState(false);
    const [sources, setSources] = useState<SourceRecord[]>([]);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [selected, setSelected] = useState('');
    const [catalog, setCatalog] = useState<PluginSummary[]>([]);
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
    return <Screen>
    <Row>
    <Text variant="heading">mLearn</Text>
    <Button
        label="Settings"
        variant="secondary"
        onPress={() => router.push('/settings')}/></Row>
  {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : <>
   <Text variant="heading">Watch</Text>
    <Row>{snapshot?.installedPlugins.filter(p => p.capabilities.includes('text.analyze.v1')).map(p => <Button
          key={p.id}
          label={p.id}
          accessibilityState={{
            selected: selected === p.id
        }}
          variant={selected === p.id ? 'primary' : 'secondary'}
          disabled={busy}
          onPress={() => setSelected(p.id)}/>)}</Row>
   <Button
        label="Open local video"
        disabled={busy || !selected}
        busy={busy}
        onPress={() => void action(open)}/>
   {opening ? <Button
        label="Cancel opening"
        variant="secondary"
        onPress={() => {
                    if (host.available)
                        void host.client.cancelSourceOpen().catch(e => setError(e.message));
                }}/> : null}
   {!selected ? <Text>Install a language package before opening a source.</Text> : null}<>
    <Button
          label="Get language packages"
          disabled={busy}
          onPress={() => void action(async () => setCatalog((await host.client.availablePackages()).filter(p => p.capabilities.includes('text.analyze.v1'))))}/>{catalog.map(p => <Button
          key={p.id}
          label={`Install ${p.id}`}
          disabled={busy}
          onPress={() => void action(async () => { await host.client.installPlugin(p.id); await refresh(); })}/>)}</>
   {error ? <>
    <Text accessibilityRole="alert">{error}</Text>
    <Button
          label="Retry sources"
          variant="secondary"
          disabled={busy}
          onPress={() => void action(refresh)}/></> : null}
   <Text variant="heading">Recent sources</Text>{sources.length ? sources.map(source => <Stack key={source.id}>
    <Button
          label={`Resume ${source.title}`}
          variant="secondary"
          disabled={busy}
          onPress={() => router.push({
            pathname: '/watch', params: {
                id: source.id
            }
        })}/>
    <Text
            muted
            variant="caption">{Math.floor(source.positionMs / 1000)}s · {source.packageId}{source.subtitlePath ? ' · subtitles attached' : ''}</Text></Stack>) : <Text muted>No recent sources.</Text>}
  </>}
 </Screen>;
}
