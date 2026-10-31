import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { DocumentAnalysisBatch, DocumentAppearance, DocumentCheckpoint, DocumentContentsPage, DocumentPosition,
    DocumentWindow, OcrPage, PluginSummary, SourceAnchor } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { blockPosition, byteLength, positionKey } from './documentFlow';

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
type Session = ReturnType<RuntimeClient['beginSourceSession']>;
type LocatedDocument = Extract<Awaited<ReturnType<RuntimeClient['returnSourceAnchor']>>,
    { type: 'document_material_source' | 'image_material_source' }>;

/** The view holds only the current bounded window and native projections. */
export function useReader(client: RuntimeClient, id: string, materialId?: string,
    reviewSessionId?: string, reviewEncounterId?: string, originalPages: boolean | null = null, proposalId?: string) {
    const [window, setWindow] = useState<DocumentWindow | null>(null);
    const [batch, setBatch] = useState<DocumentAnalysisBatch | null>(null);
    const [contents, setContents] = useState<DocumentContentsPage | null>(null);
    const [languages, setLanguages] = useState<PluginSummary[]>([]);
    const [position, setPosition] = useState<DocumentPosition | null>(null);
    const [returned, setReturned] = useState<SourceAnchor | null>(null);
    const [returnedPage, setReturnedPage] = useState<OcrPage | null>(null);
    const [pending, setPending] = useState(false);
    const [analysisPending, setAnalysisPending] = useState(false);
    const [contentsPending, setContentsPending] = useState(false);
    const [error, setError] = useState('');
    const [analysisError, setAnalysisError] = useState('');
    const [contentsError, setContentsError] = useState('');
    const [saveError, setSaveError] = useState('');
    const [reload, setReload] = useState(0);
    const [analysisReload, setAnalysisReload] = useState(0);
    const [admission, setAdmission] = useState<DocumentPosition | null>(null);
    const scope = useRef<object | null>(null);
    const session = useRef<Session | null>(null);
    const operation = useRef<object | null>(null);
    const current = useRef<DocumentWindow | null>(null);
    const visible = useRef<DocumentPosition | null>(null);
    const desiredSave = useRef<DocumentCheckpoint | null>(null);
    const saveFlight = useRef<Promise<void> | null>(null);
    const saveFailure = useRef<{ sourceId: string; message: string } | null>(null);
    const contentsOwner = useRef<object | null>(null);

    const persist = useCallback((): Promise<void> => {
        const value = current.current;
        const point = visible.current;
        if (!value || !point) return Promise.resolve();
        desiredSave.current = { sourceId: value.source.id, contentRevision: value.source.contentRevision,
            appearance: value.source.appearance, position: point };
        if (saveFlight.current) return saveFlight.current;
        const active = scope.current;
        const save = async () => {
            while (desiredSave.current) {
                const checkpoint = desiredSave.current;
                desiredSave.current = null;
                try {
                    await client.checkpointDocument(checkpoint);
                    if (saveFailure.current?.sourceId === checkpoint.sourceId) saveFailure.current = null;
                    if (scope.current === active && active) setSaveError('');
                } catch (cause) {
                    saveFailure.current = { sourceId: checkpoint.sourceId, message: message(cause) };
                    if (scope.current === active && active) setSaveError(message(cause));
                    throw cause;
                }
            }
        };
        const flight = save().finally(() => { saveFlight.current = null; });
        saveFlight.current = flight;
        return flight;
    }, [client]);

    function publish(value: DocumentWindow, point?: DocumentPosition | null) {
        const first = value.blocks[0];
        const target = point ?? value.source.position ?? (first ? blockPosition(value.source, first) : null);
        current.current = value; visible.current = target;
        setWindow(value); setPosition(target); setAdmission(target); setBatch(null);
    }

    useFocusEffect(useCallback(() => {
        const active = {}; scope.current = active;
        setSaveError(saveFailure.current?.sourceId === id ? saveFailure.current.message : '');
        const owned = client.beginSourceSession(); session.current = owned;
        const background = AppState.addEventListener('change', state => {
            if (state !== 'active' && scope.current === active)
                void persist().catch(() => { /* Save recovery remains beside Reader progress. */ });
        });
        setPending(true); setError(''); setBatch(null); setReturned(null); setReturnedPage(null); setContents(null);
        let returning: SourceAnchor | null = null;
        let image: OcrPage | null = null;
        void owned.ready.then(async () => {
            // Review owns a frozen source; ordinary Material Return follows the
            // current authored association instead.
            const result = reviewSessionId && reviewEncounterId
                ? await client.returnReviewSource(reviewSessionId, reviewEncounterId)
                : materialId ? await client.returnMaterialSource(materialId)
                : proposalId ? await client.returnMaterialProposalSource(proposalId) : null;
            if (result) {
                if (result.type === 'material_source' || result.type === 'conversation_material_source'
                    || result.window.source.id !== id)
                    throw new RuntimeError('invalid_request', 'This source return does not match the selected document.');
                returning = result.anchor;
                if (result.type === 'image_material_source') image = result.page;
                return result.window;
            }
            return client.resumeDocument(id);
        }).then(value => {
            if (scope.current !== active || !owned.isCurrent()) return;
            let target = value.source.position;
            if (returning?.locator.kind === 'document') {
                target = { parserRevision: returning.locator.parserRevision, resource: returning.locator.resource,
                    blockId: returning.locator.blockId, offset: returning.locator.contextStart + returning.locator.selectionStart };
            }
            publish(value, target); setReturned(returning); setReturnedPage(image);
        }).catch((cause: unknown) => {
            if (scope.current === active && owned.isCurrent()) setError(message(cause));
        }).finally(() => { if (scope.current === active) setPending(false); });
        void client.snapshot().then(snapshot => {
            if (scope.current === active)
                setLanguages(snapshot.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')));
        }).catch((cause: unknown) => { if (scope.current === active) setError(message(cause)); });
        return () => {
            background.remove();
            void persist().catch(() => { /* The initiating save retains visible recovery feedback on refocus. */ });
            if (scope.current === active) {
                const activeSession = session.current;
                scope.current = null; operation.current = null; contentsOwner.current = null;
                void activeSession?.cancel().catch((cause: unknown) => {
                    if (scope.current === active) setError(message(cause));
                });
            }
        };
    }, [client, id, materialId, proposalId, reviewSessionId, reviewEncounterId, reload, persist]));

    const identity = window ? JSON.stringify([window.source.id, window.source.contentRevision,
        window.source.parserRevision, window.source.packageId, window.source.packageVersion]) : '';
    const imageMode = window?.source.format === 'images' || window?.source.format === 'pdf'
        && (originalPages ?? returnedPage !== null);
    const admissionKey = positionKey(admission);
    useEffect(() => {
        const value = current.current;
        const owned = session.current;
        const active = scope.current;
        if (!value || !active || !owned?.isCurrent() || pending) return;
        if (imageMode) { setAnalysisPending(false); return; }
        let live = true;
        setAnalysisPending(true); setAnalysisError('');
        void client.analyzeDocument(value.source.id, admission).then(result => {
            if (live && scope.current === active && owned.isCurrent()
                && result.sourceId === value.source.id && result.contentRevision === value.source.contentRevision
                && result.parserRevision === value.source.parserRevision && result.packageId === value.source.packageId
                && result.packageVersion === value.source.packageVersion) setBatch(result);
        }).catch((cause: unknown) => {
            if (live && scope.current === active && !(cause instanceof RuntimeError && cause.code === 'cancelled'))
                setAnalysisError(message(cause));
        }).finally(() => { if (live && scope.current === active) setAnalysisPending(false); });
        return () => { live = false; };
    }, [client, identity, admissionKey, pending, analysisReload, imageMode]);

    async function change(read: () => Promise<DocumentWindow | LocatedDocument>, point?: DocumentPosition | null): Promise<boolean> {
        const active = scope.current;
        if (!active || operation.current) return false;
        const intent = {}; operation.current = intent;
        setPending(true); setError('');
        try {
            await persist();
            await session.current?.cancel();
            if (scope.current !== active || operation.current !== intent) return false;
            const owned = client.beginSourceSession(); session.current = owned;
            await owned.ready;
            if (scope.current !== active || operation.current !== intent) return false;
            const value = await read();
            if (scope.current === active && operation.current === intent && owned.isCurrent()) {
                publish('window' in value ? value.window : value, point);
                setReturned('anchor' in value ? value.anchor : null);
                setReturnedPage('page' in value ? value.page : null);
                return true;
            }
            return false;
        } catch (cause) {
            if (scope.current === active && operation.current === intent) setError(message(cause));
            return false;
        } finally {
            if (scope.current === active && operation.current === intent) { operation.current = null; setPending(false); }
        }
    }
    function navigate(point: DocumentPosition | null) {
        return change(() => client.documentWindow(id, point), point);
    }
    function locate(anchor: SourceAnchor) {
        return change(async () => {
            const result = await client.returnSourceAnchor(anchor);
            if (result.type === 'material_source' || result.type === 'conversation_material_source'
                || result.window.source.id !== id)
                throw new RuntimeError('invalid_request', 'This source return does not match the selected document.');
            return result;
        });
    }
    async function cancel() {
        const active = scope.current;
        operation.current = null;
        try {
            await session.current?.cancel();
            if (scope.current === active)
                setError('Document loading cancelled. The current passage is retained; retry to resume analysis.');
        }
        catch (cause) { if (scope.current === active) setError(message(cause)); }
        if (scope.current === active) {
            setPending(false); setAnalysisPending(false);
        }
    }
    function onPosition(point: DocumentPosition, checkpoint: boolean) {
        const value = current.current;
        if (!scope.current || !value || point.parserRevision !== value.source.parserRevision
            || !value.blocks.some(block => block.resource === point.resource && block.id === point.blockId)) return;
        visible.current = point; setPosition(point);
        const covered = batch?.blocks.some(block => block.resource === point.resource && block.blockId === point.blockId
            && block.start <= point.offset && block.start + byteLength(block.text) > point.offset);
        if (!covered) setAdmission(previous => positionKey(previous) === positionKey(point) ? previous : point);
        if (checkpoint) void persist().catch(() => { /* saveError is shown next to Reader progress. */ });
    }
    function appearance(value: DocumentAppearance) {
        const previous = current.current;
        if (!previous) return;
        const changed = { ...previous, source: { ...previous.source, appearance: value } };
        current.current = changed;
        setWindow(changed);
        // The renderer restores the retained visible byte before reporting its
        // post-reflow layout. This write also preserves settings on immediate exit.
        void persist().catch(() => { /* saveError provides explicit retry. */ });
    }
    async function loadContents(after: number | null = null) {
        const active = scope.current;
        const value = current.current;
        if (!active || !value) return;
        const request = {}; contentsOwner.current = request;
        setContentsPending(true); setContentsError('');
        try {
            const page = await client.documentContents(id, after);
            if (scope.current === active && contentsOwner.current === request
                && current.current?.source.parserRevision === page.parserRevision) setContents(page);
        } catch (cause) {
            if (scope.current === active && contentsOwner.current === request) setContentsError(message(cause));
        } finally {
            if (scope.current === active && contentsOwner.current === request) setContentsPending(false);
        }
    }
    async function refreshKnowledge() {
        const value = batch;
        const active = scope.current;
        const owned = session.current;
        const first = value?.blocks[0];
        if (!value || !active || !first || !owned?.isCurrent() || imageMode) return;
        // The existing native analysis owner caches immutable tokenization under
        // source/package/chunk identity and refreshes Knowledge on every read.
        // Reuse that owner rather than reimplementing its status merge in React.
        const refreshed = await client.analyzeDocument(value.sourceId, { parserRevision: value.parserRevision,
            resource: first.resource, blockId: first.blockId, offset: first.start });
        if (scope.current === active && owned.isCurrent())
            setBatch(previous => previous === value ? refreshed : previous);
    }
    return { window, batch, contents, languages, position, returned, returnedPage, imageMode, pending, analysisPending, contentsPending,
        error, analysisError, contentsError, saveError, persist, navigate, locate, cancel, onPosition, appearance,
        loadContents, refreshKnowledge, retry: () => setReload(value => value + 1),
        retryAnalysis: () => setAnalysisReload(value => value + 1),
        setLanguage: (packageId: string) => change(() => client.setDocumentLanguage(id, packageId)) };
}
