import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { DocumentPosition, DocumentRecord, ImagePageDescriptor, ImageReaderSettings, OcrAnalysisBatch,
    OcrPage, OcrProvider, OcrRect, OcrRequest } from '@mlearn/contracts';
import { RuntimeError } from '@mlearn/runtime-client';
import type { useRuntime } from '../../bootstrap/RuntimeProvider';
import { imageAnalysisWindow, pageSpread } from './imageFlow';

export type ImageReaderPage = {
    readonly descriptor: ImagePageDescriptor;
    readonly uri: string;
    readonly page: OcrPage | null;
    readonly batch: OcrAnalysisBatch | null;
    readonly analyzing: boolean;
    readonly analysisOffset: number;
    readonly error: string;
};
type ImageHost = Pick<Extract<ReturnType<typeof useRuntime>, { available: true }>, 'client' | 'ocr'>;
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** Native owners retain work/evidence. React retains only the visible spread,
 * unsubmitted controls and one action identity for an uncertain transport retry.
 */
export function useImageReader(host: ImageHost | null, source: DocumentRecord | undefined,
    pageIndex: number, enabled: boolean, frozen: OcrPage | null, canInterpret: boolean,
    onNavigate: (position: DocumentPosition) => Promise<boolean>) {
    const [settings, setSettings] = useState<ImageReaderSettings | null>(null);
    const [providers, setProviders] = useState<OcrProvider[]>([]);
    const [providerId, setProviderId] = useState('');
    const [language, setLanguage] = useState('');
    const [pages, setPages] = useState<ImageReaderPage[]>([]);
    const [pending, setPending] = useState(false);
    const [saving, setSaving] = useState(false);
    const [recognizing, setRecognizing] = useState(false);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [pageReload, setPageReload] = useState(0);
    const scope = useRef<object | null>(null);
    const currentPages = useRef(pages); currentPages.current = pages;
    const operation = useRef<{ readonly owner: object; readonly controller: AbortController } | null>(null);
    const retry = useRef<{ readonly owner: object; readonly request: OcrRequest } | null>(null);
    const analyses = useRef(new Map<string, object>());
    const preparedPages = useRef<ImageReaderPage[] | null>(null);
    const navigating = useRef(false);
    const settingsFlight = useRef(false);
    const sourceKey = source ? JSON.stringify([source.id, source.contentRevision, source.packageId, source.packageVersion]) : '';
    const callbacks = useRef({ navigate: onNavigate }); callbacks.current = { navigate: onNavigate };

    useEffect(() => {
        if (!host || !source || !enabled) return;
        const owner = {}; scope.current = owner;
        setSettings(null); setProviders([]); setPages([]); setError(''); setPending(true); setRecognizing(false);
        const background = AppState.addEventListener('change', state => {
            if (state !== 'active') operation.current?.controller.abort();
        });
        void Promise.all([host.client.imageReaderSettings(source.id), host.ocr.providers()])
            .then(([view, available]) => {
                if (scope.current !== owner) return;
                setSettings(view); setProviders(available);
                setProviderId(value => available.some(provider => provider.id === value) ? value : '');
            }).catch((cause: unknown) => { if (scope.current === owner) setError(message(cause)); })
            .finally(() => { if (scope.current === owner) setPending(false); });
        return () => {
            background.remove();
            if (scope.current === owner) {
                scope.current = null; analyses.current.clear(); retry.current = null; preparedPages.current = null;
                operation.current?.controller.abort(); operation.current = null;
            }
        };
    }, [host, sourceKey, enabled, reload]);

    const indices = settings && source?.totalPages
        ? pageSpread(pageIndex, source.totalPages, settings.paired, settings.firstPageSingle) : [];
    const spreadKey = indices.join(',');
    function update(resource: string, change: (page: ImageReaderPage) => ImageReaderPage) {
        setPages(value => value.map(page => page.descriptor.resourceId === resource ? change(page) : page));
    }
    async function analyze(page: OcrPage, offset = 0) {
        if (!host) return;
        const owner = scope.current;
        if (!owner) return;
        const selected = imageAnalysisWindow(page, offset);
        const token = {}; analyses.current.set(page.resourceId, token);
        update(page.resourceId, item => ({ ...item,
            batch: item.page?.ocrRevision === page.ocrRevision && item.analysisOffset === offset ? item.batch : null,
            analyzing: selected.ids.length > 0,
            analysisOffset: offset, error: selected.total && !selected.ids.length
                ? 'This region exceeds the text analysis limit. Recognize a smaller crop.' : '' }));
        if (!selected.ids.length) return;
        try {
            const batch = await host.client.analyzeOcr(page, selected.ids);
            if (scope.current === owner && analyses.current.get(page.resourceId) === token)
                update(page.resourceId, item => item.page?.ocrRevision === page.ocrRevision
                    ? { ...item, batch, analyzing: false } : item);
        } catch (cause) {
            if (scope.current === owner && analyses.current.get(page.resourceId) === token)
                update(page.resourceId, item => ({ ...item, analyzing: false, error: message(cause) }));
        }
    }
    async function receive(raw: OcrPage, original = false) {
        if (!host) return;
        const owner = scope.current;
        analyses.current.delete(raw.resourceId);
        update(raw.resourceId, item => ({ ...item, page: raw, batch: null, analyzing: canInterpret && !original, error: '' }));
        try {
            const interpreted = canInterpret && !original ? await host.client.postprocessOcr(raw) : raw;
            if (!owner || scope.current !== owner) return;
            update(raw.resourceId, item => ({ ...item, page: interpreted }));
            await analyze(interpreted);
        } catch (cause) {
            if (scope.current === owner)
                update(raw.resourceId, item => ({ ...item, error: message(cause), analyzing: false }));
        }
    }
    useEffect(() => {
        const owner = scope.current;
        if (!host || !source || !enabled || !settings || !indices.length || !owner) return;
        let live = true;
        setPending(true); setError('');
        const previous = preparedPages.current ?? currentPages.current;
        preparedPages.current = null;
        void (async () => {
            const loaded: ImageReaderPage[] = [];
            for (const index of indices) {
                const retained = previous.find(item => item.descriptor.pageIndex === index);
                if (retained) loaded.push(retained);
                else {
                    const descriptor = await host.client.imagePage(source.id, index);
                    const uri = await host.ocr.uri(source.id, descriptor.resourceId);
                    const original = frozen?.resourceId === descriptor.resourceId ? frozen : null;
                    const page = original ?? await host.client.readOcr(source.id, descriptor.resourceId);
                    if (page && page.contentRevision !== source.contentRevision)
                        throw new RuntimeError('protocol', 'Cached recognition belongs to a different source revision.');
                    loaded.push({ descriptor, uri, page, batch: null, analyzing: false, analysisOffset: 0, error: '' });
                }
            }
            if (!live || scope.current !== owner) return;
            setPages(loaded);
            for (const item of loaded) {
                if (item.page && !item.batch) void receive(item.page, item.page === frozen);
            }
        })().catch((cause: unknown) => { if (live && scope.current === owner) setError(message(cause)); })
            .finally(() => { if (live && scope.current === owner) setPending(false); });
        return () => { live = false; };
    }, [host, sourceKey, enabled, spreadKey, settings === null, frozen, canInterpret, pageReload]);

    async function changeSettings(change: Partial<ImageReaderSettings>) {
        if (!host || !source || !settings || settingsFlight.current) return;
        const owner = scope.current;
        settingsFlight.current = true; setSaving(true); setError('');
        try {
            const accepted = await host.client.saveImageReaderSettings(source.id, { ...settings, ...change });
            if (scope.current === owner) setSettings(accepted);
        } catch (cause) { if (scope.current === owner) setError(message(cause)); }
        finally { settingsFlight.current = false; if (scope.current === owner) setSaving(false); }
    }
    async function recognize(resourceId: string, crop: OcrRect | null = null, retryAction = false) {
        if (!host || !source || operation.current) return;
        const owner = scope.current;
        if (!owner) return;
        let request: OcrRequest;
        if (retryAction && retry.current?.owner === owner) request = retry.current.request;
        else {
            const provider = providers.find(value => value.id === providerId);
            if (!provider) return;
            request = host.client.prepareOcr(source, resourceId, provider, language ? [language] : [], crop);
        }
        const controller = new AbortController();
        const work = { owner, controller }; operation.current = work;
        retry.current = { owner, request }; setRecognizing(true); setError('');
        try {
            if (retryAction) {
                const recovery = await host.client.ocrRecovery(request);
                if (scope.current !== owner || controller.signal.aborted) return;
                if (recovery.state === 'completed') {
                    retry.current = null;
                    await receive(recovery.page);
                    return;
                }
                if (recovery.state === 'cancelled') {
                    const original = providers.find(provider => provider.id === request.providerId);
                    if (!original) throw new RuntimeError('unavailable', 'The original recognition provider is unavailable.');
                    request = host.client.prepareOcr(source, request.resourceId, original, request.recognitionLanguages, request.crop);
                    retry.current = { owner, request };
                }
            }
            const result = await host.ocr.recognize(request, controller.signal);
            if (scope.current === owner) {
                retry.current = null;
                await receive(result);
            }
        } catch (cause) {
            if (scope.current === owner) {
                if (controller.signal.aborted) retry.current = null;
                if (!(controller.signal.aborted && cause instanceof RuntimeError && cause.code === 'cancelled'))
                    setError(message(cause));
            }
        } finally {
            if (operation.current === work) { operation.current = null; setRecognizing(false); }
        }
    }
    async function go(direction: 'previous' | 'next') {
        if (!host || !source || !settings || !indices.length || navigating.current) return;
        const index = direction === 'next' ? indices[indices.length - 1] + 1 : indices[0] - 1;
        if (index < 0 || index >= (source.totalPages ?? 0)) return;
        const owner = scope.current;
        navigating.current = true; setPending(true); setError('');
        operation.current?.controller.abort();
        try {
            // Do not checkpoint a page whose original cannot be displayed.
            const prepared: ImageReaderPage[] = [];
            for (const target of pageSpread(index, source.totalPages ?? 0, settings.paired, settings.firstPageSingle)) {
                const descriptor = await host.client.imagePage(source.id, target);
                const uri = await host.ocr.uri(source.id, descriptor.resourceId);
                const page = await host.client.readOcr(source.id, descriptor.resourceId);
                prepared.push({ descriptor, uri, page, batch: null, analyzing: false, analysisOffset: 0, error: '' });
            }
            if (!owner || scope.current !== owner) return;
            preparedPages.current = prepared;
            const target = prepared.find(item => item.descriptor.pageIndex === index);
            if (target && !await callbacks.current.navigate(target.descriptor.position)) preparedPages.current = null;
        } catch (cause) { if (scope.current === owner) setError(message(cause)); }
        finally { navigating.current = false; if (scope.current === owner) setPending(false); }
    }
    async function navigate(position: DocumentPosition) {
        operation.current?.controller.abort();
        return callbacks.current.navigate(position);
    }
    async function refreshKnowledge() {
        for (const item of currentPages.current)
            if (item.page && item.batch) await analyze(item.page, item.analysisOffset);
    }
    return { pages, settings, providers, providerId, language, pending, saving, recognizing, error, indices,
        setProviderId: (value: string) => { setProviderId(value); setLanguage(''); },
        setLanguage, changeSettings, recognize, go, navigate, refreshKnowledge, analyze, receive,
        cancel: () => operation.current?.controller.abort(),
        retry: () => {
            const previous = retry.current;
            if (previous) void recognize(previous.request.resourceId, previous.request.crop, true);
            // A failed pixel load already has accepted settings. Retry that
            // spread directly, rather than depending on a transient null
            // settings render during full initialization.
            else if (settings) setPageReload(value => value + 1);
            else setReload(value => value + 1);
        },
        retryPage: (item: ImageReaderPage) => { if (item.page) void receive(item.page, item.page === frozen); },
    };
}
