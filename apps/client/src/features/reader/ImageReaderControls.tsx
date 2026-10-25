import { useEffect, useState, type ReactNode } from 'react';
import type { ImageReaderSettings, OcrRect } from '@mlearn/contracts';
import { isOcrRect } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import type { useImageReader } from './useImageReader';

export type ImageCropDraft = { readonly resourceId: string; readonly crop: OcrRect };

export function ImageLayoutControls({ reader, onBeforeAction }: {
    readonly reader: ReturnType<typeof useImageReader>;
    readonly onBeforeAction: () => void;
}) {
    const settings = reader.settings;
    if (!settings) return null;
    function change(value: Partial<ImageReaderSettings>) {
        onBeforeAction(); void reader.changeSettings(value);
    }
    return <Row wrap={false}>
        <Select label="Image fit" size="compact" value={settings.fit} disabled={reader.saving}
            options={[{ value: 'contain', label: 'Fit page' }, { value: 'height', label: 'Fit height' }, { value: 'width', label: 'Fit width' }]}
            onValueChange={value => { if (value === 'contain' || value === 'height' || value === 'width') change({ fit: value }); }} />
        <Select label="Page layout" size="compact" value={settings.paired ? 'paired' : 'single'} disabled={reader.saving}
            options={[{ value: 'single', label: 'Single page' }, { value: 'paired', label: 'Double page' }]}
            onValueChange={value => change({ paired: value === 'paired' })} />
    </Row>;
}

/** Source image controls share ordinary application semantics/materials.
 * Coordinates remain unsubmitted input until the explicit recognition action.
 */
