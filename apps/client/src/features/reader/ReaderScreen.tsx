import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { DocumentAppearance, SourceAnchor } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { AppShell, Row } from '@mlearn/ui/layout';
import type { InspectionMode } from '@mlearn/ui/inline-word';
import { SourcePreview, type SourceThumbnail } from '@mlearn/ui/source-preview';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { Inspector, type Inspection } from '../inspector';
import { blockPosition, documentAnchor } from './documentFlow';
import { DocumentViewport } from './DocumentViewport';
import { useReader } from './useReader';
import { useImageReader } from './useImageReader';
import { ImageViewport, type PageNotice } from './ImageViewport';
import { imageAnchor, imageContext } from './imageFlow';
import { ImageRecognition } from './ImageRecognition';
import { SourceEntryScreen } from '../source-entry';
import { ImagePageTools, ReaderAppearancePanel, ReaderOptionsPanel, ReaderStatusStrip, ReaderToolbar, type ReaderPanel } from './ReaderChrome';
import { VocabularyPanel, documentWords, imageWords } from './VocabularyPanel';
import { notices } from './readerNotice';

export function ReaderScreen() {
    const host = useRuntime();
    const params = useLocalSearchParams<{ id: string; packageId?: string; materialId?: string; proposalId?: string; reviewSessionId?: string; reviewEncounterId?: string }>();
    const router = useRouter();
    if (!params.id && !params.materialId && !params.proposalId && !params.reviewSessionId && !params.reviewEncounterId)
        return <SourceEntryScreen kind="document" preferredPackage={typeof params.packageId === 'string' ? params.packageId : undefined} />;
    if (!host.available) return <AppShell header={<Row>
        <Button label="Home" variant="quiet" onPress={() => router.dismissTo('/')} />
        <Text variant="heading" accessibilityRole="header">Reader</Text>
    </Row>}><Text accessibilityRole="alert">Reading isn’t available here.</Text></AppShell>;
    return <ReaderWorkspace client={host.client} id={typeof params.id === 'string' ? params.id : ''}
        materialId={typeof params.materialId === 'string' ? params.materialId : undefined}
        proposalId={typeof params.proposalId === 'string' ? params.proposalId : undefined}
        reviewSessionId={typeof params.reviewSessionId === 'string' ? params.reviewSessionId : undefined}
        reviewEncounterId={typeof params.reviewEncounterId === 'string' ? params.reviewEncounterId : undefined} />;
}

/** Reader regions: toolbar, page rail, source canvas, one right-hand panel and
 * the bottom status strip. Settings and recognition details open in the right
 * panel beside the source they change, never as a modal over it.
 */
