import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View, Text as NativeText } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Row } from '@mlearn/ui/layout';
import type { SourceWindow, AnalysisBatch } from '@mlearn/contracts';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { MediaSurface } from '../../bootstrap/MediaSurface';
import { AnnotatedText } from '../annotated-text';
import { Inspector, type Inspection } from '../inspector';
export function WatchScreen() {
    const host = useRuntime();
    const router = useRouter();
    const params = useLocalSearchParams<{
        id: string;
    }>();
    const id = typeof params.id === 'string' ? params.id : '';
    const insets = useSafeAreaInsets();
    const [subtitleInset, setSubtitleInset] = useState(128);
    const [toolbarHeight, setToolbarHeight] = useState(64);
    const [window, setWindow] = useState<SourceWindow | null>(null);
    const [batch, setBatch] = useState<AnalysisBatch | null>(null);
    const [position, setPosition] = useState(0);
    const [inspection, setInspection] = useState<Inspection | null>(null);
    const [error, setError] = useState('');
    const [analysisError, setAnalysisError] = useState('');
    const [saveError, setSaveError] = useState('');
    const [busy, setBusy] = useState(false);
    const [sourceReload, setSourceReload] = useState(0);
    const [analysisReload, setAnalysisReload] = useState(0);
    const latest = useRef({
        position: 0, duration: 0
    });
    const lastSaved = useRef(0);
    const mounted = useRef(true);
    const saveFailed = useRef(false);
    const controller = useRef<{
        pauseAndRead: () => {
            positionMs: number;
            durationMs: number;
        };
    } | null>(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        if (!host.available)
            return;
        let active = true;
        let pending = true;
        setError('');
        host.client.resumeSource(id).then(w => {
            pending = false;
            if (active) {
                setWindow(w);
                setPosition(w.source.positionMs);
                latest.current = {
                    position: w.source.positionMs, duration: w.source.durationMs
                };
            }
        }).catch(e => {
            pending = false;
            if (active)
                setError(e.message);
        });
        return () => {
            active = false;
            if (pending)
                void host.client.cancelSourceOpen().catch(() => { });
        };
    }, [host, id, sourceReload]);
    const bucket = Math.floor(position / 2000);
    const cues = window?.cues.filter(c => c.startMs <= position && c.endMs > position) ?? [];
    const cueKey = cues.map(c => c.index).join(',');
    const ready = !!window;
    const subtitleRevision = window?.source.subtitleRevision;
    useEffect(() => {
        if (!host.available || !ready || !subtitleRevision)
            return;
        let active = true;
        // Raw cue navigation must remain usable when the optional linguistic read fails.
        // The client bounds its serial queue; each seek owns its own stale-publication guard.
        void host.client.sourceWindow(id, latest.current.position).then(w => {
            if (active)
                setWindow(w);
        }).catch(e => {
            if (active)
                setError(e.message);
        });
        void host.client.analyzeSource(id, latest.current.position).then(b => {
            if (active) {
                setBatch(b);
                setAnalysisError('');
            }
        }).catch(e => {
            if (active) {
                setBatch(null);
                setAnalysisError(e.message);
            }
        });
        return () => { active = false; };
    }, [host, id, ready, subtitleRevision, bucket, cueKey, analysisReload]);
    async function persist(positionMs = latest.current.position, durationMs = latest.current.duration) {
        if (!host.available || !Number.isFinite(durationMs) || durationMs <= 0)
            return;
        try {
            await host.client.savePosition(id, Math.min(positionMs, durationMs), durationMs);
            saveFailed.current = false;
            if (mounted.current)
                setSaveError('');
        }
        catch (e) {
            saveFailed.current = true;
            if (mounted.current)
                setSaveError(e instanceof Error ? e.message : String(e));
            throw e;
        }
    }
    function progress(positionMs: number, durationMs: number, checkpoint: boolean) {
        latest.current = {
            position: positionMs, duration: durationMs
        };
        if (mounted.current) {
            setPosition(positionMs);
            if (checkpoint)
                setAnalysisReload(v => v + 1);
        }
        if (!saveFailed.current && (checkpoint || Date.now() - lastSaved.current > 2000)) {
            lastSaved.current = Date.now();
            void persist(positionMs, durationMs).catch(() => { });
        }
    }
    async function pauseAndSave() {
        const point = controller.current?.pauseAndRead();
        if (point) {
            latest.current = {
                position: point.positionMs, duration: point.durationMs
            };
            setPosition(point.positionMs);
        }
        await persist();
    }
    async function back() {
        setBusy(true);
        try {
            await pauseAndSave();
            router.back();
        }
        finally {
            setBusy(false);
        }
    }
    async function attach(droppedPath?: string) {
        if (!host.available)
            return;
        setBusy(true);
        setError('');
        try {
            await pauseAndSave();
            const path = droppedPath ?? await host.media.pick(true);
            if (path) {
                let w;
                try {
                    w = await host.client.attachSubtitles(id, path);
                }
                finally {
                    await host.media.releasePicked(path);
                }
                setWindow(w);
                setBatch(null);
                if (!window)
                    setSourceReload(v => v + 1);
                setAnalysisReload(v => v + 1);
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    }
    useFocusEffect(useCallback(() => {
        if (!host.available || !host.media.subscribeDrop || !window)
            return;
        let active = true;
        let stop: (() => void) | undefined;
        host.media.subscribeDrop(paths => {
            if (!active || busy)
                return;
            if (paths.length !== 1) {
                setError('Drop one video or subtitle file at a time.');
                return;
            }
            const path = paths[0];
            if (path.toLowerCase().endsWith('.srt')) {
                void attach(path);
                return;
            }
            setBusy(true);
            setError('');
            void (async () => {
                try {
                    await pauseAndSave();
                    const opened = await host.client.openSource(path, window.source.packageId);
                    router.replace({
                        pathname: '/watch', params: {
                            id: opened.source.id
                        }
                    });
                }
                catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                }
                finally {
                    setBusy(false);
                }
            })();
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
    }, [host, id, !!window, window?.source.packageId, busy]));
    async function refreshKnowledge() {
        if (!host.available)
            return;
        const b = await host.client.analyzeSource(id, latest.current.position);
        if (mounted.current)
            setBatch(b);
    }
    return (
        <View style={styles.screen(insets.top, insets.bottom)}>
            <View style={[styles.toolbar, { top: insets.top }]} onLayout={event => setToolbarHeight(event.nativeEvent.layout.height)}>
                <Row>
                    <Button label="← Home" accessibilityLabel="Home" size="compact" variant="media"
                        disabled={busy} onPress={() => void back().catch(() => {})} />
                    <NativeText numberOfLines={1} style={styles.title}>
                        {window?.source.title ?? 'Watch'}
                    </NativeText>
                    {busy && host.available ? (
                        <Button label="Cancel opening" variant="secondary"
                            onPress={() => void host.client.cancelSourceOpen().catch(e => setError(e.message))} />
                    ) : null}
                    {window ? (
                        <Button label={window.source.subtitlePath ? 'Replace subtitles' : 'Open subtitles'}
                            size="compact" variant="media" disabled={busy} onPress={() => void attach()} />
                    ) : null}
                </Row>
                {error ? <>
                    <Text tone="media" accessibilityRole="alert">{error}</Text>
                    <Row>
                        <Button label="Retry source" variant="secondary" onPress={() => setSourceReload(v => v + 1)} />
                        <Button label="Reselect subtitles" variant="secondary" disabled={busy} onPress={() => void attach()} />
                        <Button label="Reselect from Home" variant="secondary" onPress={() => router.replace('/')} />
                    </Row>
                </> : null}
                {saveError ? <>
                    <Text tone="media" accessibilityRole="alert">Progress not saved: {saveError}</Text>
                    <Button label="Retry saving position" variant="secondary" onPress={() => void persist().catch(() => {})} />
                </> : null}
            </View>
            {window && host.available ? <>
                <View style={styles.stage}>
                    <MediaSurface key={window.source.id} uri={host.media.uri(window.source)}
                        initialPositionMs={window.source.positionMs} paused={!!inspection || busy}
                        onController={value => {
                            controller.current = value;
                            setSubtitleInset(value.subtitleBottomInset);
                        }}
                        onProgress={progress} onError={setError} />
                    <View pointerEvents="box-none" style={[styles.subtitle, {
                        bottom: subtitleInset + 24,
                        opacity: Platform.OS !== 'web' && inspection ? 0 : 1,
                    }]}>
                        {cues.map(cue => {
                            const analysis = batch?.subtitleRevision === window.source.subtitleRevision
                                ? batch.cues.find(a => a.cue.index === cue.index) : null;
                            return (
                                <AnnotatedText key={cue.index} rawText={cue.text} analysis={analysis ?? null}
                                    annotations={batch?.annotations ?? []}
                                    onInspect={(token, anchor) => {
                                        void pauseAndSave().catch(() => {});
                                        setInspection({ sourceForm: token.text, context: cue.text, targets: token.targets, anchor });
                                    }} />
                            );
                        })}
                    </View>
                </View>
                <View pointerEvents="box-none"
                    style={[styles.status, { top: insets.top + toolbarHeight + 8 }, (!window.source.subtitlePath || analysisError) ? styles.feedback : null]}>
                    {!window.source.subtitlePath ? <Text tone="media">Open a plain UTF-8 SRT file to inspect subtitles.</Text> : null}
                    {analysisError ? <>
                        <Text tone="media" accessibilityRole="alert">{analysisError}</Text>
                        <Button label="Retry analysis" variant="secondary" onPress={() => setAnalysisReload(v => v + 1)} />
                    </> : null}
                </View>
                {inspection ? (
                    <Inspector inspection={inspection} packageId={window.source.packageId} client={host.client}
                        knowledge={batch?.knowledge ?? []} onChanged={refreshKnowledge}
                        onClose={() => {
                            const anchor = inspection.anchor;
                            setInspection(null);
                            anchor.restoreFocus();
                        }} />
                ) : null}
            </> : !error ? <Text tone="media">Opening source…</Text> : null}
        </View>
    );
}
const styles = StyleSheet.create(theme => ({
    screen: (top: number, bottom: number) => ({
        flex: 1, paddingTop: top, paddingBottom: bottom, backgroundColor: theme.media.background
    }), toolbar: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, paddingHorizontal: 16, paddingVertical: 8, gap: 8, backgroundColor: theme.media.chrome
    }, title: {
        flex: 1, flexBasis: 120, minWidth: 0, color: theme.media.text, fontSize: 13 * theme.textScale
    }, stage: {
        flex: 1, minHeight: 240, backgroundColor: theme.media.background
    }, subtitle: {
        position: 'absolute', left: 20, right: 20, bottom: 64, alignItems: 'center'
    }, status: {
        position: 'absolute', top: 80, left: 16, right: 16, gap: 8
    }, feedback: {
        padding: 12, borderRadius: theme.radius, backgroundColor: theme.media.chrome
    }
}));
