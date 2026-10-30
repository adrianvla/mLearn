import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { DocumentAppearance, SourceAnchor } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Dialog } from '@mlearn/ui/dialog';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { Inspector, type Inspection } from '../inspector';
import { blockPosition, documentAnchor } from './documentFlow';
import { DocumentViewport } from './DocumentViewport';
import { useReader } from './useReader';
import { useImageReader } from './useImageReader';
import { ImageViewport } from './ImageViewport';
import { ImageLayoutControls, ImageReaderControls, ImageReaderFeedback, type ImageCropDraft } from './ImageReaderControls';
import { imageAnchor, imageContext } from './imageFlow';
import { ImageSourceWords } from './ImageSourceWords';
import { ImageRecognition } from './ImageRecognition';
import { SourceEntryScreen } from '../source-entry';
import { ReaderSearch } from './ReaderSearch';

export function ReaderScreen() {
    const host = useRuntime();
    const params = useLocalSearchParams<{ id: string; packageId?: string; materialId?: string; proposalId?: string; reviewSessionId?: string; reviewEncounterId?: string }>();
    const router = useRouter();
    if (!params.id && !params.materialId && !params.proposalId && !params.reviewSessionId && !params.reviewEncounterId)
        return <SourceEntryScreen kind="document" preferredPackage={typeof params.packageId === 'string' ? params.packageId : undefined} />;
    if (!host.available) return <View style={styles.unavailable}>
        <Button label="Home" variant="quiet" onPress={() => router.replace('/')} />
        <Text accessibilityRole="alert">{host.reason}</Text>
    </View>;
    return <ReaderWorkspace client={host.client} id={typeof params.id === 'string' ? params.id : ''}
        materialId={typeof params.materialId === 'string' ? params.materialId : undefined}
        proposalId={typeof params.proposalId === 'string' ? params.proposalId : undefined}
        reviewSessionId={typeof params.reviewSessionId === 'string' ? params.reviewSessionId : undefined}
        reviewEncounterId={typeof params.reviewEncounterId === 'string' ? params.reviewEncounterId : undefined} />;
}

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
    const [toolbarWidth, setToolbarWidth] = useState(viewport.width);
    const insets = useSafeAreaInsets();
    const [inspection, setInspection] = useState<Inspection | null>(null);
    const [focused, setFocused] = useState(true);
    const [departing, setDeparting] = useState(false);
    const departure = useRef<object | null>(null);
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    useFocusEffect(useCallback(() => {
        setFocused(true);
        return () => { departure.current = null; setDeparting(false); setFocused(false); setInspection(null); setOptionsOpen(false); setContentsOpen(false);
            setRecognitionOpen(false); setWordsOpen(false); setThumbnails({}); };
    }, []));
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [contentsOpen, setContentsOpen] = useState(false);
    const [recognitionOpen, setRecognitionOpen] = useState(false);
    const [wordsOpen, setWordsOpen] = useState(false);
    const optionsTrigger = useRef<View>(null);
    const recognitionTrigger = useRef<View>(null);
    const wordsTrigger = useRef<View>(null);
    const [railOpen, setRailOpen] = useState(true);
    const [navigationError, setNavigationError] = useState('');
    const [contentsAfter, setContentsAfter] = useState<number | null>(null);
    const [cropMode, setCropMode] = useState(false);
    const [cropDraft, setCropDraft] = useState<ImageCropDraft | null>(null);
    useEffect(() => { if (cropDraft) setOptionsOpen(true); }, [cropDraft]);
    const [magnifier, setMagnifier] = useState(false);
    const [highlighted, setHighlighted] = useState<SourceAnchor | null>(null);
    const source = reader.window?.source;
    const sourceIdentity = JSON.stringify([id, source?.contentRevision, source?.parserRevision,
        source?.packageId, source?.packageVersion, reader.window?.blocks.map(block => [block.resource, block.id])]);
    useEffect(() => { setInspection(null); setRecognitionOpen(false); setWordsOpen(false); }, [sourceIdentity, reader.pending]);
    useEffect(() => { setThumbnails({}); }, [sourceIdentity]);
    const current = useRef(sourceIdentity); current.current = sourceIdentity;
    const sourceWindow = reader.window;
    const visibleBlock = Math.max(0, sourceWindow?.blocks.findIndex(block =>
        block.resource === reader.position?.resource && block.id === reader.position.blockId) ?? 0);
    const imageMode = reader.imageMode;
    const pageIndex = sourceWindow?.blocks[visibleBlock]?.page
        ?? (reader.returned?.locator.kind === 'image' ? reader.returned.locator.pageIndex ?? 0 : 0);
    const imageReader = useImageReader(host.available ? host : null, source, pageIndex,
        imageMode && focused, reader.returnedPage,
        reader.languages.some(plugin => plugin.id === source?.packageId && plugin.capabilities.includes('image.ocr.postprocess.v1')),
        reader.navigate);
    const imageRevision = JSON.stringify(imageReader.pages.map(item => [item.descriptor.resourceId, item.page?.ocrRevision]));
    useEffect(() => { setImageView(null); }, [id, materialId, reviewSessionId, reviewEncounterId]);
    useEffect(() => { setInspection(null); setCropMode(false); setCropDraft(null); setMagnifier(false); setHighlighted(null); }, [imageRevision]);
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
        setDeparting(true); setNavigationError('');
        try {
            await reader.persist();
            if (departure.current === request && current.current === identity) complete();
        } catch (cause) {
            if (departure.current === request && current.current === identity)
                setNavigationError(cause instanceof Error ? cause.message : String(cause));
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
    const wide = toolbarWidth >= 900 * theme.textScale;
    const compact = toolbarWidth < 700 * theme.textScale;
    const layoutInline = toolbarWidth >= 1200 * theme.textScale;
    const rail = wide && railOpen && sourceWindow;
    const navigation = <Row wrap={false}>
        <Button label={imageMode ? 'Previous page' : 'Previous passage'} icon="arrowLeft" iconOnly
            variant="secondary" size="compact" disabled={reader.pending || (imageMode
                ? imageReader.pending || !imageReader.indices.length || imageReader.indices[0] === 0 : !previous)}
            onPress={() => { setInspection(null); if (imageMode) void imageReader.go('previous'); else if (previous) void reader.navigate(previous); }} />
        <Button label={imageMode ? 'Next page' : 'Next passage'} icon="chevronRight" iconOnly
            variant="secondary" size="compact" disabled={reader.pending || (imageMode
                ? imageReader.pending || !imageReader.indices.length
                    || imageReader.indices[imageReader.indices.length - 1] + 1 >= (source?.totalPages ?? 0) : !next)}
            onPress={() => { setInspection(null); if (imageMode) void imageReader.go('next'); else if (next) void reader.navigate(next); }} />
    </Row>;
    const contents = <>
        {reader.contentsPending ? <Text accessibilityLiveRegion="polite">Loading contents…</Text> : null}
        {reader.contentsError ? <><Text accessibilityRole="alert">{reader.contentsError}</Text>
            <Button label="Retry contents" variant="secondary" disabled={reader.contentsPending}
                onPress={() => void reader.loadContents(contentsAfter)} /></> : null}
        {reader.contents?.items.map(item => <Button key={JSON.stringify(item.position)}
            label={item.label} variant="secondary" disabled={reader.pending}
            accessibilityState={{ selected: reader.position?.resource === item.position.resource
                && reader.position.blockId === item.position.blockId }}
            onPress={() => { setContentsOpen(false); void (imageMode ? imageReader.navigate(item.position) : reader.navigate(item.position)); }} />)}
        {reader.contents && !reader.contents.items.length ? <Text muted>No contents entries in this document.</Text> : null}
        <Row><Button label="First contents" variant="quiet" disabled={reader.contentsPending || contentsAfter === null}
            onPress={() => { setContentsAfter(null); void reader.loadContents(); }} />
            <Button label="More contents" variant="quiet" disabled={reader.contentsPending || reader.contents?.nextOffset == null}
                onPress={() => {
                    const next = reader.contents?.nextOffset;
                    if (next != null) { setContentsAfter(next); void reader.loadContents(next); }
                }} /></Row>
    </>;
    return <View style={styles.screen(insets.top, insets.bottom)}>
        <View testID="reader-toolbar" onLayout={event => setToolbarWidth(event.nativeEvent.layout.width)}
            style={[styles.header,
            { paddingLeft: host.available ? Math.max(8, host.windowControlsWidth ?? 0) : 8 }]}
            >
            <View style={styles.toolbar}>
                <Button label="Home" icon="arrowLeft" iconOnly={compact} size="compact" variant="secondary"
                    disabled={reader.pending || departing} onPress={() => router.dismissTo('/')} />
                {wide ? <Button label={railOpen ? 'Hide source navigation' : 'Show source navigation'}
                    icon="transcript" iconOnly size="compact" variant="quiet" accessibilityState={{ expanded: !!rail }}
                    onPress={() => setRailOpen(value => !value)} /> : null}
                <View style={styles.title}><Text variant="navigation" numberOfLines={1}
                    accessibilityRole="header" testID="reader-title">{source?.title ?? 'Reader'}</Text></View>
                {navigation}
                {reader.pending ? <Button label="Cancel loading" icon="stop" iconOnly={compact} variant="secondary" size="compact"
                    onPress={() => void reader.cancel()} /> : null}
                {imageMode && imageReader.recognizing ? <Button label="Cancel recognition" icon="stop" iconOnly={compact}
                    variant="secondary" size="compact" onPress={imageReader.cancel} /> : null}
                {imageMode && layoutInline ? <ImageLayoutControls reader={imageReader} onBeforeAction={() => setInspection(null)} /> : null}
                {source && focused ? <ReaderSearch key={JSON.stringify([source.id, source.contentRevision,
                    source.parserRevision, source.packageId, source.packageVersion, imageMode])}
                    client={client} source={source} scope={imageMode ? 'recognized_pages' : 'text'}
                    position={reader.position} compact={compact} disabled={reader.pending}
                    onOpen={() => setInspection(null)}
                    onLocate={hit => { if (imageMode) imageReader.cancel(); return reader.locate(hit.anchor); }}
                    onReturn={point => imageMode ? imageReader.navigate(point) : reader.navigate(point)} /> : null}
                <Dialog title="Contents" description="Navigate to the original document location."
                    open={contentsOpen} onOpenChange={open => {
                        setContentsOpen(open); setInspection(null);
                        if (open) void reader.loadContents(contentsAfter);
                    }} trigger={<Button label="Contents" icon="book" iconOnly={compact} variant="secondary" size="compact" disabled={!source} />}>
                    {contents}
                </Dialog>
                <Dialog title="Reader appearance" description="Changes are saved for this source and preserve its visible text position."
                    open={optionsOpen} onOpenChange={open => { setOptionsOpen(open); setInspection(null); }}
                    trigger={<Button ref={optionsTrigger} label="View options" icon="settings" iconOnly={compact} variant="secondary" size="compact" disabled={!source || reader.pending} />}>
                    {source?.format === 'pdf' ? <Button
                        label={imageMode ? 'Read available PDF text' : 'View original PDF pages'} variant="secondary" size="compact"
                        onPress={() => { setInspection(null); setImageView(!imageMode); setOptionsOpen(false); }} /> : null}
                    {imageMode ? <ImageReaderControls reader={imageReader} cropMode={cropMode} cropDraft={cropDraft} magnifier={magnifier}
                        layoutInline={layoutInline}
                        onCropMode={enabled => { setCropMode(enabled); if (enabled) setMagnifier(false); }}
                        onMagnifier={enabled => { setMagnifier(enabled); if (enabled) setCropMode(false); }}
                        onBeforeAction={() => setInspection(null)} onReturnToSource={() => setOptionsOpen(false)}
                        onCropConsumed={() => setCropDraft(null)}>
                        <Button ref={wordsTrigger} label="Page words" variant="secondary" size="compact"
                            disabled={!imageReader.pages.some(page => page.batch)}
                            onPress={() => { setInspection(null); setMagnifier(false); setWordsOpen(true); }} />
                        <Button ref={recognitionTrigger} label="Recognition details" variant="secondary" size="compact"
                            disabled={!imageReader.pages.some(page => page.page?.regions.length)}
                            onPress={() => { setInspection(null); setMagnifier(false); setCropMode(false); setRecognitionOpen(true); }} />
                    </ImageReaderControls> : null}
                    {source ? <>
                        {!imageMode ? <>
                        <Text variant="groupTitle">Writing</Text>
                        <Row>{([
                            ['auto', 'Automatic'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'],
                        ] as const).map(([writingMode, label]) => <Button key={writingMode} label={label}
                            disabled={reader.pending}
                            variant="secondary" accessibilityState={{ selected: source.appearance.writingMode === writingMode }}
                            onPress={() => changeAppearance({ writingMode })} />)}</Row>
                        <Text variant="caption" muted>Automatic follows authored writing direction. Without an authored direction, text flows horizontally.</Text>
                        <Text variant="groupTitle">Font</Text>
                        <Row>{([
                            ['source', 'Source default'], ['serif', 'Serif'], ['sans', 'Sans serif'],
                        ] as const).map(([font, label]) => <Button key={font} label={label}
                            disabled={reader.pending}
                            variant="secondary" accessibilityState={{ selected: source.appearance.font === font }}
                            onPress={() => changeAppearance({ font })} />)}</Row>
                        <Text>Text size · {source.appearance.fontSize}</Text>
                        <Row>
                            <Button label="Smaller text" variant="secondary" disabled={reader.pending || source.appearance.fontSize <= 12}
                                onPress={() => changeAppearance({ fontSize: Math.max(12, source.appearance.fontSize - 2) })} />
                            <Button label="Larger text" variant="secondary" disabled={reader.pending || source.appearance.fontSize >= 48}
                                onPress={() => changeAppearance({ fontSize: Math.min(48, source.appearance.fontSize + 2) })} />
                        </Row>
                        <Text>Line height · {source.appearance.lineHeight.toFixed(1)}</Text>
                        <Row>
                            <Button label="Tighter lines" variant="secondary" disabled={reader.pending || source.appearance.lineHeight <= 1}
                                onPress={() => changeAppearance({ lineHeight: Math.max(1, Math.round((source.appearance.lineHeight - 0.1) * 10) / 10) })} />
                            <Button label="Looser lines" variant="secondary" disabled={reader.pending || source.appearance.lineHeight >= 2.5}
                                onPress={() => changeAppearance({ lineHeight: Math.min(2.5, Math.round((source.appearance.lineHeight + 0.1) * 10) / 10) })} />
                        </Row>
                        <Text>Letter spacing · {source.appearance.letterSpacing.toFixed(1)}</Text>
                        <Row>
                            <Button label="Tighter letters" variant="secondary" disabled={reader.pending || source.appearance.letterSpacing <= -1}
                                onPress={() => changeAppearance({ letterSpacing: Math.max(-1, source.appearance.letterSpacing - 0.5) })} />
                            <Button label="Looser letters" variant="secondary" disabled={reader.pending || source.appearance.letterSpacing >= 4}
                                onPress={() => changeAppearance({ letterSpacing: Math.min(4, source.appearance.letterSpacing + 0.5) })} />
                        </Row>
                        </> : null}
                        <Text variant="groupTitle">Source language</Text>
                        <Select testID="reader-language-select" label="Document source language" value={source.packageId} disabled={reader.pending}
                            options={reader.languages.map(plugin => ({ value: plugin.id, label: plugin.displayName ?? plugin.id,
                                testID: `reader-language-${plugin.id}` }))}
                            onValueChange={packageId => { if (packageId !== source.packageId) void reader.setLanguage(packageId); }} />
                        {reader.languages.some(plugin => plugin.id === source.packageId && plugin.version !== source.packageVersion)
                            ? <Button label="Use installed language version" variant="secondary" disabled={reader.pending}
                                onPress={() => void reader.setLanguage(source.packageId)} /> : null}
                        <Button label="App appearance" variant="quiet" onPress={() => { setOptionsOpen(false); router.push('/settings'); }} />
                        {source.fidelity.length ? <>
                            <Text variant="groupTitle">Source fidelity</Text>
                            <Text variant="detail" muted selectable testID="reader-fidelity">{source.fidelity.join('\n\n')}</Text>
                        </> : null}
                    </> : null}
                </Dialog>
            </View>
        </View>
        {imageMode ? <ImageReaderFeedback reader={imageReader} cropMode={cropMode} magnifier={magnifier} /> : null}
            {reader.error ? <View style={styles.feedback}><Text accessibilityRole="alert">{reader.error}</Text>
                <Row><Button label="Retry document" variant="secondary" size="compact" onPress={reader.retry} />
                    <Button label="Reselect from Home" variant="quiet" size="compact" disabled={departing}
                        onPress={() => router.dismissTo('/')} /></Row></View> : null}
            {navigationError ? <Text accessibilityRole="alert">{navigationError}</Text> : null}
        <View style={styles.workspace}>
            {rail && sourceWindow ? <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>
                {sourceWindow.blocks.map(block => <View key={JSON.stringify([block.resource, block.id])} style={styles.preview}>
                    {block.image && thumbnails[block.image.resourceId] ? <Image
                        source={{ uri: thumbnails[block.image.resourceId] }} style={styles.thumbnail} resizeMode="contain"
                        accessibilityLabel={block.image.alt || 'Source image thumbnail'} /> : null}
                    <Text variant="detail" numberOfLines={7}>{block.image ? block.image.alt || 'Image' : block.text || 'Text unavailable'}</Text>
                    <Button label={block.page === null ? 'Read passage' : `Page ${block.page + 1}`}
                        accessibilityLabel={`Read ${block.resource} ${block.id}`} size="compact" variant="secondary"
                        accessibilityState={{ selected: reader.position?.resource === block.resource && reader.position.blockId === block.id }}
                        disabled={reader.pending} onPress={() => {
                            const position = blockPosition(sourceWindow.source, block);
                            void (imageMode ? imageReader.navigate(position) : reader.navigate(position));
                        }} />
                </View>)}
            </ScrollView> : null}
            {sourceWindow && focused && imageMode && imageReader.settings ? <ImageViewport source={sourceWindow.source}
                pages={imageReader.pages} settings={imageReader.settings} returned={highlighted ?? reader.returned} cropMode={cropMode} magnifier={magnifier}
                onRetry={imageReader.retry}
                onDismissInspection={() => setInspection(null)}
                onMagnify={(resourceId, crop) => host.available ? host.ocr.uri(sourceWindow.source.id, resourceId, crop)
                    : Promise.reject(new Error('Native source pixels are unavailable.'))}
                onThumbnail={(resourceId, uri) => setThumbnails(previous => previous[resourceId] === uri
                    ? previous : { ...previous, [resourceId]: uri })}
                onCrop={(resourceId, crop) => { setCropMode(false); setCropDraft({ resourceId, crop }); }}
                onNavigate={direction => { if (!reader.pending) { setInspection(null); void imageReader.go(direction); } }}
                onInspect={(resourceId, regionId, start, anchor) => {
                    const item = imageReader.pages.find(page => page.descriptor.resourceId === resourceId);
                    const region = item?.page?.regions.find(value => value.id === regionId);
                    const analyzed = item?.batch?.regions.find(value => value.regionId === regionId);
                    const token = analyzed?.tokens.find(value => value.start === start);
                    if (!item?.page || !item.batch || !region || !token?.targets.length || reader.pending
                        || item.batch.packageId !== sourceWindow.source.packageId
                        || item.batch.packageVersion !== sourceWindow.source.packageVersion) return;
                    const nearby = imageContext(item.page, region);
                    reader.onPosition(item.descriptor.position, true);
                    setInspection({ sourceForm: token.text, context: nearby, targets: token.targets, anchor,
                        sourceAnchor: imageAnchor(sourceWindow.source, item.page, item.descriptor.pageIndex, region, token),
                        packageRevision: item.batch.packageRevision });
                }} /> : sourceWindow && focused && !imageMode ? <DocumentViewport window={sourceWindow} batch={reader.batch} target={reader.position}
                returned={reader.returned} inspecting={inspection !== null} onPosition={reader.onPosition}
                onThumbnail={(resourceId, uri) => setThumbnails(previous => previous[resourceId] === uri
                    ? previous : { ...previous, [resourceId]: uri })}
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
                    setInspection({ sourceForm: token.text, context: block.text, targets: token.targets, anchor,
                        sourceAnchor: documentAnchor(sourceWindow.source, block, token), packageRevision: batch.packageRevision });
                }} /> : !sourceWindow ? <View style={styles.empty}><Text accessibilityLiveRegion="polite">
                    {reader.pending ? 'Opening document…' : 'Document unavailable. Retry opening it or reselect it from Home.'}
                </Text></View> : null}
        </View>
        <View testID="reader-status" style={styles.status}>
            <Row wrap={false}>
                <View style={styles.position}><Text variant="detail" muted numberOfLines={1} testID="reader-position">
                    {imageMode && imageReader.pages.length ? `Page ${imageReader.pages.map(item => item.descriptor.pageIndex + 1).join('–')} of ${source?.totalPages ?? 0}`
                        : reader.position ? `${reader.position.resource} · ${reader.position.blockId} · byte ${reader.position.offset}` : 'No visible position'}
                </Text></View>
                {source && !compact ? <Text variant="detail" muted>{source.format.toUpperCase()} · {source.totalBlocks} source blocks</Text> : null}
                {(imageMode ? imageReader.pages.some(item => item.analyzing) : reader.analysisPending)
                    ? <Text variant="detail" accessibilityLiveRegion="polite">Analyzing visible text…</Text> : null}
                <Button label="Save position" variant="quiet" size="compact" disabled={!source}
                    onPress={() => void reader.persist().catch(() => { /* Reader save feedback owns recovery. */ })} />
            </Row>
            {reader.analysisError ? <Row><Text variant="caption" accessibilityRole="alert">{reader.analysisError}</Text>
                <Button label="Retry analysis" variant="secondary" size="compact" onPress={reader.retryAnalysis} /></Row> : null}
            {reader.saveError ? <Row><Text variant="caption" accessibilityRole="alert">Progress not saved: {reader.saveError}</Text>
                <Button label="Retry saving position" variant="secondary" size="compact"
                    onPress={() => void reader.persist().catch(() => { /* Visible feedback retains the failed save. */ })} /></Row> : null}
        </View>
        {imageMode && source ? <>
            <ImageRecognition client={client} reader={imageReader} open={recognitionOpen} onOpenChange={setRecognitionOpen}
                focusTarget={() => focused ? recognitionTrigger.current ?? optionsTrigger.current : null} />
            <ImageSourceWords client={client} source={source} pages={imageReader.pages} open={wordsOpen}
                onOpenChange={setWordsOpen} triggerRef={wordsTrigger}
                focusTarget={() => focused ? wordsTrigger.current ?? optionsTrigger.current : null}
                onInspect={setInspection} onAnalyze={imageReader.analyze}
                onLocate={anchor => {
                    const locator = anchor.locator;
                    if (locator.kind !== 'image') return;
                    const item = imageReader.pages.find(item => item.descriptor.resourceId === locator.resourceId);
                    if (item) { setOptionsOpen(false); setInspection(null); reader.onPosition(item.descriptor.position, true); setHighlighted(anchor); }
                }} />
        </> : null}
        {inspection && source && host.available ? <Inspector inspection={inspection} packageId={source.packageId} client={client}
            onBeforeOpenMaterial={reader.persist}
            onChanged={async () => {
                const identity = current.current;
                if (imageMode) await imageReader.refreshKnowledge();
                else await reader.refreshKnowledge();
                if (current.current !== identity) return;
            }} onClose={() => setInspection(null)} /> : null}
    </View>;
}
const styles = StyleSheet.create(theme => ({
    screen: (top: number, bottom: number) => ({ flex: 1, paddingTop: top, paddingBottom: bottom,
        backgroundColor: theme.colors.background }),
    unavailable: { flex: 1, padding: theme.spacing.large, gap: theme.spacing.medium },
    header: { flexShrink: 0, paddingHorizontal: theme.spacing.small, paddingVertical: theme.spacing.small,
        borderBottomWidth: 1, borderColor: theme.colors.border },
    toolbar: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: theme.spacing.small, minWidth: 0 },
    title: { flex: 1, minWidth: 0 },
    workspace: { flex: 1, minHeight: 0, flexDirection: 'row' },
    rail: { width: 160, flexGrow: 0, flexShrink: 0, borderRightWidth: 1, borderColor: theme.colors.border },
    railContent: { padding: theme.spacing.small, gap: theme.spacing.small },
    preview: { padding: theme.spacing.small, gap: theme.spacing.small, borderWidth: 1,
        borderColor: theme.colors.border, borderRadius: theme.radius, backgroundColor: theme.surfaces.glass },
    thumbnail: { width: '100%', height: 120 },
    empty: { flex: 1, padding: theme.spacing.large },
    feedback: { gap: theme.spacing.small },
    status: { paddingHorizontal: theme.spacing.small,
        borderTopWidth: 1, borderColor: theme.colors.border, maxHeight: '30%', gap: theme.spacing.tiny },
    position: { flex: 1, minWidth: 0 },
}));
