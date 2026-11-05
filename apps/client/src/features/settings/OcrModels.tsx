import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { PackageInstallStatus } from '@mlearn/contracts';
import type { useRuntime } from '../../bootstrap/RuntimeProvider';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Text } from '@mlearn/ui/text';
import { Progress } from '@mlearn/ui/progress';
import { Row, Stack, SettingRow } from '@mlearn/ui/layout';

type Models = NonNullable<Extract<ReturnType<typeof useRuntime>, { available: true }>['ocrModels']>;
export function OcrModels({ models }: { readonly models: Models }) {
    const [focused, setFocused] = useState(false);
    useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
    const [foreground, setForeground] = useState(AppState.currentState === 'active');
    const [inventory, setInventory] = useState<Awaited<ReturnType<Models['list']>> | null>(null);
    const [status, setStatus] = useState<PackageInstallStatus | null>(null);
    const [pending, setPending] = useState<{ id: string; kind: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [removing, setRemoving] = useState<string | null>(null);
    const [cancelling, setCancelling] = useState(false);
    const [result, setResult] = useState<{ id: string; value: Awaited<ReturnType<Models['test']>> } | null>(null);
    const alive = useRef(true), running = useRef(false), cancelLock = useRef(false);
    const enabled = focused && foreground;
    const active = status?.phase === 'downloading' || status?.phase === 'validating';
    useEffect(() => {
        if (!active) { cancelLock.current = false; setCancelling(false); }
    }, [active]);
    useEffect(() => {
        alive.current = true;
        const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
        return () => { alive.current = false; subscription.remove(); };
    }, []);
    useEffect(() => {
        if (!enabled) return;
        let current = true;
        setLoading(true);
        void models.list().then(value => {
            if (current) { setInventory(value); setStatus(value.installation); }
        }).catch((cause: unknown) => {
            if (current) setError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [models, enabled, reload]);
    useEffect(() => {
        if (!enabled) return;
        let current = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        async function read() {
            try {
                const value = await models.status();
                if (!current) return;
                setStatus(value);
                if (pending?.kind === 'install' || value?.phase === 'downloading' || value?.phase === 'validating')
                    timer = setTimeout(() => void read(), 500);
            } catch (cause) {
                if (current) setError(cause instanceof Error ? cause.message : String(cause));
            }
        }
        void read();
        return () => { current = false; clearTimeout(timer); };
    }, [models, enabled, pending?.kind, reload]);
    async function run(id: string, kind: string, action: () => Promise<void>) {
        if (running.current) return;
        running.current = true; setPending({ id, kind }); setError(''); setResult(null);
        try { await action(); }
        catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
        finally {
            running.current = false;
            if (alive.current) { setPending(null); setReload(value => value + 1); }
        }
    }
    async function cancel() {
        if (cancelLock.current) return;
        cancelLock.current = true; setCancelling(true);
        try { const value = await models.cancel(); if (alive.current) setStatus(value); }
        catch (cause) {
            cancelLock.current = false;
            if (alive.current) { setCancelling(false); setError(cause instanceof Error ? cause.message : String(cause)); }
        }
    }
    return <Stack>
        <Row><Button label="Refresh OCR models" variant="secondary" disabled={loading}
            onPress={() => { setError(''); setReload(value => value + 1); }} /></Row>
        {loading ? <Text variant="caption" accessibilityLiveRegion="polite">Reading native model inventory…</Text> : null}
        {inventory?.catalogReason ? <Text variant="caption" accessibilityRole="alert" selectable>{inventory.catalogReason}</Text> : null}
        {error ? <Text accessibilityRole="alert" selectable>{error}</Text> : null}
        {inventory && !inventory.items.length ? <Text>No native OCR model profiles are available.</Text> : null}
        {inventory?.items.map(model => <SettingRow key={model.id} label={model.label} description={<>
            <Text variant="detail" muted selectable>{model.target} · {model.bytes} declared download bytes</Text>
            <Text variant="caption" tone={model.installed ? 'success' : 'content'}>
                {model.installed ? 'Installed' : 'Not installed'}
                {model.installed && model.installedRevision !== model.revision ? ' · update available' : ''}
            </Text>
            {model.reason ? <Text variant="caption" selectable>{model.reason}</Text> : null}
            {result?.id === model.id ? <>
                <Text variant="caption" accessibilityLiveRegion="polite">
                    {result.value.detectedRegions} detected regions · {result.value.elapsedMs} ms engine work
                </Text>
                <Text selectable>{result.value.rawRecognition}</Text>
            </> : null}
        </>}>
            <Row>
                {!model.installed || model.installedRevision !== model.revision ? <Button
                    label={model.installed ? 'Update model' : 'Install model'}
                    accessibilityLabel={`${model.installed ? 'Update' : 'Install'} ${model.label}`} variant="secondary"
                    busy={pending?.id === model.id && pending.kind === 'install'} disabled={pending !== null || active}
                    onPress={() => void run(model.id, 'install', () => models.install(model.id))} /> : null}
                {model.installed ? <>
                    <Button label="Test model" accessibilityLabel={`Test ${model.label}`} variant="secondary"
                        busy={pending?.id === model.id && pending.kind === 'test'} disabled={pending !== null || active}
                        onPress={() => void run(model.id, 'test', async () => {
                            const value = await models.test(model.id);
                            if (alive.current) setResult({ id: model.id, value });
                        })} />
                    <Dialog title="Remove OCR model" description={`Remove ${model.label}'s installed inference resources. Saved sources and recognition are retained.`}
                        open={removing === model.id} onOpenChange={open => setRemoving(open ? model.id : null)}
                        trigger={<Button label="Remove model" accessibilityLabel={`Remove ${model.label}`} variant="quiet" disabled={pending !== null || active} />}>
                        <Button label="Remove model resources" onPress={() => {
                            setRemoving(null); void run(model.id, 'remove', () => models.remove(model.id));
                        }} />
                    </Dialog>
                </> : null}
            </Row>
        </SettingRow>)}
        {status ? <SettingRow label={inventory?.items.find(model => model.id === status.command.pluginId)?.label ?? status.command.pluginId}
            description={<>
                <Text variant="caption" accessibilityLiveRegion="polite">{status.phase}</Text>
                <Text variant="caption" muted>{status.downloadedBytes} bytes received{status.totalBytes === null ? '' : ` / ${status.totalBytes} declared`}</Text>
                {active ? <Progress label="Native OCR model installation" value={status.totalBytes && status.totalBytes > 0
                    ? status.downloadedBytes / status.totalBytes * 100 : undefined} /> : null}
                {status.message ? <Text accessibilityRole={status.phase === 'failed' ? 'alert' : undefined} selectable>{status.message}</Text> : null}
            </>}>
            {active ? <Button label={cancelling ? 'Cancellation requested' : 'Cancel OCR model installation'}
                accessibilityLabel="Cancel OCR model installation" variant="secondary" disabled={cancelling}
                onPress={() => void cancel()} /> : null}
        </SettingRow> : null}
    </Stack>;
}