export function ImageReaderControls({ reader, cropMode, cropDraft, magnifier, onCropMode, onMagnifier, onBeforeAction, onReturnToSource, layoutInline = false, children }: {
    readonly reader: ReturnType<typeof useImageReader>;
    readonly cropMode: boolean;
    readonly cropDraft: ImageCropDraft | null;
    readonly magnifier: boolean;
    readonly onCropMode: (enabled: boolean) => void;
    readonly onMagnifier: (enabled: boolean) => void;
    readonly onBeforeAction: () => void;
    readonly onReturnToSource: () => void;
    readonly layoutInline?: boolean;
    readonly children?: ReactNode;
}) {
    const [recognitionOpen, setRecognitionOpen] = useState(false);
    const [selectedResource, setSelectedResource] = useState('');
    const [region, setRegion] = useState(false);
    const [coordinates, setCoordinates] = useState({ x: '25', y: '25', width: '50', height: '50' });
    useEffect(() => {
        if (!cropDraft) return;
        setSelectedResource(cropDraft.resourceId); setRegion(true);
        setCoordinates({ x: String(cropDraft.crop.x * 100), y: String(cropDraft.crop.y * 100),
            width: String(cropDraft.crop.width * 100), height: String(cropDraft.crop.height * 100) });
        setRecognitionOpen(true);
    }, [cropDraft]);
    const settings = reader.settings;
    const provider = reader.providers.find(value => value.id === reader.providerId);
    const activeResource = reader.pages.some(page => page.descriptor.resourceId === selectedResource)
        ? selectedResource : reader.pages[0]?.descriptor.resourceId ?? '';
    const crop = { x: Number(coordinates.x) / 100, y: Number(coordinates.y) / 100,
        width: Number(coordinates.width) / 100, height: Number(coordinates.height) / 100 };
    function change(value: Partial<ImageReaderSettings>) {
        onBeforeAction(); void reader.changeSettings(value);
    }
    return <>
        {settings ? <Row>
            {!layoutInline ? <ImageLayoutControls reader={reader} onBeforeAction={onBeforeAction} /> : null}
            <Select label="Page reading direction" size="compact" value={settings.direction} disabled={reader.saving}
                options={[{ value: 'ltr', label: 'Left to right' }, { value: 'rtl', label: 'Right to left' }]}
                onValueChange={value => change({ direction: value === 'rtl' ? 'rtl' : 'ltr' })} />
            <Button label="First page single" variant="secondary" size="compact" disabled={reader.saving || !settings.paired}
                accessibilityState={{ selected: settings.firstPageSingle }}
                onPress={() => change({ firstPageSingle: !settings.firstPageSingle })} />
            <Button label="Collate spreads" variant="secondary" size="compact" disabled={reader.saving || !settings.paired}
                accessibilityState={{ selected: settings.collate }}
                onPress={() => change({ collate: !settings.collate })} />
            <Button label="Interactive text" variant="secondary" size="compact" disabled={reader.saving}
                accessibilityState={{ selected: settings.showOverlay }}
                onPress={() => change({ showOverlay: !settings.showOverlay })} />
            {reader.pages.some(item => item.page?.regions.some(region => region.readingOf)) ? <Button
                label="Hide publisher readings" variant="secondary" size="compact" disabled={reader.saving || !settings.showOverlay}
                accessibilityState={{ selected: !settings.showAnnotations }}
                onPress={() => change({ showAnnotations: !settings.showAnnotations })} /> : null}
            <Button label={cropMode ? 'Cancel crop selection' : 'Select crop'} variant="secondary" size="compact"
                disabled={reader.pending || !reader.pages.length}
                accessibilityState={{ selected: cropMode }}
                onPress={() => { onBeforeAction(); onCropMode(!cropMode); onReturnToSource(); }} />
            <Button label="Image magnifier" variant="secondary" size="compact" disabled={reader.pending || !reader.pages.length}
                accessibilityState={{ selected: magnifier }}
                onPress={() => { onBeforeAction(); onMagnifier(!magnifier); onReturnToSource(); }} />
            {children}
            <Dialog title="Recognize source image" description="Results and crop geometry are saved with the original source."
                open={recognitionOpen} onOpenChange={open => {
                onBeforeAction(); setRecognitionOpen(open);
            }} trigger={<Button label="Recognize" variant="secondary" size="compact" disabled={reader.pending || !reader.pages.length} />}>
                {reader.pages.length > 1 ? <Select label="Recognition page" value={activeResource}
                    options={reader.pages.map(page => ({ value: page.descriptor.resourceId, label: `Page ${page.descriptor.pageIndex + 1}` }))}
                    onValueChange={setSelectedResource} /> : null}
                <Select label="Recognition provider" value={reader.providerId} placeholder="Choose a provider"
                    options={reader.providers.map(value => ({ value: value.id, label: value.label }))}
                    onValueChange={reader.setProviderId} />
                {!reader.providers.length ? <Text accessibilityRole="alert">No native recognition providers are available.</Text> : null}
                {provider ? <>
                    <Text variant="caption" muted>{provider.languageProvenance}</Text>
                    {provider.scripts.length ? <Text variant="caption">Scripts: {provider.scripts.join(', ')}</Text> : null}
                    {provider.reason ? <Text accessibilityRole="alert">{provider.reason}</Text> : null}
                    {provider.languages.length ? <Select label="Recognition language" value={reader.language}
                        options={[{ value: '', label: 'Provider automatic' }, ...provider.languages.map(value => ({ value, label: value }))]}
                        onValueChange={reader.setLanguage} /> : null}
                </> : null}
                <Row>
                    <Button label="Whole page" variant="secondary" accessibilityState={{ selected: !region }} onPress={() => setRegion(false)} />
                    <Button label="Selected region" variant="secondary" accessibilityState={{ selected: region }} onPress={() => setRegion(true)} />
                </Row>
                {region ? <>
                    <Text variant="caption" muted>Percent of the original upright image. Recognition preserves other regions.</Text>
                    {([['x', 'Left (%)'], ['y', 'Top (%)'], ['width', 'Width (%)'], ['height', 'Height (%)']] as const)
                        .map(([key, label]) => <TextField key={key} label={label} keyboardType="decimal-pad"
                            value={coordinates[key]} onChangeText={value => setCoordinates(previous => ({ ...previous, [key]: value }))} />)}
                    {!isOcrRect(crop) ? <Text accessibilityRole="alert">Enter a positive crop contained within 0–100% of the image.</Text> : null}
                </> : null}
                <Button label={region ? 'Recognize selected region' : 'Recognize page'} disabled={!activeResource
                    || provider?.availability !== 'ready' || reader.recognizing || region && !isOcrRect(crop)}
                    onPress={() => {
                        setRecognitionOpen(false); onCropMode(false);
                        void reader.recognize(activeResource, region ? crop : null);
                        onReturnToSource();
                    }} />
            </Dialog>
        </Row> : null}
    </>;
}

export function ImageReaderFeedback({ reader, cropMode, magnifier }: {
    readonly reader: ReturnType<typeof useImageReader>;
    readonly cropMode: boolean;
    readonly magnifier: boolean;
}) {
    return <>
        {reader.pending ? <Text variant="caption" accessibilityLiveRegion="polite">Opening source pages…</Text> : null}
        {reader.recognizing ? <Text variant="caption" accessibilityLiveRegion="polite">Recognizing on device…</Text> : null}
        {cropMode ? <Text variant="caption">Drag over the original image, or enter an accessible region in Recognize.</Text> : null}
        {magnifier ? <Text variant="caption">Touch or move over an image. Wheel changes zoom. Hold Z for a temporary lens.</Text> : null}
        {reader.error ? <Row><Text variant="caption" accessibilityRole="alert">{reader.error}</Text>
            <Button label="Retry image action" variant="secondary" size="compact" disabled={reader.pending || reader.recognizing}
                onPress={reader.retry} /></Row> : null}
        {reader.pages.map(item => item.error ? <Row key={item.descriptor.resourceId}>
            <Text variant="caption" accessibilityRole="alert">Page {item.descriptor.pageIndex + 1}: {item.error}</Text>
            <Button label={`Retry page ${item.descriptor.pageIndex + 1} analysis`} variant="secondary" size="compact"
                onPress={() => reader.retryPage(item)} /></Row> : null)}
    </>;
}
