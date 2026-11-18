import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { DocumentRecord, ImageReaderSettings, OcrRect, SourceAnchor } from '@mlearn/contracts';
import type { InspectionMode, TextAnchor } from '@mlearn/ui/inline-word';
import type { SourceThumbnail } from '@mlearn/ui/source-preview';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import ImageCanvas, { type ImageCanvasRef } from './ImageCanvas';
import { imageFrame } from './imageFlow';
import type { ImageReaderPage } from './useImageReader';
import { useSourceAnchor } from './useSourceAnchor';

/** The same native/DOM anchor owner serves ordinary documents and original
 * image regions. Only bounded IDs/rectangles return from the content surface.
 */
export type PageNotice = { readonly message: string; readonly action: string | null; readonly onAction: () => void };

export function ImageViewport({ source, pages, settings, returned, cropMode, magnifier, inspectionMode, recognizing, notice,
    onCancelRecognition, onInspect, onCrop, onDismissInspection, onThumbnail, onNavigate, onRetry }: {
    readonly source: DocumentRecord;
    readonly pages: readonly ImageReaderPage[];
    readonly settings: ImageReaderSettings;
    readonly returned: SourceAnchor | null;
    readonly cropMode: boolean;
    readonly magnifier: boolean;
    readonly inspectionMode: InspectionMode;
    readonly recognizing: boolean;
    readonly notice: PageNotice | null;
    readonly onCancelRecognition: () => void;
    readonly onInspect: (resourceId: string, regionId: string, tokenStart: number, anchor: TextAnchor) => void;
    readonly onCrop: (resourceId: string, crop: OcrRect) => void;
    readonly onDismissInspection: () => void;
    readonly onThumbnail: (resourceId: string, thumbnail: SourceThumbnail) => void;
    readonly onNavigate: (direction: 'previous' | 'next') => void;
    readonly onRetry: () => void;
}) {
    const { theme } = useUnistyles();
    const container = useRef<View>(null);
    const canvas = useRef<ImageCanvasRef>(null);
    const handlers = useRef({ pages, onInspect, onCrop, onDismissInspection, onThumbnail, onNavigate });
    handlers.current = { pages, onInspect, onCrop, onDismissInspection, onThumbnail, onNavigate };
    const [rendered, setRendered] = useState('');
    const [renderedSpread, setRenderedSpread] = useState('');
    const [failure, setFailure] = useState('');
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [aspects, setAspects] = useState<Record<string, number>>({});
    const pixelIdentity = JSON.stringify([source.id, source.contentRevision]);
    const pixels = useRef(pixelIdentity); pixels.current = pixelIdentity;
    const identity = JSON.stringify([pixelIdentity, source.packageId, source.packageVersion,
        pages.map(item => [item.descriptor.resourceId, item.page?.ocrRevision, item.batch?.packageRevision])]);
    // Only new page pixels count as opening; a recognition or lookup revision
    // of the page already on screen is not a page load.
    const spread = JSON.stringify([pixelIdentity, pages.map(item => item.descriptor.resourceId)]);
    const spreads = useRef(new Map<string, string>()); spreads.current.set(identity, spread);
    const loading = pages.length > 0 && renderedSpread !== spread && failure !== identity;
    const anchors = useSourceAnchor(identity, container, canvas);
    const selected = returned?.locator.kind === 'image' ? {
        resourceId: returned.locator.resourceId, ocrRevision: returned.locator.ocrRevision, regionId: returned.locator.regionId,
        start: returned.locator.contextStart + returned.locator.selectionStart,
        end: returned.locator.contextStart + returned.locator.selectionEnd,
    } : null;
    const content = useMemo(() => <ImageCanvas ref={canvas} identity={identity} sourceIdentity={pixelIdentity}
        pages={pages.map(item => ({ resourceId: item.descriptor.resourceId, index: item.descriptor.pageIndex,
            page: item.page, batch: item.batch ? { regions: item.batch.regions, annotations: item.batch.annotations } : null }))}
        settings={settings} cropMode={cropMode} magnifier={magnifier} selection={selected}
        display={{ background: theme.media.background, color: theme.colors.text, knownColor: theme.feedback.success, inspectionMode,
            selectionColor: theme.source.selection, fontFamily: theme.typography.body._web.fontFamily,
            lens: { color: theme.media.text, background: theme.media.chrome, border: theme.media.border,
                caption: theme.typography.detail } }}
        dom={{ useExpoDOMWebView: true, unstable_useExpoModulesBridge: false, scrollEnabled: false,
            style: { flex: 1 }, contentInsetAdjustmentBehavior: 'never' }}
        onImage={async (key, resourceId) => {
            const page = handlers.current.pages.find(item => item.descriptor.resourceId === resourceId);
            if (key !== pixels.current || !page) throw new Error('This source image is no longer visible.');
            return page.uri;
        }}
        onReady={async key => {
            if (key !== anchors.active.current) return;
            setRendered(key); setRenderedSpread(spreads.current.get(key) ?? ''); setFailure('');
            spreads.current = new Map([[key, spreads.current.get(key) ?? '']]);
        }}
        onInspect={async (key, occurrence, resourceId, regionId, start, bounds) => {
            if (key === anchors.active.current)
                anchors.activate(occurrence, bounds, anchor => handlers.current.onInspect(resourceId, regionId, start, anchor));
        }}
        onMeasured={async (key, occurrence, request, bounds) => {
            if (key === anchors.active.current) anchors.measured(occurrence, request, bounds);
        }}
        onCrop={async (key, resourceId, crop) => {
            if (key === anchors.active.current) handlers.current.onCrop(resourceId, crop);
        }}
        onMagnifierActive={async (key, active) => {
            if (key === anchors.active.current && active) handlers.current.onDismissInspection();
        }}
        onThumbnail={async (key, resourceId, thumbnail) => {
            if (key !== anchors.active.current) return;
            handlers.current.onThumbnail(resourceId, thumbnail);
            const aspect = thumbnail.width / thumbnail.height;
            setAspects(previous => previous[resourceId] === aspect ? previous : { ...previous, [resourceId]: aspect });
        }}
        onImageError={async key => { if (key === anchors.active.current) setFailure(key); }}
        onNavigate={async (key, direction) => {
            if (key === anchors.active.current) handlers.current.onNavigate(direction);
        }} />, [identity, pixelIdentity, pages, settings, cropMode, magnifier, returned, inspectionMode, theme.media.background, theme.colors.text,
        theme.media.text, theme.media.chrome, theme.media.border, theme.typography.detail,
        theme.feedback.success, theme.source.selection, theme.typography.body._web.fontFamily]);
    // Recognition status sits at the bottom-right of the rendered spread, not
    // in the letterbox margin; unknown page sizes fall back to the viewport edge.
    const spreadAspect = pages.reduce((total, item) => total + (aspects[item.descriptor.resourceId] ?? NaN), 0);
    const frame = size.width && Number.isFinite(spreadAspect)
        ? imageFrame(spreadAspect, 1, { x: 0, y: 0, ...size }, settings.fit) : null;
    const statusPlacement = frame ? {
        right: Math.max(0, size.width - Math.min(size.width, frame.x + frame.width)) + theme.spacing.medium,
        bottom: Math.max(0, size.height - Math.min(size.height, frame.y + frame.height)) + theme.spacing.medium,
    } : null;
    return <View ref={container} collapsable={false} style={styles.viewport}
        onLayout={event => { anchors.notify(); setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height }); }}
        testID={pages.length === 0 ? 'reader-image-empty' : rendered === identity ? 'reader-image-ready' : 'reader-image-loading'}
        accessibilityState={{ busy: loading }}>
        {content}
        {loading ? <View pointerEvents="none" style={styles.opening} testID="reader-page-opening">
            <ActivityIndicator size="small" color={theme.media.muted} />
            <Text tone="media" variant="caption" muted accessibilityLiveRegion="polite">Opening page…</Text>
        </View> : null}
        {failure === identity ? <View style={styles.failure}>
            <FailureNotice tone="media" message="This page couldn’t be shown." testID="reader-page-failure">
                <Button label="Retry" accessibilityLabel="Retry showing this page" variant="secondary" size="compact" onPress={onRetry} />
            </FailureNotice>
        </View> : null}
        {recognizing ? <View style={[styles.status, statusPlacement]} testID="reader-recognizing">
            <View style={styles.spinner}><ActivityIndicator size="small" color={theme.colors.text} /></View>
            <View style={styles.chip}><Button label="Recognizing…" accessibilityHint="Stops text recognition" variant="secondary" size="compact"
                onPress={onCancelRecognition} /></View>
        </View> : notice ? <View style={[styles.status, statusPlacement]} testID="reader-recognition-notice">
            <View style={styles.notice}>
                <Text variant="caption" accessibilityRole="alert">{notice.message}</Text>
                {notice.action ? <Button label={notice.action} variant="secondary" size="compact" onPress={notice.onAction} /> : null}
            </View>
        </View> : null}
    </View>;
}
const styles = StyleSheet.create(theme => ({
    viewport: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', backgroundColor: theme.media.background },
    // Translucent over the page that stays visible underneath.
    opening: { position: 'absolute', top: theme.spacing.medium, alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
        gap: theme.spacing.small, paddingHorizontal: theme.spacing.medium, paddingVertical: theme.spacing.small,
        borderRadius: 999, backgroundColor: theme.media.chrome, _web: { userSelect: 'none' } },
    failure: { position: 'absolute', top: theme.spacing.medium, alignSelf: 'center', maxWidth: 360,
        padding: theme.spacing.medium, borderRadius: theme.radius, backgroundColor: theme.media.chrome },
    status: { position: 'absolute', right: theme.spacing.medium, bottom: theme.spacing.medium,
        alignItems: 'flex-end', gap: theme.spacing.small },
    chip: { borderRadius: theme.radius, backgroundColor: theme.colors.surface },
    spinner: { padding: theme.spacing.small, borderRadius: theme.radius, backgroundColor: theme.colors.surface },
    notice: { maxWidth: 320, padding: theme.spacing.small, gap: theme.spacing.small, alignItems: 'flex-start',
        borderRadius: theme.radius, backgroundColor: theme.colors.surface },
}));
