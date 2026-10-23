import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Row } from '@mlearn/ui/layout';
import { Dialog, dialogSidebarWidth } from '@mlearn/ui/dialog';
import { TextField } from '@mlearn/ui/text-field';
import { Select } from '@mlearn/ui/select';
import type { TextBounds } from '@mlearn/ui/inline-word';
import type { SourceWindow, SourceAnchor, AnalysisBatch, PluginSummary, SubtitleDirection } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { MediaSurface } from '../../bootstrap/MediaSurface';
import { AnnotatedText } from '../annotated-text';
import { Inspector, type Inspection } from '../inspector';
import { Transcript } from './Transcript';
import { LiveWordCards } from './LiveWordCards';
import { MediaOverlay } from '@mlearn/ui/media-overlay';
import { cueAnchor, emptyMaterial, MaterialEditor } from '../material';
type VideoSelection = SourceAnchor & {
    readonly locator: Extract<SourceAnchor['locator'], { kind: 'video' }>;
};
export function WatchScreen() {
    const host = useRuntime();
    const router = useRouter();
    const params = useLocalSearchParams<{
        id: string;
        materialId?: string;
        reviewSessionId?: string;
        reviewEncounterId?: string;
    }>();
    const id = typeof params.id === 'string' ? params.id : '';
    const insets = useSafeAreaInsets();
    const viewport = useWindowDimensions();
    const [subtitleInset, setSubtitleInset] = useState(128);
    const [subtitleHeight, setSubtitleHeight] = useState(0);
    const [toolbarHeight, setToolbarHeight] = useState(64);
    const [overlayHeight, setOverlayHeight] = useState(0);
    const [window, setWindow] = useState<SourceWindow | null>(null);
    const [batch, setBatch] = useState<AnalysisBatch | null>(null);
    const [transcriptBatch, setTranscriptBatch] = useState<AnalysisBatch | null>(null);
    const [position, setPosition] = useState(0);
    const [inspection, setInspection] = useState<Inspection | null>(null);
    const [returnedSelection, setReturnedSelection] = useState<VideoSelection | null>(null);
    const returnedCue = useRef<View>(null);
    const restoredInspection = useRef<SourceAnchor | null>(null);
    const selectedSource = useRef(returnedSelection);
    selectedSource.current = returnedSelection;
    const [error, setError] = useState('');
    const [analysisError, setAnalysisError] = useState('');
    const [analysisPending, setAnalysisPending] = useState(false);
    const analysisStarted = useRef(0);
    useLayoutEffect(() => {
        if (!batch || !analysisStarted.current || process.env.EXPO_PUBLIC_MLEARN_METRICS !== '1') return;
        const started = analysisStarted.current;
        const frame = requestAnimationFrame(() => {
            console.info(`annotation-ui phase=caption_commit timestamp_ms=${Date.now()} request_to_frame_ms=${(performance.now() - started).toFixed(3)} cues=${batch.cues.length}`);
            analysisStarted.current = 0;
        });
        return () => cancelAnimationFrame(frame);
    }, [batch]);
    const [saveError, setSaveError] = useState('');
    const [busy, setBusy] = useState(false);
    const [transcriptOpen, setTranscriptOpen] = useState(false);
    const sidebarInset = transcriptOpen && Platform.OS === 'web' && viewport.width >= 720 ? dialogSidebarWidth : 0;
    const [playbackOpen, setPlaybackOpen] = useState(false);
    const [synchronizationOpen, setSynchronizationOpen] = useState(false);
    const [liveWordsOpen, setLiveWordsOpen] = useState(false);
    const [captureOpen, setCaptureOpen] = useState(false);
    const [subtitleCapture, setSubtitleCapture] = useState<SourceAnchor | null>(null);
    const liveWordTrigger = useRef<View>(null);
    const [offsetDraft, setOffsetDraft] = useState('0');
    const [playbackError, setPlaybackError] = useState('');
    const [languages, setLanguages] = useState<PluginSummary[]>([]);
    const [sourceReload, setSourceReload] = useState(0);
    const [analysisReload, setAnalysisReload] = useState(0);
    const latest = useRef({
        position: 0, duration: 0
    });
    const lastSaved = useRef(0);
    const mounted = useRef(true);
    const session = useRef<ReturnType<RuntimeClient['beginSourceSession']> | null>(null);
    const consumedReturn = useRef('');
    const activeSource = useRef(id);
    const focused = useRef<object | null>(null);
    activeSource.current = id;
    useEffect(() => {
        const node = returnedCue.current;
        if (!node || !returnedSelection || restoredInspection.current === returnedSelection || !batch
            || batch.sourceId !== returnedSelection.sourceId || batch.subtitleRevision !== returnedSelection.locator.subtitleRevision
            || batch.packageId !== returnedSelection.packageId || batch.packageVersion !== returnedSelection.packageVersion) return;
        const cue = batch.cues.find(item => item.cue.index === returnedSelection.locator.cueIndex && item.cue.text === returnedSelection.text);
        const token = cue?.tokens.find(item => item.start === returnedSelection.locator.selectionStart && item.end === returnedSelection.locator.selectionEnd);
        if (!token?.targets.length) return;
        const current = session.current;
        const measure = (publish: (bounds: TextBounds) => void) => node.measureInWindow((x, y, width, height) => {
            if (selectedSource.current === returnedSelection && current?.isCurrent() && returnedCue.current === node) publish({ x, y, width, height });
        });
        measure(bounds => {
            restoredInspection.current = returnedSelection;
            setInspection({ sourceForm: token.text, context: returnedSelection.text, targets: token.targets,
                packageRevision: batch.packageRevision, sourceAnchor: returnedSelection,
                anchor: { ...bounds, measure, restoreFocus: () => node.focus() } });
        });
    }, [batch, returnedSelection]);
    const saveFailed = useRef(false);
    const controller = useRef<{
        seekTo: (positionMs: number) => void;
        pauseAndRead: () => {
            positionMs: number;
            durationMs: number;
        };
    } | null>(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        if (!host.available || !playbackOpen) return;
        let active = true;
        void host.client.snapshot().then(snapshot => {
            if (active) setLanguages(snapshot.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')));
        }).catch((cause: unknown) => {
            if (active) setPlaybackError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => { active = false; };
    }, [host, playbackOpen]);
    useFocusEffect(useCallback(() => {
        if (!host.available)
            return;
        let active = true;
        const owner = {};
        focused.current = owner;
        const current = host.client.beginSourceSession();
        session.current = current;
        setBusy(false);
        setWindow(previous => previous?.source.id === id ? previous : null);
        setBatch(null);
        setInspection(null);
        setReturnedSelection(null);
        setTranscriptOpen(false);
        setTranscriptBatch(null);
        setPlaybackOpen(false);
        setSynchronizationOpen(false);
        setLiveWordsOpen(false);
        setCaptureOpen(false);
        setSubtitleCapture(null);
        void current.ready.then(async () => {
            if (typeof params.reviewSessionId === 'string' && typeof params.reviewEncounterId === 'string') {
                const restored = await host.client.returnReviewSource(params.reviewSessionId, params.reviewEncounterId);
                if (restored.type !== 'material_source' || restored.window.source.id !== id
                    || restored.anchor.locator.kind !== 'video')
                    throw new Error('This Review encounter does not return to the selected video.');
                if (active && current.isCurrent())
                    setReturnedSelection({ ...restored.anchor, locator: restored.anchor.locator });
                return restored.window;
            }
            if (typeof params.materialId === 'string' && consumedReturn.current !== params.materialId) {
                const restored = await host.client.returnMaterialSource(params.materialId);
                if (restored.type !== 'material_source') {
                    if (active && current.isCurrent()) {
                        router.replace({ pathname: '../reader', params: {
                            id: restored.window.source.id, materialId: params.materialId,
                        } });
                    }
                    return null;
                }
                if (restored.anchor.locator.kind !== 'video') {
                    throw new Error('The returned source is not a video location.');
                }
                if (active && current.isCurrent()) {
                    consumedReturn.current = params.materialId;
                    setReturnedSelection({ ...restored.anchor, locator: restored.anchor.locator });
                }
                return restored.window;
            }
            return host.client.resumeSource(id);
        }).then(w => {
            if (!w) return;
            if (active && current.isCurrent()) {
                setWindow(w);
                setPosition(w.source.positionMs);
                // Focus clears the batch even when the retained source has the
                // same revision, cues and position. Reanalyze after admission.
                setAnalysisReload(value => value + 1);
                latest.current = {
                    position: w.source.positionMs, duration: w.source.durationMs
                };
            }
        }).catch(e => {
            if (active && current.isCurrent())
                setError(e.message);
        });
        return () => {
            active = false;
            setLiveWordsOpen(false);
            if (focused.current === owner) focused.current = null;
            const owned = session.current;
            void owned?.cancel().catch(e => {
                if (mounted.current && session.current === owned)
                    setError(e instanceof Error ? e.message : String(e));
            });
        };
    }, [host, id, params.materialId, params.reviewSessionId, params.reviewEncounterId, sourceReload]));
    const bucket = Math.floor(position / 2000);
    const subtitleTime = position + (window?.source.subtitleOffsetMs ?? 0);
    const cues = window?.cues.filter(c => c.startMs <= subtitleTime && c.endMs > subtitleTime) ?? [];
    const cueKey = cues.map(c => c.index).join(',');
    const ready = window?.source.id === id;
    const subtitleRevision = window?.source.subtitleRevision;
    const subtitleOffset = window?.source.subtitleOffsetMs;
    const packageId = window?.source.packageId;
    const packageVersion = window?.source.packageVersion;
    useEffect(() => {
        if (!host.available || !ready || !window || !subtitleRevision || transcriptOpen)
            return;
        let active = true;
        const current = session.current;
        const source = window.source;
        void host.client.sourceWindow(id, latest.current.position).then(w => {
            if (active && current?.isCurrent() && w.source.id === source.id &&
                w.source.subtitleRevision === source.subtitleRevision &&
                w.source.packageId === source.packageId && w.source.packageVersion === source.packageVersion)
                setWindow(w);
        }).catch(e => {
            if (active && current?.isCurrent() && e.code !== 'cancelled')
                setError(e.message);
        });
        return () => { active = false; };
    }, [host, id, ready, subtitleRevision, subtitleOffset, packageId, packageVersion, bucket, cueKey, sourceReload, transcriptOpen]);
    useEffect(() => {
        if (!host.available || !ready || !window || !subtitleRevision || transcriptOpen)
            return;
        let active = true;
        const current = session.current;
        const source = window.source;
        setAnalysisPending(true);
        analysisStarted.current = performance.now();
        void host.client.analyzeSource(id, latest.current.position).then(b => {
            if (active && current?.isCurrent() && b.sourceId === source.id &&
                b.subtitleRevision === source.subtitleRevision &&
                b.packageId === source.packageId && b.packageVersion === source.packageVersion) {
                setBatch(b);
                setAnalysisError('');
            }
        }).catch(e => {
            if (active && current?.isCurrent() && e.code !== 'cancelled') {
                setBatch(null);
                setAnalysisError(e.message);
            }
        }).finally(() => { if (active) setAnalysisPending(false); });
        return () => { active = false; setAnalysisPending(false); };
    }, [host, id, ready, subtitleRevision, subtitleOffset, packageId, packageVersion, bucket, cueKey, analysisReload, sourceReload, transcriptOpen]);
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
        if (activeSource.current !== id || !session.current?.isCurrent())
            return;
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
    async function changeSource(operation: (client: RuntimeClient) => Promise<SourceWindow>, reanalyze = false) {
        if (!host.available || busy) return;
        const owner = focused.current;
        let current = session.current;
        const ownsOperation = () => mounted.current && owner !== null && focused.current === owner && activeSource.current === id;
        setBusy(true);
        setPlaybackError('');
        try {
            await pauseAndSave();
            if (!ownsOperation()) return;
            if (reanalyze) {
                await current?.cancel();
                if (!ownsOperation()) return;
                current = host.client.beginSourceSession();
                session.current = current;
                await current.ready;
                if (!ownsOperation() || !current.isCurrent()) return;
                const changed = await operation(host.client);
                if (ownsOperation() && current.isCurrent()) {
                    setWindow(changed);
                    setBatch(null);
                    setAnalysisReload(value => value + 1);
                }
            } else {
                const changed = await operation(host.client);
                if (ownsOperation() && current?.isCurrent()) setWindow(changed);
            }
        } catch (cause) {
            if (ownsOperation()) setPlaybackError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (ownsOperation()) {
                setBusy(false);
                // Focus cleanup owns the current replacement too. Re-enter that
                // lifetime only if cancellation invalidated it.
                if (!current?.isCurrent()) setSourceReload(value => value + 1);
            }
        }
    }
    async function cancelOpening() {
        if (!host.available) return;
        const owner = focused.current;
        try { await host.client.cancelSourceOpen(); }
        catch (cause) {
            if (focused.current === owner) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (owner !== null && focused.current === owner) {
                setBusy(false);
                setSourceReload(value => value + 1);
            }
        }
    }
    function applyOffset(value: number) {
        if (!Number.isInteger(value)) {
            setPlaybackError('Enter a whole number of milliseconds.');
            return;
        }
        void changeSource(client => client.setSubtitleOffset(id, value), true);
    }
    function alignSubtitle(direction: SubtitleDirection) {
        if (!host.available || !window || busy) return;
        const point = controller.current?.pauseAndRead();
        const command = host.client.prepareSubtitleAlignment(window.source, point?.positionMs ?? latest.current.position, direction);
        // Capture this relative intent once. An uncertain receipt is recovered by
        // reading the saved source, never by silently choosing the following cue.
        void changeSource(client => client.alignSubtitleOffset(command), true);
    }
    function seekTranscript(positionMs: number) {
        controller.current?.seekTo(positionMs);
        setInspection(null);
        setTranscriptOpen(false);
    }
    async function back() {
        setBusy(true);
        try {
            await session.current?.cancel();
            await pauseAndSave();
            if (router.canGoBack()) router.back();
            else router.replace('/');
        }
        catch (e) {
            setSourceReload(v => v + 1);
            throw e;
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
        let replacing = false;
        try {
            await pauseAndSave();
            const path = droppedPath ?? await host.media.pick(true);
            if (path) {
                replacing = true;
                await session.current?.cancel();
                let w;
                try {
                    w = await host.client.attachSubtitles(id, path);
                }
                finally {
                    await host.media.releasePicked(path);
                }
                setWindow(w);
                setBatch(null);
                setAnalysisReload(v => v + 1);
            }
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            if (replacing)
                setSourceReload(v => v + 1);
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
                    await session.current?.cancel();
                    await pauseAndSave();
                    const opened = await host.client.openSource(path, window.source.packageId);
                    router.replace({
                        pathname: '/watch', params: {
                            id: opened.source.id
                        }
                    });
                    setSourceReload(v => v + 1);
                }
                catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                    setSourceReload(v => v + 1);
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
        if (!host.available || !window || activeSource.current !== id)
            return;
        const current = session.current;
        const source = window.source;
        const b = await host.client.analyzeSource(id, latest.current.position);
        if (mounted.current && activeSource.current === id && current?.isCurrent() && b.sourceId === source.id &&
            b.subtitleRevision === source.subtitleRevision &&
            b.packageId === source.packageId && b.packageVersion === source.packageVersion)
            setBatch(b);
    }
    async function changedInspection() {
        if (activeSource.current !== id) return;
        if (inspection?.onChanged) {
            // The transcript owns its current range; do not briefly expose the
            // caption's old classifications if it closes during the refresh.
            setBatch(null);
            await inspection.onChanged();
        }
        await refreshKnowledge();
    }
    const inspector = inspection && window && host.available ? (
        <Inspector key={JSON.stringify([inspection.sourceAnchor, inspection.targets, inspection.initialTargetId])}
            inspection={inspection} packageId={window.source.packageId} client={host.client}
            onChanged={changedInspection} onClose={() => { setInspection(null); setReturnedSelection(null); }} />
    ) : null;
    const sourceActions = <>
                    {Platform.OS === 'web' && window ? <Select label="Playback rate" variant="media"
                      value={String(window.source.playbackRate)} disabled={busy}
                      options={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => ({ value: String(rate), label: `${rate}×` }))}
                      onValueChange={rate => void changeSource(client => client.setPlaybackRate(id, Number(rate)))} /> : null}
                    {Platform.OS === 'web' && playbackError && !playbackOpen ? <View style={styles.preferenceFeedback}>
                      <Text testID="playback-preference-error" accessibilityRole="alert" variant="caption" tone="media">{playbackError}</Text>
                    </View> : null}
                    {window ? (
                        <Button label={window.source.subtitlePath ? 'Replace subtitles' : 'Open subtitles'}
                            icon="subtitles" iconOnly size="compact" variant="media" disabled={busy} onPress={() => void attach()} />
                    ) : null}
                    {window && host.available ? <>
                      <Button label="Material from this source" variant="media" size="compact"
                        onPress={() => {
                          void pauseAndSave().then(() => router.push({ pathname: '../materials', params: { sourceId: id } })).catch(() => {});
                        }} />
                      <Dialog open={captureOpen} onOpenChange={value => {
                        setCaptureOpen(value);
                        if (value) {
                          void pauseAndSave().catch(() => {});
                           const point = latest.current.position;
                           const clock = point + window.source.subtitleOffsetMs;
                           const cue = window.cues.find(item => item.startMs <= clock && clock < item.endMs);
                           setSubtitleCapture(cue
                             ? cueAnchor(window.source, cue, { start: 0, end: new TextEncoder().encode(cue.text).length }, point)
                             : { sourceId: id, contentRevision: window.source.mediaRevision, packageId: window.source.packageId,
                               packageVersion: window.source.packageVersion, text: '',
                               locator: { kind: 'video', subtitleRevision: window.source.subtitleRevision, cueIndex: null,
                                 selectionStart: 0, selectionEnd: 0, positionMs: Math.round(point),
                                 subtitleOffsetMs: window.source.subtitleOffsetMs, playbackRate: window.source.playbackRate } });
                        }
                       }} title="Capture source" description="Save source text and available media with their original location."
                         trigger={<Button label={cues.length ? 'Capture subtitle' : 'Capture frame'} variant="media" size="compact" />}>
                        {subtitleCapture ? <MaterialEditor key={JSON.stringify(subtitleCapture)} client={host.client} authoredMedia={host.authoredMedia}
                           initial={{ ...emptyMaterial(subtitleCapture.packageId), phrase: subtitleCapture.text || window.source.title, context: subtitleCapture.text, source: subtitleCapture }} /> : null}
                       </Dialog>
                      <Button ref={liveWordTrigger} label="Live word translator" icon="globe" iconOnly variant="media" size="compact"
                        accessibilityState={{ expanded: liveWordsOpen }} disabled={!batch || transcriptOpen}
                        onPress={() => setLiveWordsOpen(value => !value)} />
                      {window.source.subtitleRevision ? <Button label="Subtitle synchronization" icon="sync" iconOnly
                        variant="media" size="compact" accessibilityState={{ expanded: synchronizationOpen }}
                        onPress={() => setSynchronizationOpen(value => !value)} /> : null}
                      <Transcript key={`${id}:${window.source.subtitleRevision}`} client={host.client}
                        source={window.source} open={transcriptOpen}
                        analysis={transcriptBatch} onAnalysis={setTranscriptBatch} onInspect={setInspection}
                        onOpenChange={value => {
                          setInspection(null); setTranscriptOpen(value);
                          if (value) void pauseAndSave().catch(() => {});
                          else setTranscriptBatch(null);
                        }}
                        onSeek={seekTranscript}>{transcriptOpen ? inspector : null}</Transcript>
                      <Dialog open={playbackOpen} onOpenChange={value => {
                        setPlaybackOpen(value);
                        if (value) {
                          setOffsetDraft(String(window.source.subtitleOffsetMs));
                          setPlaybackError('');
                          void pauseAndSave().catch(() => {});
                        }
                      }} title="Playback and subtitles" description="Changes are saved for this video."
                        trigger={<Button label="Playback options" icon="settings" iconOnly variant="media" size="compact" />}>
                        {Platform.OS !== 'web' ? <><Text>Playback rate · {window.source.playbackRate}×</Text>
                        <Row>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate =>
                          <Button key={rate} label={`${rate}×`} accessibilityLabel={`Playback rate ${rate}`}
                            variant="secondary" disabled={busy}
                            accessibilityState={{ selected: window.source.playbackRate === rate }}
                            onPress={() => void changeSource(client => client.setPlaybackRate(id, rate))} />)}</Row></> : null}
                        <Text>Source language</Text>
                        <Select label="Source language" value={window.source.packageId} disabled={busy}
                          options={languages.map(plugin => ({ value: plugin.id, label: plugin.displayName ?? plugin.id, testID: plugin.id }))}
                          onValueChange={id => {
                            const plugin = languages.find(value => value.id === id);
                            if (plugin && (window.source.packageId !== plugin.id || window.source.packageVersion !== plugin.version)) {
                              void changeSource(client => client.setSourceLanguage(window.source.id, plugin.id), true);
                            }
                          }} />
                        {languages.some(plugin => plugin.id === window.source.packageId && plugin.version !== window.source.packageVersion) ? <>
                          <Text variant="caption" muted>An updated language package is installed.</Text>
                          <Button label="Use installed language version" variant="secondary" disabled={busy}
                            onPress={() => void changeSource(client => client.setSourceLanguage(id, window.source.packageId), true)} />
                        </> : null}
                        {Platform.OS === 'web' ? <>
                          <Text>Desktop inspection</Text>
                          <Row>{([
                            ['click', 'Click'], ['immediate', 'Immediate hover'],
                            ['delayed', 'Delayed hover (300 ms)'], ['modifier', 'Shift + hover'],
                          ] as const).map(([trigger, label]) => <Button key={trigger}
                            label={label}
                            accessibilityLabel={label}
                            variant="secondary" disabled={busy}
                            accessibilityState={{ selected: window.source.inspectionTrigger === trigger }}
                            onPress={() => void changeSource(client => client.setInspectionTrigger(id, trigger))} />)}</Row>
                          <Text variant="caption" muted>Click and keyboard activation remain available. Shift is held when entering a word.</Text>
                        </> : null}
                        {window.source.subtitleRevision ? <>
                          <Text>Subtitle synchronization</Text>
                          <Row>
                            <Button label="Align previous subtitle" icon="previousCue" disabled={busy}
                              onPress={() => alignSubtitle('previous')} />
                            <Button label="Align next subtitle" icon="nextCue" disabled={busy}
                              onPress={() => alignSubtitle('next')} />
                          </Row>
                          <Text variant="caption" muted>Saved for this source and subtitle association. Positive milliseconds show cues earlier; original subtitle timestamps stay intact.</Text>
                          <TextField testID="subtitle-offset-input" label="Subtitle offset in milliseconds" value={offsetDraft}
                            onChangeText={setOffsetDraft} maxLength={12} autoCorrect={false} />
                          <Row>
                            <Button label="Apply subtitle offset" disabled={busy}
                              onPress={() => applyOffset(offsetDraft.trim() ? Number(offsetDraft) : NaN)} />
                            <Button label="Reset synchronization" variant="secondary" disabled={busy}
                              onPress={() => { setOffsetDraft('0'); applyOffset(0); }} />
                          </Row>
                          <Text>Current offset: {window.source.subtitleOffsetMs} ms</Text>
                        </> : null}
                        {playbackError ? <><Text accessibilityRole="alert">{playbackError}</Text>
                          <Button label="Refresh playback settings" variant="secondary" disabled={busy}
                            onPress={() => void changeSource(client => client.sourceWindow(id, latest.current.position))} /></> : null}
                      </Dialog>
                    </> : null}
    </>;
    const showLiveWords = liveWordsOpen && batch && window && host.available && !transcriptOpen;
    const showSynchronization = window && synchronizationOpen && window.source.subtitleRevision;
    const overlayInset = showLiveWords || showSynchronization ? overlayHeight + 8 : 0;
    return (
        <View style={[styles.screen(insets.top, insets.bottom), { paddingRight: sidebarInset }]}>
            <View testID="watch-toolbar" style={[styles.toolbar, { top: insets.top, right: sidebarInset,
                paddingLeft: host.available ? Math.max(16, host.windowControlsWidth ?? 0) : 16 }]} onLayout={event => setToolbarHeight(event.nativeEvent.layout.height)}>
                <Row>
                    <Button label="Home" icon="arrowLeft" size="compact" variant="media"
                        disabled={busy} onPress={() => void back().catch(() => {})} />
                    <View style={styles.title}><Text testID="watch-source-title" numberOfLines={1} variant="mediaTitle" tone="media">
                        {window?.source.title ?? 'Watch'}
                    </Text></View>
                    {busy && host.available ? (
                        <Button label="Cancel opening" variant="secondary"
                            onPress={() => void cancelOpening()} />
                    ) : null}
                    {returnedSelection ? <Text testID="returned-source-selection" tone="media" variant="caption" selectable>
                        {returnedSelection.locator.cueIndex === null
                            ? `Returned frame at ${(returnedSelection.locator.positionMs / 1000).toFixed(1)}s`
                            : `Returned selection: ${new TextDecoder().decode(new TextEncoder().encode(returnedSelection.text)
                                .slice(returnedSelection.locator.selectionStart, returnedSelection.locator.selectionEnd))}`}
                    </Text> : null}
                    {returnedSelection ? <Button label="Clear returned selection" variant="media" size="compact"
                        onPress={() => { setReturnedSelection(null); setInspection(null); }} /> : null}
                    {Platform.OS !== 'web' ? sourceActions : null}
                </Row>
                {error ? <>
                    <Text tone="media" accessibilityRole="alert">{error}</Text>
                    <Row>
                        <Button label="Retry source" variant="secondary" onPress={() => { setError(''); setSourceReload(v => v + 1); }} />
                        <Button label="Reselect subtitles" variant="secondary" disabled={busy} onPress={() => void attach()} />
                        <Button label="Reselect from Home" variant="secondary" onPress={() => router.replace('/')} />
                    </Row>
                </> : null}
                {saveError ? <>
                    <Text tone="media" accessibilityRole="alert">Progress not saved: {saveError}</Text>
                    <Button label="Retry saving position" variant="secondary" onPress={() => void persist().catch(() => {})} />
                </> : null}
            </View>
            {showLiveWords || showSynchronization ? <View testID="watch-source-overlays"
                onLayout={event => setOverlayHeight(event.nativeEvent.layout.height)}
                style={[styles.overlays(viewport.width - sidebarInset < 720),
                    { top: insets.top + toolbarHeight + (Platform.OS === 'web' ? -2 : 8), right: sidebarInset + 10 }]}>
            {showLiveWords && batch ? <View style={styles.liveWords}>
                <LiveWordCards key={JSON.stringify([id, batch.subtitleRevision, batch.packageId, batch.packageVersion, batch.packageRevision])}
                     client={host.client} batch={batch} source={window.source} cueKey={cueKey} focusFallback={liveWordTrigger}
                     onClose={() => setLiveWordsOpen(false)} onInspect={value => {
                        void pauseAndSave().catch(() => {});
                        setInspection(value);
                     }} />
            </View> : null}
            {showSynchronization && window ? <View style={styles.synchronization(viewport.width - sidebarInset < 720)}>
              <MediaOverlay variant="synchronization" closeLabel="Hide synchronization"
                onClose={() => setSynchronizationOpen(false)}>
                <Row>
                    <Button label="Align previous subtitle" icon="previousCue" iconOnly size="compact" variant="mediaSync"
                        disabled={busy} onPress={() => alignSubtitle('previous')} />
                    <Button label={(window.source.subtitleOffsetMs / 1000).toFixed(2)}
                        accessibilityLabel="Subtitle offset" accessibilityValue={{ text: `${window.source.subtitleOffsetMs} milliseconds` }}
                        size="compact" variant="mediaSync" onPress={() => {
                            setOffsetDraft(String(window.source.subtitleOffsetMs)); setPlaybackOpen(true);
                        }} />
                    <Button label="Align next subtitle" icon="nextCue" iconOnly size="compact" variant="mediaSync"
                        disabled={busy} onPress={() => alignSubtitle('next')} />
                </Row>
                {playbackError ? <><Text tone="media" variant="caption" accessibilityRole="alert">{playbackError}</Text>
                    <Button label="Refresh synchronization" size="compact" variant="media" disabled={busy}
                        onPress={() => void changeSource(client => client.sourceWindow(id, latest.current.position))} /></> : null}
              </MediaOverlay>
            </View> : null}
            </View> : null}
            {window && host.available ? <>
                <View style={styles.stage(Platform.OS === 'web' ? 0 : toolbarHeight)}>
                    <MediaSurface key={window.source.id} uri={host.media.uri(window.source)}
                        controls={Platform.OS === 'web' ? sourceActions : undefined}
                        initialPositionMs={window.source.positionMs} playbackRate={window.source.playbackRate}
                        paused={!!inspection || !!returnedSelection || busy || transcriptOpen || playbackOpen || captureOpen}
                        onController={value => {
                            controller.current = value;
                            setSubtitleInset(value.subtitleBottomInset);
                        }}
                        onProgress={progress} onError={setError} />
                    {cues.length ? <View pointerEvents="box-none" style={[styles.subtitle(toolbarHeight + overlayInset, subtitleInset), {
                        opacity: transcriptOpen || (Platform.OS !== 'web' && inspection) ? 0 : 1,
                    }]}>
                      <ScrollView testID="subtitle-window" accessibilityLabel="Subtitles"
                        style={[styles.subtitleScroll, { height: subtitleHeight }]}
                        onContentSizeChange={(_, height) => setSubtitleHeight(height)}
                        contentContainerStyle={styles.subtitleContent}
                        keyboardShouldPersistTaps="handled">
                        {cues.map(cue => {
                            const analysis = batch?.subtitleRevision === window.source.subtitleRevision
                                ? batch.cues.find(a => a.cue.index === cue.index) : null;
                            return (
                                <View key={JSON.stringify([window.source.id, window.source.subtitleRevision, window.source.packageId, window.source.packageVersion, cue.index])}
                                    ref={returnedSelection?.locator.cueIndex === cue.index ? returnedCue : undefined}
                                    focusable={returnedSelection?.locator.cueIndex === cue.index} style={styles.cue}>
                                <AnnotatedText rawText={cue.text} analysis={analysis ?? null}
                                    annotations={batch?.annotations ?? []}
                                    inspectionMode={window.source.inspectionTrigger}
                                    onInspect={(token, anchor) => {
                                        void pauseAndSave().catch(() => {});
                                        setInspection({ sourceForm: token.text, context: cue.text, targets: token.targets, anchor,
                                            sourceAnchor: cueAnchor(window.source, cue, token, latest.current.position),
                                            packageRevision: batch?.packageRevision });
                                    }} />
                                </View>
                            );
                        })}
                      </ScrollView>
                    </View> : null}
                </View>
                <View pointerEvents="box-none"
                    style={[styles.status, { top: insets.top + toolbarHeight + 8 + overlayInset }, (!window.source.subtitlePath || analysisError || (analysisPending && !batch)) ? styles.feedback : null]}>
                    {!window.source.subtitlePath ? <Text tone="media">Open a plain UTF-8 SRT file to inspect subtitles.</Text> : null}
                    {analysisPending && !batch && !transcriptOpen ? <Text tone="media" accessibilityLiveRegion="polite">Analyzing subtitles…</Text> : null}
                    {analysisError ? <>
                        <Text tone="media" accessibilityRole="alert">{analysisError}</Text>
                        <Button label="Retry analysis" variant="secondary" onPress={() => setAnalysisReload(v => v + 1)} />
                    </> : null}
                </View>
                {!transcriptOpen ? inspector : null}
            </> : !error ? <View style={[styles.status, styles.feedback, { top: insets.top + toolbarHeight + 8 }]}>
                <Text tone="media" accessibilityLiveRegion="polite">Opening source…</Text>
            </View> : null}
        </View>
    );
}
const styles = StyleSheet.create(theme => ({
    cue: { alignSelf: 'stretch' },
    overlays: (compact: boolean) => ({
        position: 'absolute', zIndex: 2, left: theme.spacing.comfortable / 2,
        flexDirection: compact ? 'column-reverse' : 'row', gap: theme.spacing.small,
        alignItems: compact ? 'stretch' : 'flex-start',
    }),
    liveWords: { flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%' },
    synchronization: (compact: boolean) => ({
        alignSelf: compact ? 'flex-end' : 'flex-start', flexShrink: 0, maxWidth: '100%',
    }),
    preferenceFeedback: { maxWidth: 320, flexShrink: 1 },
    screen: (top: number, bottom: number) => ({
        flex: 1, paddingTop: top, paddingBottom: bottom, backgroundColor: theme.media.background
    }), toolbar: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, backgroundColor: theme.media.background,
        paddingHorizontal: theme.spacing.medium, paddingVertical: theme.spacing.small, gap: theme.spacing.small,
        _web: { paddingVertical: theme.spacing.tiny },
    }, title: {
        flex: 1, flexBasis: 120, minWidth: 0
    }, stage: (toolbarHeight: number) => ({
        flex: 1, minHeight: 240, paddingTop: toolbarHeight, backgroundColor: theme.media.background
    }), subtitle: (toolbarHeight: number, controlsHeight: number) => ({
        position: 'absolute', left: theme.spacing.comfortable, right: theme.spacing.comfortable,
        top: toolbarHeight + theme.spacing.small, bottom: controlsHeight + theme.spacing.large,
        alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden'
    }), subtitleScroll: {
        width: '100%', maxHeight: '100%', flexGrow: 0, flexShrink: 1
    }, subtitleContent: {
        alignItems: 'center', gap: theme.spacing.small
    }, status: {
        position: 'absolute', top: 80, left: theme.spacing.medium, right: theme.spacing.medium, gap: theme.spacing.small
    }, feedback: {
        padding: theme.spacing.compact, borderRadius: theme.radius, backgroundColor: theme.media.chrome
    }
}));
