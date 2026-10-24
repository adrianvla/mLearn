import { useEffect, useMemo, useRef, useState } from 'react';
import type { OcrCorrection, OcrEvidence, OcrQuad, OcrRegion } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import type { useImageReader } from './useImageReader';

const corners: readonly (keyof OcrQuad)[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const coordinateLabels = ['Top left X', 'Top left Y', 'Top right X', 'Top right Y',
    'Bottom right X', 'Bottom right Y', 'Bottom left X', 'Bottom left Y'];

/** Edits are drafts until the native revision-checked correction commits.
 * Reading evidence and loading the current version are explicit, separate acts.
 */
export function ImageRecognition({ client, reader, onBeforeOpen }: {
    readonly client: RuntimeClient;
    readonly reader: ReturnType<typeof useImageReader>;
    readonly onBeforeOpen: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [selectedKey, setSelectedKey] = useState('');
    const regions = reader.pages.flatMap(item => item.page ? item.page.regions.map(region => ({
        key: JSON.stringify([item.descriptor.resourceId, region.id]), page: item.page!, region,
        pageIndex: item.descriptor.pageIndex,
    })) : []);
    const selected = regions.find(region => region.key === selectedKey) ?? regions[0];
    const identity = selected ? JSON.stringify([selected.page.sourceId, selected.page.resourceId,
        selected.page.ocrRevision, selected.region.id]) : '';
    const current = useRef(identity); current.current = identity;
    const command = useRef<OcrCorrection | null>(null);
    const lock = useRef(false);
    const [text, setText] = useState('');
    const [coordinates, setCoordinates] = useState<string[]>(Array(8).fill(''));
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [evidence, setEvidence] = useState<OcrEvidence | null>(null);
    const [evidencePending, setEvidencePending] = useState(false);
    const evidenceText = useMemo(() => evidence ? JSON.stringify(evidence, null, 2) : '', [evidence]);
    function loadDraft(region: OcrRegion | undefined) {
        setText(region?.text ?? '');
        setCoordinates(region ? corners.flatMap(corner => [
            String(region.quad[corner].x * 100), String(region.quad[corner].y * 100),
        ]) : Array(8).fill(''));
    }
    useEffect(() => {
        command.current = null; lock.current = false;
        setPending(false); setError(''); setNotice(''); setEvidence(null); setEvidencePending(false);
        loadDraft(selected?.region);
    }, [identity]);
    useEffect(() => () => { current.current = ''; }, []);
    const point = (index: number) => ({ x: Number(coordinates[index]) / 100, y: Number(coordinates[index + 1]) / 100 });
    const quad = { topLeft: point(0), topRight: point(2), bottomRight: point(4), bottomLeft: point(6) };
    const finite = coordinates.every(value => value.trim() !== '' && Number.isFinite(Number(value)));
    function edited() { command.current = null; setError(''); setNotice(''); }
    async function save() {
        if (!selected || lock.current || !finite) return;
        lock.current = true; setPending(true); setError(''); setNotice('');
        const active = () => current.current === identity;
        try {
            command.current ??= client.prepareOcrCorrection(selected.page, { ...selected.region, text, quad });
            const result = await client.correctOcr(command.current);
            if (!active()) return;
            command.current = null;
            // Preserve the explicit native correction. Automatic package
            // postprocessing must not rewrite an authored alignment/text edit.
            await reader.receive(result, true);
        } catch (cause) {
            if (active()) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (active()) { lock.current = false; setPending(false); }
        }
    }
    async function loadCurrent() {
        if (!selected || lock.current) return;
        lock.current = true; setPending(true); setError('');
        try {
            const result = await client.readOcr(selected.page.sourceId, selected.page.resourceId);
            if (current.current !== identity) return;
            if (!result) throw new Error('No saved recognition is available for this source.');
            command.current = null;
            await reader.receive(result, true);
            const nextIdentity = JSON.stringify([result.sourceId, result.resourceId, result.ocrRevision, selected.region.id]);
            if (current.current === identity || current.current === nextIdentity) {
                loadDraft(result.regions.find(region => region.id === selected.region.id));
                setNotice(`Loaded saved recognition revision ${result.ocrRevision}.`);
            }
        } catch (cause) {
            if (current.current === identity) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (current.current === identity) { lock.current = false; setPending(false); }
        }
    }
    async function inspectEvidence(revision: number) {
        if (!selected || evidencePending) return;
        setEvidencePending(true); setError('');
        try {
            const value = await client.ocrEvidence(selected.page.sourceId, selected.page.resourceId, revision);
            if (current.current === identity) setEvidence(value);
        } catch (cause) {
            if (current.current === identity) setError(cause instanceof Error ? cause.message : String(cause));
        } finally { if (current.current === identity) setEvidencePending(false); }
    }
    return <Dialog title="Recognition and alignment" description="Save source corrections or inspect their original recognition evidence."
        open={open} onOpenChange={value => { if (value) onBeforeOpen(); setOpen(value); }}
        trigger={<Button label="Recognition details" variant="secondary" size="compact" disabled={!regions.length} />}>
        <Select label="Recognized region" value={selected?.key ?? ''} disabled={pending}
            options={regions.map(value => ({ value: value.key,
                label: `Page ${value.pageIndex + 1}: ${Array.from(value.region.text).slice(0, 48).join('')}` }))}
            onValueChange={setSelectedKey} />
        {selected ? <>
            <Text variant="caption" muted>
                {selected.page.provider.label} · recognition revision {selected.page.ocrRevision} · {selected.region.id}
            </Text>
            <TextField label="Recognized text" multiline value={text} maxLength={32768} editable={!pending && !reader.recognizing}
                onChangeText={value => { edited(); setText(value); }} />
            {selected.region.candidates.length ? <Select label="Native recognition candidate" value="" disabled={pending}
                placeholder="Use a native candidate"
                options={selected.region.candidates.map((candidate, index) => ({ value: String(index),
                    label: `${candidate.text}${candidate.confidence === null ? '' : ` · confidence ${candidate.confidence}`}` }))}
                onValueChange={value => {
                    const candidate = selected.region.candidates[Number(value)];
                    if (candidate) { edited(); setText(candidate.text); }
                }} /> : null}
            <Text variant="caption">Corner coordinates are percentages of the original image.</Text>
            {corners.map((corner, index) => <Row key={corner}>
                {[index * 2, index * 2 + 1].map(position => <TextField key={position} label={coordinateLabels[position]}
                    value={coordinates[position]} keyboardType="numeric" editable={!pending && !reader.recognizing} onChangeText={value => {
                        edited(); setCoordinates(previous => previous.map((coordinate, index) => index === position ? value : coordinate));
                    }} />)}
            </Row>)}
            <Row>
                <Button label={command.current ? 'Retry same correction' : 'Save correction'} busy={pending}
                    disabled={!finite || reader.recognizing} onPress={() => void save()} />
                <Button label="Load current saved recognition" variant="secondary" disabled={pending}
                    onPress={() => void loadCurrent()} />
                <Button label="Re-recognize saved region" variant="secondary" disabled={pending || reader.recognizing || !reader.providerId}
                    onPress={() => {
                        const values = corners.map(corner => selected.region.quad[corner]);
                        const x = Math.max(0, Math.min(...values.map(point => point.x)));
                        const y = Math.max(0, Math.min(...values.map(point => point.y)));
                        const right = Math.min(1, Math.max(...values.map(point => point.x)));
                        const bottom = Math.min(1, Math.max(...values.map(point => point.y)));
                        if (right > x && bottom > y) void reader.recognize(selected.page.resourceId,
                            { x, y, width: right - x, height: bottom - y });
                        else setError('This saved region is outside the image. Save a usable alignment before re-recognizing it.');
                    }} />
            </Row>
            {!reader.providerId ? <Text variant="caption" muted>Choose a provider in Recognize to re-recognize this region.</Text> : null}
            {reader.recognizing ? <Text accessibilityLiveRegion="polite">Recognizing source region…</Text> : null}
            <Text variant="caption" muted>Saved corrections refresh current targets. Existing captures retain their original recognition revision.
                Re-recognition replaces overlapping saved regions; it does not save these draft edits.</Text>
            {reader.error ? <Text accessibilityRole="alert">{reader.error}</Text> : null}
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
            <Row>
                <Button label="Inspect saved evidence" variant="secondary" busy={evidencePending}
                    onPress={() => void inspectEvidence(selected.page.ocrRevision)} />
                {evidence?.parentRevision ? <Button label={`Inspect parent revision ${evidence.parentRevision}`} variant="secondary"
                    disabled={evidencePending} onPress={() => { if (evidence.parentRevision) void inspectEvidence(evidence.parentRevision); }} /> : null}
            </Row>
            {evidence ? <Text testID="ocr-evidence" variant="detail" selectable>{evidenceText}</Text> : null}
        </> : null}
    </Dialog>;
}
