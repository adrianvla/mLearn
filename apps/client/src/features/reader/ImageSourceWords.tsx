import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { DocumentRecord, OcrPage, SourceAnchor } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { useRouter } from 'expo-router';
import type { Inspection } from '../inspector';
import { CaptureList, emptyMaterial, useSourcePractice, type CaptureCandidate } from '../material';
import { imageAnalysisWindow, imageAnchor, imageContext } from './imageFlow';
import type { ImageReaderPage } from './useImageReader';

/** Native source projections feed the same Capture/Inspector owners as a
 * transcript. Filtering and pagination are view state, not learner authority.
 */
export function ImageSourceWords({ client, source, pages, onInspect, onLocate, onBeforeOpen, onAnalyze }: {
    readonly client: RuntimeClient;
    readonly source: DocumentRecord;
    readonly pages: readonly ImageReaderPage[];
    readonly onInspect: (inspection: Inspection) => void;
    readonly onLocate: (source: SourceAnchor) => void;
    readonly onBeforeOpen: () => void;
    readonly onAnalyze: (page: OcrPage, offset: number) => Promise<void>;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [unknownOnly, setUnknownOnly] = useState(true);
    const [offset, setOffset] = useState(0);
    const trigger = useRef<View>(null);
    const scope = JSON.stringify([source.id, source.contentRevision, source.packageId, source.packageVersion,
        pages.map(page => [page.descriptor.resourceId, page.page?.ocrRevision, page.batch?.packageRevision])]);
    useEffect(() => {
        setOpen(false); setOffset(0);
    }, [scope]);
    const words = useMemo(() => {
        if (!open) return [];
        const seen = new Set<string>();
        const result: { candidate: CaptureCandidate; targets: string[]; packageRevision: string }[] = [];
        for (const item of pages) {
            if (!item.page || !item.batch || item.batch.packageId !== source.packageId
                || item.batch.packageVersion !== source.packageVersion) continue;
            for (const analyzed of item.batch.regions) {
                const region = item.page.regions.find(region => region.id === analyzed.regionId);
                if (!region || region.readingOf) continue;
                for (const token of analyzed.tokens) {
                    const targetId = token.targets[0];
                    if (!targetId || token.nearbyMeaning === false || seen.has(targetId)) continue;
                    const status = item.batch.annotations.find(annotation => annotation.regionId === region.id
                        && annotation.tokenStart === token.start)?.status ?? 'pending';
                    if (unknownOnly && (status === 'claimed_known' || status === 'assessed_known')) continue;
                    seen.add(targetId);
                    result.push({ candidate: { key: targetId, knowledgeStatus: status,
                        presentation: token.presentation,
                        content: { ...emptyMaterial(source.packageId), targetId, phrase: token.text,
                            packageRevision: item.batch.packageRevision, context: imageContext(item.page, region),
                            source: imageAnchor(source, item.page, item.descriptor.pageIndex, region, token) } },
                        targets: token.targets, packageRevision: item.batch.packageRevision });
                }
            }
        }
        return result;
    }, [open, pages, source, unknownOnly]);
    const membership = words.map(word => word.candidate.key).join('\0');
    useEffect(() => { setOffset(0); }, [membership]);
    const visible = words.slice(offset, offset + 128);
    const visibleKeys = useRef(new Set<string>());
    visibleKeys.current = new Set(visible.map(word => word.candidate.key));
    const practice = useSourcePractice(client, visible.map(word => word.candidate), scope, sessionId => {
        setOpen(false);
        router.push({ pathname: '../review', params: { sessionId } });
    });
    return <Dialog title="Page words" description="Source-linked words in the current analyzed regions."
        presentation="sidebar" open={open} onOpenChange={value => {
            if (value) onBeforeOpen();
            setOpen(value);
        }} trigger={<Button ref={trigger} label="Page words" variant="secondary" size="compact"
            disabled={!pages.some(page => page.batch)} />}>
        <Row>
            <Button label="Unknown words" variant="secondary" size="compact" accessibilityState={{ selected: unknownOnly }}
                onPress={() => setUnknownOnly(true)} />
            <Button label="All words" variant="secondary" size="compact" accessibilityState={{ selected: !unknownOnly }}
                onPress={() => setUnknownOnly(false)} />
        </Row>
        {pages.map(item => item.page ? <View key={item.descriptor.resourceId}>
            <Text variant="groupTitle">Page {item.descriptor.pageIndex + 1}</Text>
            {item.analysisOffset > 0 || imageAnalysisWindow(item.page, item.analysisOffset).next !== null ? <Row>
                <Button label={`Previous text regions on page ${item.descriptor.pageIndex + 1}`} variant="secondary" size="compact"
                    disabled={item.analyzing || item.analysisOffset === 0}
                    onPress={() => {
                        if (!item.page) return;
                        let previous = 0;
                        for (;;) {
                            const next = imageAnalysisWindow(item.page, previous).next;
                            if (next === null || next >= item.analysisOffset) break;
                            previous = next;
                        }
                        void onAnalyze(item.page, previous);
                    }} />
                <Button label={`More text regions on page ${item.descriptor.pageIndex + 1}`} variant="secondary" size="compact"
                    disabled={item.analyzing || imageAnalysisWindow(item.page, item.analysisOffset).next === null}
                    onPress={() => {
                        if (!item.page) return;
                        const next = imageAnalysisWindow(item.page, item.analysisOffset).next;
                        if (next !== null) void onAnalyze(item.page, next);
                    }} />
            </Row> : null}
            {item.analyzing ? <Text variant="caption" accessibilityLiveRegion="polite">Analyzing source text…</Text> : null}
            {item.error ? <Text variant="caption" accessibilityRole="alert">{item.error}</Text> : null}
        </View> : null)}
        {words.length ? <Text variant="caption" muted>
            Words {offset + 1}–{offset + visible.length} of {words.length}
        </Text> : <Text>No matching words in the analyzed regions.</Text>}
        <Button label={practice.retry ? 'Retry original Word Practice request' : 'Practice saved words in this view'}
             variant="secondary" size="compact" busy={practice.pending} disabled={!visible.length && !practice.retry}
             onPress={() => void practice.start()} />
        {practice.error ? <Text variant="caption" accessibilityRole="alert">{practice.error}</Text> : null}
        <CaptureList client={client} candidates={visible.map(word => word.candidate)}
            presentation="cards"
            onInspect={(candidate, anchor) => {
                const word = visible.find(word => word.candidate.key === candidate.key);
                const sourceAnchor = candidate.content.source;
                if (!word || !sourceAnchor) return;
                onInspect({ sourceForm: candidate.content.phrase, context: candidate.content.context,
                    targets: word.targets, packageRevision: word.packageRevision, sourceAnchor, showContext: true,
                    anchor: { ...anchor, restoreFocus: () => {
                        if (visibleKeys.current.has(candidate.key)) anchor.restoreFocus();
                        else trigger.current?.focus();
                    } } });
            }}
            onLocate={candidate => {
                if (candidate.content.source) { setOpen(false); onLocate(candidate.content.source); }
            }}
            onOpenMaterial={id => {
                setOpen(false); router.push({ pathname: '../materials', params: { id, sourceId: source.id } });
            }} />
        {words.length > 128 ? <Row>
            <Button label="Previous words" variant="secondary" disabled={offset === 0}
                onPress={() => setOffset(value => Math.max(0, value - 128))} />
            <Button label="More words" variant="secondary" disabled={offset + visible.length >= words.length}
                onPress={() => setOffset(value => value + 128)} />
        </Row> : null}
    </Dialog>;
}
