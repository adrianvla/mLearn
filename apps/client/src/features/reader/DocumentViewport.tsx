import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { DocumentAnalysisBatch, DocumentPosition, DocumentWindow, SourceAnchor } from '@mlearn/contracts';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import DocumentCanvas, { type DocumentCanvasRef, type DocumentImageView } from './DocumentCanvas';
import { useSourceAnchor } from './useSourceAnchor';

/** Only this adapter turns WebView-local CSS pixels into native viewport
 * coordinates. Functions stay here; the DOM bridge carries rectangles/IDs.
 */
export function DocumentViewport({ window, batch, target, returned, inspecting, onPosition, onInspect, onThumbnail, onNavigate }: {
    readonly window: DocumentWindow;
    readonly batch: DocumentAnalysisBatch | null;
    readonly target: DocumentPosition | null;
    readonly returned: SourceAnchor | null;
    readonly inspecting: boolean;
    readonly onPosition: (position: DocumentPosition, checkpoint: boolean) => void;
    readonly onInspect: (resource: string, blockId: string, start: number, anchor: TextAnchor) => void;
    readonly onThumbnail: (resourceId: string, uri: string) => void;
    readonly onNavigate: (direction: 'previous' | 'next') => void;
}) {
    const host = useRuntime();
    const { theme } = useUnistyles();
    const container = useRef<View>(null);
    const canvas = useRef<DocumentCanvasRef>(null);
    const handlers = useRef({ onPosition, onInspect, onThumbnail, onNavigate });
    handlers.current = { onPosition, onInspect, onThumbnail, onNavigate };
    const [imageState, setImageState] = useState<{ identity: string; items: DocumentImageView[] }>({ identity: '', items: [] });
    const [imageReload, setImageReload] = useState(0);
    const [renderedIdentity, setRenderedIdentity] = useState('');
    const source = window.source;
    const identity = JSON.stringify([source.id, source.contentRevision, source.parserRevision,
        source.packageId, source.packageVersion, window.blocks.map(block => [block.resource, block.id])]);
    const anchors = useSourceAnchor(identity, container, canvas);
    const active = anchors.active;
    const imageIds = [...new Set(window.blocks.flatMap(block => block.image ? [block.image.resourceId] : []))];
    const imageKey = JSON.stringify(imageIds);
    const images = imageState.identity === identity ? imageState.items : [];
    function updateImages(update: (previous: DocumentImageView[]) => DocumentImageView[]) {
        setImageState(previous => previous.identity === identity ? { identity, items: update(previous.items) } : previous);
    }
    useEffect(() => {
        let live = true;
        setImageState({ identity, items: imageIds.map(resourceId => ({ resourceId, uri: null, error: '' })) });
        if (!host.available) return;
        void (async () => {
            for (const resourceId of imageIds) {
                if (!live) break;
                try {
                    const location = await host.client.documentResource(source.id, resourceId);
                    if (!live) break;
                    const uri = await host.documents.uri(location);
                    if (live && active.current === identity)
                        updateImages(previous => previous.map(item => item.resourceId === resourceId ? { ...item, uri, error: '' } : item));
                } catch (cause) {
                    if (live && active.current === identity)
                        updateImages(previous => previous.map(item => item.resourceId === resourceId
                            ? { ...item, uri: null, error: cause instanceof Error ? cause.message : String(cause) } : item));
                }
            }
        })();
        return () => { live = false; };
    }, [host, identity, imageKey, imageReload]);
    const selection = returned?.locator.kind === 'document' ? {
        resource: returned.locator.resource, blockId: returned.locator.blockId,
        start: returned.locator.contextStart + returned.locator.selectionStart,
        end: returned.locator.contextStart + returned.locator.selectionEnd,
    } : null;
    // Visible-position display updates must not marshal 64 KiB of unchanged
    // source through the native bridge on every scroll frame. A new projection,
    // appearance, image or accepted theme is a real content-layout update.
    const content = useMemo(() => <DocumentCanvas ref={canvas} identity={identity} parserRevision={source.parserRevision}
            blocks={window.blocks} batch={batch} appearance={source.appearance} target={target} inspecting={inspecting}
            selection={selection} images={images}
            display={{ background: theme.shell.canvas, color: theme.colors.text, knownColor: theme.feedback.success,
                selectionColor: theme.source.selection,
                muted: theme.colors.muted, selection: theme.controls.selected,
                fontFamily: theme.typography.body._web.fontFamily, textScale: theme.textScale, caption: theme.typography.detail }}
            dom={{ useExpoDOMWebView: true, unstable_useExpoModulesBridge: false, scrollEnabled: false,
                style: { flex: 1 }, contentInsetAdjustmentBehavior: 'never' }}
            onPosition={async (key, point, checkpoint) => {
                if (key !== active.current) return;
                // The native window/footer arrives before the isolated DOM has
                // laid out any source. Only its visible-block report is ready.
                setRenderedIdentity(key);
                handlers.current.onPosition(point, checkpoint);
            }}
            onInspect={async (key, selectedOccurrence, resource, blockId, start, bounds) => {
                if (key !== active.current) return;
                anchors.activate(selectedOccurrence, bounds, anchor => handlers.current.onInspect(resource, blockId, start, anchor));
            }}
            onMeasured={async (key, selectedOccurrence, request, bounds) => {
                if (key === active.current) anchors.measured(selectedOccurrence, request, bounds);
            }}
            onImageError={async (key, resourceId) => {
                if (key === active.current) updateImages(previous => previous.map(item => item.resourceId === resourceId
                    ? { ...item, uri: null, error: 'The source image could not be displayed.' } : item));
            }}
            onThumbnail={async (key, resourceId, uri) => {
                if (key === active.current) handlers.current.onThumbnail(resourceId, uri);
            }}
            onNavigate={async (key, direction) => { if (key === active.current) handlers.current.onNavigate(direction); }} />,
        [identity, window, batch, imageState, inspecting, theme.shell.canvas, theme.colors.text, theme.feedback.success,
            theme.colors.muted, theme.controls.selected, theme.typography.body._web.fontFamily, theme.textScale]);
    return <View ref={container} style={styles.viewport}
        testID={renderedIdentity === identity ? 'reader-document-ready' : 'reader-document-loading'}
        accessibilityState={{ busy: renderedIdentity !== identity }}
        onLayout={anchors.notify}>
        {content}
        {renderedIdentity !== identity ? <View pointerEvents="none" style={styles.loading}>
            <Text variant="caption" accessibilityLiveRegion="polite">Loading document…</Text>
        </View> : null}
        {images.some(image => image.error) ? <View style={styles.imageFeedback}>
            <Text accessibilityRole="alert" variant="caption">A source image is unavailable.</Text>
            <Button label="Retry source images" variant="secondary" size="compact" onPress={() => setImageReload(value => value + 1)} />
        </View> : null}
    </View>;
}
const styles = StyleSheet.create(theme => ({
    viewport: { flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', backgroundColor: theme.shell.canvas },
    loading: { position: 'absolute', top: theme.spacing.small, left: theme.spacing.small },
    imageFeedback: { position: 'absolute', bottom: 8, left: 8, right: 8, padding: theme.spacing.small,
        gap: theme.spacing.small, borderRadius: theme.radius, backgroundColor: theme.colors.surface },
}));