function ReaderWorkspace({ client, id, materialId, proposalId, reviewSessionId, reviewEncounterId }: {
    readonly client: RuntimeClient; readonly id: string; readonly materialId?: string; readonly proposalId?: string;
    readonly reviewSessionId?: string; readonly reviewEncounterId?: string;
}) {
    const [imageView, setImageView] = useState<boolean | null>(null);
    const reader = useReader(client, id, materialId, reviewSessionId, reviewEncounterId, imageView, proposalId);
    const router = useRouter();
    const routeNavigation = useNavigation();
    const host = useRuntime();
    const viewport = useWindowDimensions();
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const wide = viewport.width >= 900 * theme.textScale;
    const [inspection, setInspection] = useState<Inspection | null>(null);
    const [focused, setFocused] = useState(true);
    const [departing, setDeparting] = useState(false);
    const departure = useRef<object | null>(null);
    const [thumbnails, setThumbnails] = useState<Record<string, SourceThumbnail>>({});
    const [panel, setPanel] = useState<ReaderPanel | null>(wide ? 'vocabulary' : null);
    const [railOpen, setRailOpen] = useState(wide);
    const [navigationFailed, setNavigationFailed] = useState(false);
    const [cropMode, setCropMode] = useState(false);
    const [magnifier, setMagnifier] = useState(false);
    const [highlighted, setHighlighted] = useState<SourceAnchor | null>(null);
    const [inspectionMode, setInspectionMode] = useState<InspectionMode>('modifier');
    const [annotations, setAnnotations] = useState(true);
    const [hovered, setHovered] = useState<ReadonlySet<string>>(new Set());
    const [recognized, setRecognized] = useState<ReadonlySet<string>>(new Set());
    useFocusEffect(useCallback(() => {
        setFocused(true);
        return () => { departure.current = null; setDeparting(false); setFocused(false); setInspection(null); setThumbnails({}); };
    }, []));
    const source = reader.window?.source;
    const sourceIdentity = JSON.stringify([id, source?.contentRevision, source?.parserRevision,
        source?.packageId, source?.packageVersion, reader.window?.blocks.map(block => [block.resource, block.id])]);
    useEffect(() => { setInspection(null); }, [sourceIdentity, reader.pending]);
    useEffect(() => { setThumbnails({}); }, [sourceIdentity]);
    useEffect(() => { setHovered(new Set()); setRecognized(new Set()); }, [id, source?.contentRevision]);
    const current = useRef(sourceIdentity); current.current = sourceIdentity;
    const sourceWindow = reader.window;
    const visibleBlock = Math.max(0, sourceWindow?.blocks.findIndex(block =>
        block.resource === reader.position?.resource && block.id === reader.position.blockId) ?? 0);
    const currentBlock = sourceWindow?.blocks[visibleBlock];
    const imageMode = reader.imageMode;
    const pageIndex = currentBlock?.page
        ?? (reader.returned?.locator.kind === 'image' ? reader.returned.locator.pageIndex ?? 0 : 0);
    const imageReader = useImageReader(host.available ? host : null, source, pageIndex,
        imageMode && focused, reader.returnedPage,
        reader.languages.some(plugin => plugin.id === source?.packageId && plugin.capabilities.includes('image.ocr.postprocess.v1')),
        reader.navigate);
    const showRail = wide && railOpen;
    const optionsToggle = useRef<View>(null);
    const known = useRef({ thumbnails, recognized, spread: imageReader.indices });
    known.current = { thumbnails, recognized, spread: imageReader.indices };
    useEffect(() => {
        if (!imageMode || !showRail || !sourceWindow || !host.available || !imageReader.indices.length) return;
        const sourceId = sourceWindow.source.id;
        let live = true;
        void (async () => {
            for (const block of sourceWindow.blocks) {
                const resourceId = block.image?.resourceId;
                // The visible spread publishes its own thumbnails and recognition.
                if (!live || !resourceId || block.page !== null && known.current.spread.includes(block.page)) continue;
                // A page whose pixels or saved text cannot be read keeps its
                // numbered placeholder; opening the page reports the failure.
                try {
                    if (!known.current.thumbnails[resourceId]) {
                        const uri = await host.ocr.uri(sourceId, resourceId);
                        const size = await new Promise<{ width: number; height: number }>((resolve, reject) =>
                            Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
                        if (live) setThumbnails(previous => previous[resourceId] ? previous : { ...previous, [resourceId]: { uri, ...size } });
                    }
                    if (!known.current.recognized.has(resourceId)) {
                        const saved = await host.client.readOcr(sourceId, resourceId);
                        if (live && saved?.regions.length) setRecognized(previous => new Set([...previous, resourceId]));
                    }
                } catch { continue; }
            }
        })();
        return () => { live = false; };
    }, [imageMode, showRail, sourceIdentity, imageReader.indices.length > 0]);
    const imageRevision = JSON.stringify(imageReader.pages.map(item => [item.descriptor.resourceId, item.page?.ocrRevision]));
    useEffect(() => { setImageView(null); }, [id, materialId, reviewSessionId, reviewEncounterId]);
    useEffect(() => { setInspection(null); setCropMode(false); setMagnifier(false); setHighlighted(null); }, [imageRevision]);
    useEffect(() => {
        const done = imageReader.pages.filter(item => item.page?.regions.length).map(item => item.descriptor.resourceId);
        if (done.some(resource => !recognized.has(resource))) setRecognized(previous => new Set([...previous, ...done]));
    }, [imageRevision]);
    const previousBlock = sourceWindow?.blocks[visibleBlock - 1];
    const nextBlock = sourceWindow?.blocks[visibleBlock + 1];
    const previous = sourceWindow && previousBlock
        ? blockPosition(sourceWindow.source, previousBlock) : sourceWindow?.previous;
    const next = sourceWindow && nextBlock
        ? blockPosition(sourceWindow.source, nextBlock) : sourceWindow?.next;
    async function depart(complete: () => void) {
        if (departure.current) return;
        const request = {}; departure.current = request;
        const identity = current.current;
        setDeparting(true); setNavigationFailed(false);
        try {
            await reader.persist();
            if (departure.current === request && current.current === identity) complete();
        } catch {
            if (departure.current === request && current.current === identity) setNavigationFailed(true);
        } finally {
            if (departure.current === request) { departure.current = null; setDeparting(false); }
        }
    }
    usePreventRemove(focused, ({ data }) => { void depart(() => routeNavigation.dispatch(data.action)); });
    function changeAppearance(change: Partial<DocumentAppearance>) {
        if (!source || reader.pending) return;
        setInspection(null);
        reader.appearance({ ...source.appearance, ...change });
    }
    function inspect(value: Inspection) {
        setInspection(value);
        setHovered(previous => value.targets.every(target => previous.has(target)) ? previous
            : new Set([...previous, ...value.targets]));
    }
    function togglePanel(value: ReaderPanel) {
        setInspection(null); setPanel(previous => previous === value ? null : value);
    }
    const imageNavigationDisabled = (direction: 'previous' | 'next') => reader.pending || imageReader.pending
        || !imageReader.indices.length || (direction === 'previous' ? imageReader.indices[0] === 0
            : imageReader.indices[imageReader.indices.length - 1] + 1 >= (source?.totalPages ?? 0));
    const position = imageMode
        ? imageReader.indices.length && source?.totalPages ? `${imageReader.indices[0] + 1}/${source.totalPages}` : null
        : currentBlock?.page != null && source?.totalPages ? `${currentBlock.page + 1}/${source.totalPages}` : null;
    const words = useMemo(() => !source || panel !== 'vocabulary' ? []
        : imageMode ? imageWords(source, imageReader.pages) : documentWords(source, reader.batch),
    [source, panel, imageMode, imageReader.pages, reader.batch]);
    const analyzing = imageMode ? imageReader.pages.some(item => item.analyzing) : reader.analysisPending;
    const status = imageMode && imageReader.progress ? `Processing ${imageReader.progress.current}/${imageReader.progress.total}`
        : reader.pending || imageReader.pending ? 'Opening…' : analyzing ? 'Looking up words…' : 'Ready';
    const recognitionNotice: PageNotice | null = imageReader.recognition === 'not_installed'
        ? { message: notices.recognitionNotInstalled.message, action: 'Install', onAction: () => void depart(() => router.push('/settings')) }
        : imageReader.recognition === 'unavailable' ? { message: notices.recognitionUnavailable.message, action: null, onAction: () => {} }
        : imageReader.recognition === 'failed' ? { message: notices.recognitionFailed.message, action: 'Retry', onAction: imageReader.retry }
        : imageReader.recognition === 'stopped' ? { message: notices.recognitionStopped.message, action: 'Retry', onAction: imageReader.retry }
        : null;
    // While the shown spread is being recognized the strip reports only that
    // progress; a page notice returns once recognition settles.
    const strip = reader.error ? null
        : navigationFailed || reader.saveError ? { ...notices.saveFailed, onAction: () => void reader.persist().catch(() => setNavigationFailed(true)) }
        : imageMode && imageReader.notice && imageReader.recognition !== 'working' ? { ...imageReader.notice, onAction: imageReader.retry }
        : !imageMode && reader.analysisError ? { ...notices.lookupFailed, onAction: reader.retryAnalysis }
        : null;
    const languageControls = source ? <ReaderOptionsPanel client={client} source={source} reader={reader} imageMode={imageMode}
        focused={focused} onClose={null} onInspect={() => setInspection(null)}
        onTogglePdf={() => { setInspection(null); setImageView(!imageMode); }}
        onLocate={hit => { if (imageMode) imageReader.cancel(); return reader.locate(hit.anchor); }}
        onReturn={point => imageMode ? imageReader.navigate(point) : reader.navigate(point)}
        onOpenDocument={() => void depart(() => router.push({ pathname: '/reader', params: { packageId: source.packageId } }))} /> : null;
    const vocabularyPanel = source ? <View style={panel === 'vocabulary' ? undefined : styles.hidden}><VocabularyPanel client={client} source={source} words={words} hovered={hovered}
            status={imageMode && imageReader.recognition === 'working' && !words.length ? 'Recognizing…'
                : analyzing && !words.length ? 'Looking up words…' : null}
            pages={imageMode ? imageReader.pages : undefined} onAnalyze={imageReader.analyze}
            onInspect={inspect} onClose={() => setPanel(null)}
            onLocate={anchor => {
                setInspection(null);
                if (!wide) setPanel(null);
                if (anchor.locator.kind === 'image') {
                    const locator = anchor.locator;
                    const item = imageReader.pages.find(page => page.descriptor.resourceId === locator.resourceId);
                    if (item) { reader.onPosition(item.descriptor.position, true); setHighlighted(anchor); }
                } else void reader.locate(anchor);
            }} /></View> : null;
    const sidePanel = !source ? null
        : panel === 'appearance' && !imageMode ? <ReaderAppearancePanel appearance={source.appearance} disabled={reader.pending}
            onChange={changeAppearance} onClose={() => setPanel(null)}
            onAppAppearance={() => void depart(() => router.push('/settings'))} />
        : panel === 'options' && !imageMode ? <ReaderOptionsPanel client={client} source={source} reader={reader} imageMode={false}
            focused={focused} onClose={() => setPanel(null)} onInspect={() => setInspection(null)}
            onTogglePdf={() => { setInspection(null); setImageView(true); setPanel(null); }}
            onLocate={hit => reader.locate(hit.anchor)} onReturn={point => reader.navigate(point)}
            onOpenDocument={() => void depart(() => router.push({ pathname: '/reader', params: { packageId: source.packageId } }))} />
        : null;
    // Vocabulary and recognition stay mounted while hidden so an uncertain
    // Practice admission or correction keeps its command identity for retry.
    const toolsDisabled = !source || reader.pending || !imageReader.settings || imageReader.saving;
    // A narrow panel covers the page; a tool that acts on the page reveals it.
    const revealPage = () => { if (!wide) setPanel(null); };
    const pageTools = imageMode ? <ImagePageTools disabled={toolsDisabled}
        crop={cropMode} onCrop={() => { setInspection(null); setMagnifier(false); if (!cropMode) revealPage(); setCropMode(!cropMode); }}
        magnifier={magnifier} onMagnifier={() => { setInspection(null); setCropMode(false); if (!magnifier) revealPage(); setMagnifier(!magnifier); }}
        annotations={imageReader.settings?.showOverlay ?? true}
        covers={imageReader.settings ? !imageReader.settings.showAnnotations : false}
        onCovers={() => {
            if (!imageReader.settings) return;
            setInspection(null); void imageReader.changeSettings({ showAnnotations: !imageReader.settings.showAnnotations });
        }} /> : null;
    const recognitionPanel = imageMode && source ? <View style={panel === 'options' ? undefined : styles.hidden}>
        <ImageRecognition client={client} reader={imageReader} onClose={() => {
            setPanel(null); requestAnimationFrame(() => optionsToggle.current?.focus());
        }}>{pageTools}{languageControls}</ImageRecognition>
    </View> : null;
    // An image collection has no title of its own (only the picked folder's
    // name), so it is named by what it is.
    const title = !source ? '' : source.format === 'images'
        ? `Images · ${source.totalPages} ${source.totalPages === 1 ? 'page' : 'pages'}` : source.title;
    const statusPosition = imageMode ? position
        : currentBlock ? currentBlock.image ? currentBlock.image.alt || 'Image' : currentBlock.text || null : null;
    return <View style={styles.screen(insets.top, insets.bottom)}>
        <ReaderToolbar title={title} position={position} imageMode={imageMode} wide={wide} optionsRef={optionsToggle}
            leadingInset={host.available ? Math.max(0, (host.windowControlsWidth ?? 0) - theme.spacing.small) : 0}
            railOpen={railOpen} panelOpen={panel === 'vocabulary'} appearanceOpen={panel === 'appearance'} optionsOpen={panel === 'options'}
            disabled={!source || reader.pending} homeDisabled={departing}
            writingMode={source?.appearance.writingMode ?? 'auto'} imageReader={imageMode ? imageReader : null}
            previousDisabled={imageMode ? imageNavigationDisabled('previous') : reader.pending || !previous}
            nextDisabled={imageMode ? imageNavigationDisabled('next') : reader.pending || !next}
            onRail={() => setRailOpen(value => !value)}
            onHome={() => router.dismissTo('/')}
            onWritingMode={writingMode => changeAppearance({ writingMode })}
            onAppearance={() => togglePanel('appearance')} onOptions={() => togglePanel('options')}
            onPanel={() => togglePanel('vocabulary')}
            onBeforeLayout={() => setInspection(null)}
            onPrevious={() => { setInspection(null); if (imageMode) void imageReader.go('previous'); else if (previous) void reader.navigate(previous); }}
            onNext={() => { setInspection(null); if (imageMode) void imageReader.go('next'); else if (next) void reader.navigate(next); }} />
        <View style={styles.workspace}>
            {showRail && sourceWindow ? <ScrollView style={styles.rail} contentContainerStyle={styles.railContent} testID="reader-page-rail">
                {sourceWindow.blocks.map(block => <SourcePreview key={JSON.stringify([block.resource, block.id])}
                    text={block.image ? block.image.alt || 'Page image' : block.text || 'Text unavailable'}
                    thumbnail={block.image ? thumbnails[block.image.resourceId] : undefined}
                    page={block.page}
                    selected={imageMode && block.page !== null ? imageReader.indices.includes(block.page)
                        : reader.position?.resource === block.resource && reader.position.blockId === block.id}
                    marked={imageMode && !!block.image && recognized.has(block.image.resourceId)}
                    disabled={reader.pending} onPress={() => {
                        const target = blockPosition(sourceWindow.source, block);
                        void (imageMode ? imageReader.navigate(target) : reader.navigate(target));
                    }} />)}
            </ScrollView> : null}
            <View style={styles.canvas}>
                {sourceWindow && focused && imageMode && imageReader.settings ? <ImageViewport source={sourceWindow.source}
                    pages={imageReader.pages} settings={imageReader.settings} returned={highlighted ?? reader.returned} cropMode={cropMode}
                    magnifier={magnifier} inspectionMode={inspectionMode}
                    recognizing={imageReader.recognition === 'working'} notice={recognitionNotice} onCancelRecognition={imageReader.stop}
                    onRetry={imageReader.retry}
                    onDismissInspection={() => setInspection(null)}
                    onThumbnail={(resourceId, thumbnail) => setThumbnails(previous => previous[resourceId]?.uri === thumbnail.uri
                        ? previous : { ...previous, [resourceId]: thumbnail })}
                    onCrop={(resourceId, crop) => { setCropMode(false); void imageReader.recognize(resourceId, crop); }}
                    onNavigate={direction => { if (!reader.pending) { setInspection(null); void imageReader.go(direction); } }}
                    onInspect={(resourceId, regionId, start, anchor) => {
                        const item = imageReader.pages.find(page => page.descriptor.resourceId === resourceId);
                        const region = item?.page?.regions.find(value => value.id === regionId);
                        const analyzed = item?.batch?.regions.find(value => value.regionId === regionId);
                        const token = analyzed?.tokens.find(value => value.start === start);
                        if (!item?.page || !item.batch || !region || !token?.targets.length || reader.pending
                            || item.batch.packageId !== sourceWindow.source.packageId
                            || item.batch.packageVersion !== sourceWindow.source.packageVersion) return;
                        reader.onPosition(item.descriptor.position, true);
                        inspect({ sourceForm: token.text, context: imageContext(item.page, region), targets: token.targets, anchor,
                            sourceAnchor: imageAnchor(sourceWindow.source, item.page, item.descriptor.pageIndex, region, token),
                            packageRevision: item.batch.packageRevision });
                    }} /> : sourceWindow && focused && !imageMode ? <DocumentViewport window={sourceWindow} batch={reader.batch}
                    annotations={annotations} inspectionMode={inspectionMode} target={reader.position}
                    returned={reader.returned} inspecting={inspection !== null} onPosition={reader.onPosition}
                    onThumbnail={(resourceId, thumbnail) => setThumbnails(previous => previous[resourceId]?.uri === thumbnail.uri
                        ? previous : { ...previous, [resourceId]: thumbnail })}
                    onNavigate={direction => {
                        if (reader.pending) return;
                        const point = direction === 'next' ? next : previous;
                        if (point) void reader.navigate(point);
                    }}
                    onInspect={(resource, blockId, start, anchor) => {
                        const batch = reader.batch;
                        const block = batch?.blocks.find(item => item.resource === resource && item.blockId === blockId
                            && item.tokens.some(token => token.start === start));
                        const token = block?.tokens.find(item => item.start === start);
                        if (!batch || !block || !token?.targets.length || reader.pending) return;
                        inspect({ sourceForm: token.text, context: block.text, targets: token.targets, anchor,
                            sourceAnchor: documentAnchor(sourceWindow.source, block, token), packageRevision: batch.packageRevision });
                    }} /> : <View style={styles.empty}>
                    {reader.error ? <>
                        <Text accessibilityRole="alert">{notices.openFailed.message}</Text>
                        <Row><Button label="Retry" variant="secondary" size="compact" onPress={reader.retry} /></Row>
                    </> : reader.pending ? <>
                        <Text accessibilityLiveRegion="polite">Opening…</Text>
                        <Row><Button label="Cancel" variant="secondary" size="compact" onPress={() => void reader.cancel()} /></Row>
                    </> : null}
                </View>}
            </View>
            {source ? <ScrollView style={[wide ? styles.panel : styles.overlayPanel, !panel && styles.hidden]}
                contentContainerStyle={styles.panelContent}>
                {vocabularyPanel}{sidePanel}{recognitionPanel}
            </ScrollView> : null}
        </View>
        <ReaderStatusStrip position={statusPosition} status={status}
            inspectionMode={inspectionMode} onInspectionMode={setInspectionMode}
            annotations={imageMode ? imageReader.settings?.showOverlay ?? true : annotations}
            onAnnotations={() => {
                setInspection(null);
                if (!imageMode) setAnnotations(value => !value);
                else if (imageReader.settings) void imageReader.changeSettings({ showOverlay: !imageReader.settings.showOverlay });
            }}
            controlsDisabled={!source || reader.pending || (imageMode && (!imageReader.settings || imageReader.saving))}
            notice={strip} />
        {inspection && source && host.available ? <Inspector inspection={inspection} packageId={source.packageId} client={client}
            onBeforeNavigate={reader.persist}
            onChanged={async () => {
                if (imageMode) await imageReader.refreshKnowledge();
                else await reader.refreshKnowledge();
            }} onClose={() => setInspection(null)} /> : null}
    </View>;
}
const styles = StyleSheet.create(theme => ({
    screen: (top: number, bottom: number) => ({ flex: 1, paddingTop: top, paddingBottom: bottom,
        backgroundColor: theme.colors.background }),
    workspace: { flex: 1, minHeight: 0, flexDirection: 'row' },
    rail: { width: 160, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderColor: theme.colors.border },
    railContent: { padding: theme.spacing.small, gap: theme.spacing.small },
    canvas: { flex: 1, minWidth: 0, minHeight: 0 },
    empty: { flex: 1, padding: theme.spacing.large, gap: theme.spacing.small },
    panel: { width: 360, flexGrow: 0, flexShrink: 0, borderLeftWidth: 1, borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface },
    overlayPanel: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 360,
        borderLeftWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    hidden: { display: 'none' },
    panelContent: { padding: theme.spacing.medium, gap: theme.spacing.compact },
}));
