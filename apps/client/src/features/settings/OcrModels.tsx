import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { PackageInstallStatus } from '@mlearn/contracts';
import type { useRuntime } from '../../bootstrap/RuntimeProvider';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Text } from '@mlearn/ui/text';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { failure, type Failure } from '../failure';
import { Progress } from '@mlearn/ui/progress';
import { Row, Stack, SettingRow } from '@mlearn/ui/layout';
import { useDeveloperMode } from '../../bootstrap/developerMode';

const phases = {
    downloading: 'Downloading',
    validating: 'Checking download',
    succeeded: 'Installed',
    failed: 'Installation failed',
    cancelled: 'Cancelled',
} satisfies Record<PackageInstallStatus['phase'], string>;

type Models = NonNullable<Extract<ReturnType<typeof useRuntime>, { available: true }>['ocrModels']>;
export function OcrModels({ models }: { readonly models: Models }) {
    const [developerMode] = useDeveloperMode();
    // Catalog labels name the recognition engines; that is diagnostic detail outside Developer mode.
    const name = (model: { readonly label: string }, index: number) => developerMode ? model.label
        : inventory && inventory.items.length > 1 ? `Text recognition model ${index + 1}` : 'Text recognition model';
    const [focused, setFocused] = useState(false);
    useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
    const [foreground, setForeground] = useState(AppState.currentState === 'active');
    const [inventory, setInventory] = useState<Awaited<ReturnType<Models['list']>> | null>(null);
    const [status, setStatus] = useState<PackageInstallStatus | null>(null);
    const [pending, setPending] = useState<{ id: string; kind: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Failure | null>(null);
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
            if (current) setError(failure(cause, 'OCR models couldn’t be listed.'));
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
                if (current) setError(failure(cause, 'Model installation progress couldn’t be read.'));
            }
        }
        void read();
        return () => { current = false; clearTimeout(timer); };
    }, [models, enabled, pending?.kind, reload]);
    async function run(id: string, kind: string, action: () => Promise<void>) {
        if (running.current) return;
        running.current = true; setPending({ id, kind }); setError(null); setResult(null);
        try { await action(); }
        catch (cause) { if (alive.current) setError(failure(cause, kind === 'install' ? 'This OCR model wasn’t installed.' : kind === 'remove' ? 'This OCR model wasn’t removed.' : 'This OCR model couldn’t be tested.')); }
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
            if (alive.current) { setCancelling(false); setError(failure(cause, 'Model installation couldn’t be cancelled.')); }
        }
    }
    return <Stack>
        <Row><Button label="Refresh OCR models" variant="secondary" disabled={loading}
            onPress={() => { setError(null); setReload(value => value + 1); }} /></Row>
        {loading ? <Text variant="caption" accessibilityLiveRegion="polite">Checking models…</Text> : null}
        {inventory?.catalogReason ? <FailureNotice message="New models can’t be downloaded right now. Installed models still work."
            detail={inventory.catalogReason} /> : null}
        {error ? <FailureNotice message={error.message} detail={error.detail}>
            <Button label="Retry" accessibilityLabel="Retry OCR models" variant="secondary" disabled={loading}
                onPress={() => { setError(null); setReload(value => value + 1); }} />
        </FailureNotice> : null}
        {inventory && !inventory.items.length ? <Text>No text recognition models are available on this device.</Text> : null}
        {inventory?.items.map((model, index) => <SettingRow key={model.id} label={name(model, index)} description={<>
            {developerMode ? <Text variant="detail" muted selectable>{model.target} · {model.bytes} bytes</Text> : null}
            <Text variant="caption" tone={model.installed ? 'success' : 'content'}>
                {model.installed ? 'Installed' : 'Not installed'}
                {model.installed && model.installedRevision !== model.revision ? ' · update available' : ''}
            </Text>
            {/* Before installation its resources are expectedly absent; only an installed model can be unusable. */}
            {model.installed && model.reason ? <FailureNotice message="This model can’t be used on this device." detail={model.reason} /> : null}
            {result?.id === model.id ? <>
                {developerMode ? <Text variant="caption" accessibilityLiveRegion="polite">
                    {result.value.detectedRegions} detected regions · {result.value.elapsedMs} ms engine work
                </Text> : null}
                <Text selectable>{result.value.rawRecognition}</Text>
            </> : null}
        </>}>
            <Row>
                {!model.installed || model.installedRevision !== model.revision ? <Button
                    label={model.installed ? 'Update model' : 'Install model'}
                    accessibilityLabel={`${model.installed ? 'Update' : 'Install'} ${name(model, index)}`} variant="secondary"
                    busy={pending?.id === model.id && pending.kind === 'install'} disabled={pending !== null || active}
                    onPress={() => void run(model.id, 'install', () => models.install(model.id))} /> : null}
                {model.installed ? <>
                    <Button label="Test model" accessibilityLabel={`Test ${name(model, index)}`} variant="secondary"
                        busy={pending?.id === model.id && pending.kind === 'test'} disabled={pending !== null || active}
                        onPress={() => void run(model.id, 'test', async () => {
                            const value = await models.test(model.id);
                            if (alive.current) setResult({ id: model.id, value });
                        })} />
                    <Dialog title="Remove OCR model" description={`Remove ${name(model, index)} from this device? Saved sources and recognized text are kept.`}
                        open={removing === model.id} onOpenChange={open => setRemoving(open ? model.id : null)}
                        trigger={<Button label="Remove model" accessibilityLabel={`Remove ${name(model, index)}`} variant="quiet" disabled={pending !== null || active} />}>
                        <Button label="Remove model resources" onPress={() => {
                            setRemoving(null); void run(model.id, 'remove', () => models.remove(model.id));
                        }} />
                    </Dialog>
                </> : null}
            </Row>
        </SettingRow>)}
        {/* A finished install is shown by its model row; this row reports work in progress or a failure. */}
        {status && status.phase !== 'succeeded' ? <SettingRow label={(() => {
            const index = inventory?.items.findIndex(model => model.id === status.command.pluginId) ?? -1;
            return inventory && index >= 0 ? name(inventory.items[index], index) : 'Text recognition model';
        })()}
            description={<>
                <Text variant="caption" accessibilityLiveRegion="polite">{phases[status.phase]}</Text>
                {active ? <Progress label="Model installation" value={status.totalBytes && status.totalBytes > 0
                    ? status.downloadedBytes / status.totalBytes * 100 : undefined} /> : null}
                {status.phase === 'failed' ? <FailureNotice message="This model wasn’t installed." detail={status.message} /> : null}
            </>}>
            {active ? <Button label={cancelling ? 'Cancellation requested' : 'Cancel OCR model installation'}
                accessibilityLabel="Cancel OCR model installation" variant="secondary" disabled={cancelling}
                onPress={() => void cancel()} /> : null}
        </SettingRow> : null}
    </Stack>;
}
