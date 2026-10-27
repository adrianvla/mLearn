import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { DocumentRecord, ImageReaderSettings, OcrRect, SourceAnchor } from '@mlearn/contracts';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import { Text } from '@mlearn/ui/text';
import { Button } from '@mlearn/ui/button';
import ImageCanvas, { type ImageCanvasRef } from './ImageCanvas';
import type { ImageReaderPage } from './useImageReader';
import { useSourceAnchor } from './useSourceAnchor';

/** The same native/DOM anchor owner serves ordinary documents and original
 * image regions. Only bounded IDs/rectangles return from the content surface.
 */
export function ImageViewport({ source, pages, settings, returned, cropMode, magnifier, onInspect, onCrop,
    onMagnify, onDismissInspection, onThumbnail, onNavigate, onRetry }: {
    readonly source: DocumentRecord;
    readonly pages: readonly ImageReaderPage[];
    readonly settings: ImageReaderSettings;
    readonly returned: SourceAnchor | null;
    readonly cropMode: boolean;
    readonly magnifier: boolean;
    readonly onInspect: (resourceId: string, regionId: string, tokenStart: number, anchor: TextAnchor) => void;
    readonly onCrop: (resourceId: string, crop: OcrRect) => void;
    readonly onMagnify: (resourceId: string, crop: OcrRect) => Promise<string>;
    readonly onDismissInspection: () => void;
    readonly onThumbnail: (resourceId: string, uri: string) => void;
    readonly onNavigate: (direction: 'previous' | 'next') => void;
    readonly onRetry: () => void;
}) {
    const { theme } = useUnistyles();
    const container = useRef<View>(null);
    const canvas = useRef<ImageCanvasRef>(null);
    const handlers = useRef({ pages, onInspect, onCrop, onMagnify, onDismissInspection, onThumbnail, onNavigate });
    handlers.current = { pages, onInspect, onCrop, onMagnify, onDismissInspection, onThumbnail, onNavigate };
    const [rendered, setRendered] = useState('');
    const [failure, setFailure] = useState('');
    const pixelIdentity = JSON.stringify([source.id, source.contentRevision]);
    const pixels = useRef(pixelIdentity); pixels.current = pixelIdentity;
    const identity = JSON.stringify([pixelIdentity, source.packageId, source.packageVersion,
        pages.map(item => [item.descriptor.resourceId, item.page?.ocrRevision, item.batch?.packageRevision])]);
    const loading = pages.length > 0 && rendered !== identity && failure !== identity;
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
        display={{ background: theme.media.background, color: theme.colors.text, knownColor: theme.feedback.success,
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
        onReady={async key => { if (key === anchors.active.current) { setRendered(key); setFailure(''); } }}
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
        onMagnify={async (key, resourceId, crop) => {
            if (key !== pixels.current || !handlers.current.pages.some(page => page.descriptor.resourceId === resourceId))
                throw new Error('This source image is no longer visible.');
            return handlers.current.onMagnify(resourceId, crop);
        }}
        onMagnifierActive={async (key, active) => {
            if (key === anchors.active.current && active) handlers.current.onDismissInspection();
        }}
        onThumbnail={async (key, resourceId, uri) => {
            if (key === anchors.active.current) handlers.current.onThumbnail(resourceId, uri);
        }}
        onImageError={async key => { if (key === anchors.active.current) setFailure(key); }}
        onNavigate={async (key, direction) => {
            if (key === anchors.active.current) handlers.current.onNavigate(direction);
        }} />, [identity, pixelIdentity, pages, settings, cropMode, magnifier, returned, theme.media.background, theme.colors.text,
        theme.media.text, theme.media.chrome, theme.media.border, theme.typography.detail,
        theme.feedback.success, theme.source.selection, theme.typography.body._web.fontFamily]);
    return <View ref={container} collapsable={false} style={styles.viewport} onLayout={anchors.notify}
        testID={pages.length === 0 ? 'reader-image-empty' : rendered === identity ? 'reader-image-ready' : 'reader-image-loading'}
        accessibilityState={{ busy: loading }}>
        {content}
        {loading ? <View pointerEvents="none" style={styles.feedback}>
            <Text variant="caption" accessibilityLiveRegion="polite">Opening image…</Text>
        </View> : null}
        {failure === identity ? <View style={styles.feedback}>
            <Text variant="caption" accessibilityRole="alert">The original image could not be displayed.</Text>
            <Button label="Retry source images" variant="secondary" size="compact" onPress={onRetry} />
        </View> : null}
    </View>;
}
const styles = StyleSheet.create(theme => ({
    viewport: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', backgroundColor: theme.media.background },
    feedback: { position: 'absolute', top: theme.spacing.small, left: theme.spacing.small, right: theme.spacing.small,
        padding: theme.spacing.small, gap: theme.spacing.small, backgroundColor: theme.colors.surface, borderRadius: theme.radius },
}));
