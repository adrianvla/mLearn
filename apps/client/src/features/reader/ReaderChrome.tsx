import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { DocumentAppearance, DocumentPosition, DocumentRecord, DocumentSearchHit, DocumentWritingMode } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import type { InspectionMode } from '@mlearn/ui/inline-word';
import { Row, SettingRow } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { ImageLayoutControls } from './ImageReaderControls';
import { ReaderSearch } from './ReaderSearch';
import { notices } from './readerNotice';
import type { useImageReader } from './useImageReader';
import type { useReader } from './useReader';

export type ReaderPanel = 'vocabulary' | 'appearance' | 'options' | 'recognition';
type Strip = { readonly message: string; readonly action: 'retry' | 'install' | null; readonly onAction: () => void };

const triggers: readonly { value: InspectionMode; label: string }[] = [
    { value: 'click', label: 'Click' }, { value: 'immediate', label: 'Hover' },
    { value: 'delayed', label: 'Delayed hover' }, { value: 'modifier', label: 'Shift + Hover' },
];
const onOff = (value: boolean) => value ? 'On' : 'Off';

export function ReaderToolbar({ title, position, imageMode, wide, leadingInset, railOpen, panelOpen, appearanceOpen, optionsOpen,
    disabled, homeDisabled, writingMode, imageReader, previousDisabled, nextDisabled, onRail, onHome, onWritingMode,
    onAppearance, onOptions, onPanel, onBeforeLayout, onPrevious, onNext }: {
    readonly title: string;
    readonly position: string | null;
    readonly imageMode: boolean;
    readonly wide: boolean;
    readonly leadingInset: number;
    readonly railOpen: boolean;
    readonly panelOpen: boolean;
    readonly appearanceOpen: boolean;
    readonly optionsOpen: boolean;
    readonly disabled: boolean;
    readonly homeDisabled: boolean;
    readonly writingMode: DocumentWritingMode;
    readonly imageReader: ReturnType<typeof useImageReader> | null;
    readonly previousDisabled: boolean;
    readonly nextDisabled: boolean;
    readonly onRail: () => void;
    readonly onHome: () => void;
    readonly onWritingMode: (value: DocumentWritingMode) => void;
    readonly onAppearance: () => void;
    readonly onOptions: () => void;
    readonly onPanel: () => void;
    readonly onBeforeLayout: () => void;
    readonly onPrevious: () => void;
    readonly onNext: () => void;
}) {
    const unit = imageMode ? 'page' : 'passage';
    const navigation = <>
        <View style={styles.segmented} accessibilityRole="toolbar" accessibilityLabel={`Previous or next ${unit}`}>
            <Button label={`Previous ${unit}`} icon="chevronLeft" iconOnly variant="secondary" size="compact"
                disabled={previousDisabled} onPress={onPrevious} />
            <Button label={`Next ${unit}`} icon="chevronRight" iconOnly variant="secondary" size="compact"
                disabled={nextDisabled} onPress={onNext} />
        </View>
        <Button label={panelOpen ? 'Hide vocabulary' : 'Show vocabulary'} icon="sidebarRight" iconOnly size="compact"
            variant="secondary" accessibilityState={{ expanded: panelOpen }} onPress={onPanel} />
    </>;
    const writing = !imageMode ? <Select label="Writing direction" size="compact" value={writingMode} disabled={disabled}
        options={[{ value: 'auto', label: 'Automatic' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]}
        onValueChange={value => {
            if (value === 'auto' || value === 'horizontal' || value === 'vertical') onWritingMode(value);
        }} /> : null;
    const appearance = !imageMode ? <Button label="Themes & Settings" variant="secondary" size="compact" disabled={disabled}
        accessibilityState={{ expanded: appearanceOpen }} onPress={onAppearance} /> : null;
    const options = !imageMode ? <Button label="View options" variant="secondary" size="compact" disabled={disabled}
        accessibilityState={{ expanded: optionsOpen }} onPress={onOptions} /> : null;
    const layout = imageMode || wide ? <ImageLayoutControls reader={imageReader} onBeforeAction={onBeforeLayout} /> : null;
    return <View testID="reader-toolbar" style={[styles.toolbar, !wide && styles.narrowToolbar]}>
        <View style={[styles.leading, { paddingLeft: leadingInset }]}>
            {wide ? <Button label={railOpen ? 'Hide page rail' : 'Show page rail'} icon="sidebarLeft" iconOnly size="compact"
                variant="secondary" accessibilityState={{ expanded: railOpen }} onPress={onRail} /> : null}
            <Button label="Home" icon="arrowLeft" size="compact" variant="secondary" disabled={homeDisabled} onPress={onHome} />
            <View style={styles.title}><Text variant="navigation" muted numberOfLines={1} accessibilityRole="header"
                testID="reader-title">{title}</Text></View>
            {position ? <Text variant="detail" muted testID="reader-toolbar-position">{position}</Text> : null}
            {!wide ? navigation : null}
        </View>
        <Actions wide={wide}>
            {wide ? <>{writing}{appearance}{layout}{options}{navigation}</> : <>{appearance}{options}{writing}{layout}</>}
        </Actions>
    </View>;
}

/** Narrow windows move navigation into the first row; the remaining controls scroll. */
function Actions({ wide, children }: { readonly wide: boolean; readonly children: ReactNode }) {
    return <ScrollView horizontal style={[styles.actionsViewport, !wide && styles.narrowActions]} contentContainerStyle={styles.actions}
        keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>{children}</ScrollView>;
}

export function ReaderStatusStrip({ position, imageMode, status, debugRef, inspectionMode, onInspectionMode, annotations, onAnnotations,
    readingFilter, onReadingFilter, crop, onCrop, debug, onDebug, magnifier, onMagnifier, controlsDisabled, notice }: {
    readonly position: string | null;
    readonly imageMode: boolean;
    readonly status: string;
    readonly debugRef: RefObject<View | null>;
    readonly inspectionMode: InspectionMode;
    readonly onInspectionMode: (value: InspectionMode) => void;
    readonly annotations: boolean;
    readonly onAnnotations: () => void;
    readonly readingFilter: boolean;
    readonly onReadingFilter: () => void;
    readonly crop: boolean;
    readonly onCrop: () => void;
    readonly debug: boolean;
    readonly onDebug: () => void;
    readonly magnifier: boolean;
    readonly onMagnifier: () => void;
    readonly controlsDisabled: boolean;
    readonly notice: Strip | null;
}) {
    return <View testID="reader-status" style={styles.status}>
        <ScrollView horizontal style={styles.statusViewport} contentContainerStyle={styles.statusItems}
            keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
            {position ? <View style={styles.position}><Text variant="detail" muted numberOfLines={1} testID="reader-position">{position}</Text></View> : null}
            <View style={styles.trigger}>
                <Text variant="detail" muted>Show Tooltip On:</Text>
                <Select label="Show tooltip on" size="compact" value={inspectionMode} options={triggers}
                    onValueChange={value => {
                        const selected = triggers.find(item => item.value === value);
                        if (selected) onInspectionMode(selected.value);
                    }} />
            </View>
            {imageMode ? <Button label={`Crop: ${onOff(crop)}`} variant="quiet" size="compact" disabled={controlsDisabled}
                accessibilityState={{ selected: crop }} onPress={onCrop} /> : null}
            <Button label={`Reading annotations: ${onOff(annotations)}`} variant="quiet" size="compact" disabled={controlsDisabled}
                accessibilityState={{ selected: annotations }} onPress={onAnnotations} />
            {imageMode ? <>
                <Button label={`OCR reading filter: ${onOff(readingFilter)}`} variant="quiet" size="compact"
                    disabled={controlsDisabled || !annotations} accessibilityState={{ selected: readingFilter }}
                    onPress={onReadingFilter} />
                <Button ref={debugRef} label={`Debug: ${onOff(debug)}`} variant="quiet" size="compact" disabled={controlsDisabled}
                    accessibilityState={{ selected: debug }} onPress={onDebug} />
                <Button label={magnifier ? 'Press Z to close magnifier' : 'Press Z to open magnifier'} variant="quiet" size="compact"
                    disabled={controlsDisabled} accessibilityState={{ selected: magnifier }} onPress={onMagnifier} />
            </> : null}
        </ScrollView>
        {notice ? <View style={styles.notice}>
            <Text variant="detail" accessibilityRole="alert">{notice.message}</Text>
            {notice.action ? <Button label={notice.action === 'install' ? 'Install' : 'Retry'} variant="secondary" size="compact"
                onPress={notice.onAction} /> : null}
        </View> : <View style={styles.state}><Text variant="detail" muted numberOfLines={1} accessibilityLiveRegion="polite"
            testID="reader-status-text">{status}</Text></View>}
    </View>;
}

function PanelHeading({ title, onClose }: { readonly title: string; readonly onClose: () => void }) {
    return <View style={styles.heading}>
        <View style={styles.headingTitle}><Text variant="groupTitle" accessibilityRole="header">{title}</Text></View>
        <Button label={`Close ${title}`} icon="close" iconOnly variant="quiet" size="compact" onPress={onClose} />
    </View>;
}

function Stepper({ label, value, display, disabled, decrease, increase, onChange }: {
    readonly label: string;
    readonly value: number;
    readonly display: string;
    readonly disabled: boolean;
    readonly decrease: { readonly label: string; readonly next: number; readonly allowed: boolean };
    readonly increase: { readonly label: string; readonly next: number; readonly allowed: boolean };
    readonly onChange: (value: number) => void;
}) {
    return <SettingRow label={label}><Row wrap={false}>
        <Button label={decrease.label} icon="minus" iconOnly variant="secondary" size="compact"
            disabled={disabled || !decrease.allowed} onPress={() => onChange(decrease.next)} />
        <Text variant="caption" accessibilityLabel={`${label} ${value}`}>{display}</Text>
        <Button label={increase.label} icon="plus" iconOnly variant="secondary" size="compact"
            disabled={disabled || !increase.allowed} onPress={() => onChange(increase.next)} />
    </Row></SettingRow>;
}

export function ReaderAppearancePanel({ appearance, disabled, onChange, onClose, onAppAppearance }: {
    readonly appearance: DocumentAppearance;
    readonly disabled: boolean;
    readonly onChange: (change: Partial<DocumentAppearance>) => void;
    readonly onClose: () => void;
    readonly onAppAppearance: () => void;
}) {
    const tenth = (value: number) => Math.round(value * 10) / 10;
    return <View style={styles.panel} testID="reader-appearance-panel">
        <PanelHeading title="Themes & Settings" onClose={onClose} />
        <SettingRow label="Font"><Select label="Reader font" size="compact" value={appearance.font} disabled={disabled}
            options={[{ value: 'source', label: 'Source default' }, { value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans serif' }]}
            onValueChange={font => { if (font === 'source' || font === 'serif' || font === 'sans') onChange({ font }); }} /></SettingRow>
        <Stepper label="Text size" value={appearance.fontSize} display={String(appearance.fontSize)} disabled={disabled}
            decrease={{ label: 'Smaller text', next: Math.max(12, appearance.fontSize - 2), allowed: appearance.fontSize > 12 }}
            increase={{ label: 'Larger text', next: Math.min(48, appearance.fontSize + 2), allowed: appearance.fontSize < 48 }}
            onChange={value => onChange({ fontSize: value })} />
        <Stepper label="Line height" value={appearance.lineHeight} display={appearance.lineHeight.toFixed(1)} disabled={disabled}
            decrease={{ label: 'Tighter lines', next: Math.max(1, tenth(appearance.lineHeight - 0.1)), allowed: appearance.lineHeight > 1 }}
            increase={{ label: 'Looser lines', next: Math.min(2.5, tenth(appearance.lineHeight + 0.1)), allowed: appearance.lineHeight < 2.5 }}
            onChange={value => onChange({ lineHeight: value })} />
        <Stepper label="Letter spacing" value={appearance.letterSpacing} display={appearance.letterSpacing.toFixed(1)} disabled={disabled}
            decrease={{ label: 'Tighter letters', next: Math.max(-1, appearance.letterSpacing - 0.5), allowed: appearance.letterSpacing > -1 }}
            increase={{ label: 'Looser letters', next: Math.min(4, appearance.letterSpacing + 0.5), allowed: appearance.letterSpacing < 4 }}
            onChange={value => onChange({ letterSpacing: value })} />
        <Button label="App themes" variant="quiet" size="compact" onPress={onAppAppearance} />
    </View>;
}

/** Less frequent source actions: search, contents, source language and the
 * PDF text/page view. Image sources reach the same block from Debug.
 */
export function ReaderOptionsPanel({ client, source, reader, imageMode, focused, onClose, onInspect, onTogglePdf, onLocate, onReturn, onOpenDocument }: {
    readonly client: RuntimeClient;
    readonly source: DocumentRecord;
    readonly reader: ReturnType<typeof useReader>;
    readonly imageMode: boolean;
    readonly focused: boolean;
    readonly onClose: (() => void) | null;
    readonly onInspect: () => void;
    readonly onTogglePdf: () => void;
    readonly onLocate: (hit: DocumentSearchHit) => Promise<boolean>;
    readonly onReturn: (position: DocumentPosition) => Promise<boolean>;
    readonly onOpenDocument: () => void;
}) {
    const [after, setAfter] = useState<number | null>(null);
    useEffect(() => { if (!imageMode) void reader.loadContents(null); }, [imageMode, source.id, source.parserRevision]);
    const outdated = reader.languages.some(plugin => plugin.id === source.packageId && plugin.version !== source.packageVersion);
    return <View style={styles.panel} testID="reader-options-panel">
        {onClose ? <PanelHeading title="View options" onClose={onClose} /> : null}
        <Row>
            {focused ? <ReaderSearch key={JSON.stringify([source.id, source.contentRevision, source.parserRevision,
                source.packageId, source.packageVersion, imageMode])} client={client} source={source}
                scope={imageMode ? 'recognized_pages' : 'text'} position={reader.position} disabled={reader.pending}
                onOpen={onInspect} onLocate={onLocate} onReturn={onReturn} /> : null}
            {source.format === 'pdf' ? <Button label={imageMode ? 'Read PDF text' : 'View PDF pages'} variant="secondary" size="compact"
                disabled={reader.pending} onPress={onTogglePdf} /> : null}
            <Button label="Save position" variant="secondary" size="compact" disabled={reader.pending}
                onPress={() => void reader.persist().catch(() => undefined)} />
            {<Button label="Open another document" variant="secondary" size="compact" disabled={reader.pending}
                onPress={onOpenDocument} />}
        </Row>
        <SettingRow label="Source language"><Select testID="reader-language-select" label="Source language" size="compact"
            value={source.packageId} disabled={reader.pending}
            options={reader.languages.map(plugin => ({ value: plugin.id, label: plugin.displayName ?? 'Unnamed language',
                testID: `reader-language-${plugin.id}` }))}
            onValueChange={packageId => { if (packageId !== source.packageId) void reader.setLanguage(packageId); }} /></SettingRow>
        {outdated ? <Button label="Use updated language" variant="secondary" size="compact" disabled={reader.pending}
            onPress={() => void reader.setLanguage(source.packageId)} /> : null}
        {!imageMode ? <View style={styles.group}>
            <Text variant="groupTitle">Contents</Text>
            {reader.contentsPending ? <Text variant="caption" accessibilityLiveRegion="polite">Loading contents…</Text> : null}
            {reader.contentsError ? <Row><Text variant="caption" accessibilityRole="alert">{notices.contentsFailed.message}</Text>
                <Button label="Retry" accessibilityLabel="Retry contents" variant="secondary" size="compact" disabled={reader.contentsPending}
                    onPress={() => void reader.loadContents(after)} /></Row> : null}
            {reader.contents?.items.map(item => <Button key={JSON.stringify(item.position)} label={item.label} variant="quiet" size="compact"
                disabled={reader.pending} accessibilityState={{ selected: reader.position?.resource === item.position.resource
                    && reader.position.blockId === item.position.blockId }}
                onPress={() => void reader.navigate(item.position)} />)}
            {reader.contents && !reader.contents.items.length ? <Text variant="caption" muted>No contents in this document.</Text> : null}
            {after !== null || reader.contents?.nextOffset != null ? <Row>
                <Button label="First contents" variant="quiet" size="compact" disabled={reader.contentsPending || after === null}
                    onPress={() => { setAfter(null); void reader.loadContents(); }} />
                <Button label="More contents" variant="quiet" size="compact" disabled={reader.contentsPending || reader.contents?.nextOffset == null}
                    onPress={() => {
                        const next = reader.contents?.nextOffset;
                        if (next != null) { setAfter(next); void reader.loadContents(next); }
                    }} />
            </Row> : null}
        </View> : null}
        {source.fidelity.length ? <View style={styles.group}>
            <Text variant="groupTitle">Source notes</Text>
            <Text variant="detail" muted selectable testID="reader-fidelity">{source.fidelity.join('\n\n')}</Text>
        </View> : null}
    </View>;
}

const styles = StyleSheet.create(theme => ({
    toolbar: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small,
        paddingHorizontal: theme.spacing.small, paddingVertical: theme.spacing.small,
        borderBottomWidth: 1, borderColor: theme.colors.border, _web: { userSelect: 'none' } },
    narrowToolbar: { flexWrap: 'wrap', rowGap: theme.spacing.tiny },
    narrowActions: { flexBasis: '100%' },
    leading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small, flexShrink: 1, flexGrow: 1, minWidth: 0 },
    title: { flexShrink: 1, minWidth: 0 },
    actionsViewport: { flexGrow: 0, flexShrink: 1 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small },
    segmented: { flexDirection: 'row', gap: 1 },
    status: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.compact,
        paddingHorizontal: theme.spacing.medium, minHeight: 36,
        borderTopWidth: 1, borderColor: theme.colors.border, _web: { userSelect: 'none' } },
    statusViewport: { flexGrow: 1, flexShrink: 1 },
    statusItems: { alignItems: 'center', gap: theme.spacing.compact },
    trigger: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.tiny },
    state: { flexShrink: 0 },
    position: { maxWidth: 320 },
    notice: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small, flexShrink: 0 },
    panel: { gap: theme.spacing.compact },
    heading: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.small },
    headingTitle: { flex: 1, minWidth: 0 },
    group: { gap: theme.spacing.small },
}));
