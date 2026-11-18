import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import type { DocumentAnalysisBatch, DocumentRecord, OcrPage, SourceAnchor } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import type { Inspection } from '../inspector';
import { CaptureList, emptyMaterial, useCandidateMeanings, useSourcePractice, type CaptureCandidate } from '../material';
import { FailureNotice } from '@mlearn/ui/failure-notice';
import { documentAnchor } from './documentFlow';
import { imageAnalysisWindow, imageAnchor, imageContext } from './imageFlow';
import type { ImageReaderPage } from './useImageReader';

export type VocabularyWord = {
    readonly candidate: CaptureCandidate;
    readonly targets: readonly string[];
    readonly packageRevision: string;
    readonly lexical: boolean;
};
type Filter = 'all' | 'dictionary' | 'hovered';
const pageSize = 128;
const known = (status: string | undefined) => status === 'claimed_known' || status === 'assessed_known';

export function documentWords(source: DocumentRecord, batch: DocumentAnalysisBatch | null): VocabularyWord[] {
    if (!batch || batch.packageId !== source.packageId || batch.packageVersion !== source.packageVersion) return [];
    const seen = new Set<string>();
    const words: VocabularyWord[] = [];
    for (const block of batch.blocks) for (const token of block.tokens) {
        const targetId = token.targets[0];
        if (!targetId || seen.has(targetId)) continue;
        seen.add(targetId);
        const status = batch.annotations.find(item => item.resource === block.resource && item.blockId === block.blockId
            && item.tokenStart === token.start)?.status ?? 'untracked';
        words.push({ targets: token.targets, packageRevision: batch.packageRevision, lexical: token.nearbyMeaning !== false,
            candidate: { key: targetId, knowledgeStatus: status, presentation: token.presentation,
                content: { ...emptyMaterial(source.packageId), targetId, phrase: token.text, packageRevision: batch.packageRevision,
                    context: block.text, source: documentAnchor(source, block, token) } } });
    }
    return words;
}

export function imageWords(source: DocumentRecord, pages: readonly ImageReaderPage[]): VocabularyWord[] {
    const seen = new Set<string>();
    const words: VocabularyWord[] = [];
    for (const item of pages) {
        if (!item.page || !item.batch || item.batch.packageId !== source.packageId
            || item.batch.packageVersion !== source.packageVersion) continue;
        for (const analyzed of item.batch.regions) {
            const region = item.page.regions.find(value => value.id === analyzed.regionId);
            if (!region || region.readingOf) continue;
            for (const token of analyzed.tokens) {
                const targetId = token.targets[0];
                if (!targetId || seen.has(targetId)) continue;
                seen.add(targetId);
                const status = item.batch.annotations.find(annotation => annotation.regionId === region.id
                    && annotation.tokenStart === token.start)?.status ?? 'pending';
                words.push({ targets: token.targets, packageRevision: item.batch.packageRevision, lexical: token.nearbyMeaning !== false,
                    candidate: { key: targetId, knowledgeStatus: status, presentation: token.presentation,
                        content: { ...emptyMaterial(source.packageId), targetId, phrase: token.text,
                            packageRevision: item.batch.packageRevision, context: imageContext(item.page, region),
                            source: imageAnchor(source, item.page, item.descriptor.pageIndex, region, token) } } });
            }
        }
    }
    return words;
}

/** The Reader's right-hand Vocabulary region. Filtering and ordering are view
 * state; capture, exclusion and Practice use the shared Material owners.
 */
export function VocabularyPanel({ client, source, words, hovered, status, pages, onAnalyze, onInspect, onLocate, onClose }: {
    readonly client: RuntimeClient;
    readonly source: DocumentRecord;
    readonly words: readonly VocabularyWord[];
    readonly hovered: ReadonlySet<string>;
    readonly status: string | null;
    readonly pages?: readonly ImageReaderPage[];
    readonly onAnalyze?: (page: OcrPage, offset: number) => Promise<void>;
    readonly onInspect: (inspection: Inspection) => void;
    readonly onLocate: (anchor: SourceAnchor) => void;
    readonly onClose: () => void;
}) {
    const router = useRouter();
    const [filter, setFilter] = useState<Filter>('all');
    const [order, setOrder] = useState<'reading' | 'unknown'>('reading');
    const [offset, setOffset] = useState(0);
    const close = useRef<View>(null);
    const filtered = useMemo(() => {
        const selected = words.filter(word => filter === 'all' ? true : filter === 'dictionary' ? word.lexical
            : word.targets.some(target => hovered.has(target)));
        return order === 'unknown'
            ? [...selected].sort((a, b) => Number(known(a.candidate.knowledgeStatus)) - Number(known(b.candidate.knowledgeStatus)))
            : selected;
    }, [words, filter, order, hovered]);
    const first = offset < filtered.length ? offset : 0;
    const visible = filtered.slice(first, first + pageSize);
    const visibleKeys = useRef(new Set<string>());
    visibleKeys.current = new Set(visible.map(word => word.candidate.key));
    const scope = JSON.stringify([source.id, source.contentRevision, source.packageId, source.packageVersion]);
    // One package revision analyzed this view; its entries supply each card's nearby meaning.
    const packageRevision = visible[0]?.packageRevision ?? null;
    const meanings = useCandidateMeanings(packageRevision ? ids => client.targetSummaries(source.packageId, packageRevision, ids) : null,
        JSON.stringify([source.packageId, packageRevision]), visible.map(word => word.candidate));
    const cards = visible.map(word => meanings.resolve(word.candidate) ?? word.candidate);
    const practice = useSourcePractice(client, cards, scope, sessionId => {
        router.push({ pathname: '../review', params: { sessionId } });
    });
    const more = (pages ?? []).filter(item => item.page && imageAnalysisWindow(item.page, item.analysisOffset).next !== null);
    // The title and its count belong to the same top band as the list controls (golden Reader).
    const header = <View style={styles.controls}>
        <View style={styles.heading}>
            <View style={styles.title}>
                <Text variant="groupTitle" accessibilityRole="header">Vocabulary</Text>
                {words.length ? <Text variant="caption" muted>{filtered.length} words</Text> : null}
            </View>
            <Button ref={close} label="Close vocabulary" icon="close" iconOnly variant="quiet" size="compact" onPress={onClose} />
        </View>
        <Row wrap={false}>
            <Button label={practice.retry ? 'Retry Practise' : 'Practise'} variant="secondary" tone="warning" size="compact"
                busy={practice.pending} disabled={!visible.length && !practice.retry} onPress={() => void practice.start()} />
        </Row>
        {practice.error ? <Text variant="caption" accessibilityRole="alert">Practice couldn’t start.</Text> : null}
        {meanings.error ? <FailureNotice message={meanings.error.message} detail={meanings.error.detail}>
            <Button label="Retry" accessibilityLabel="Retry dictionary entries" variant="secondary" size="compact" onPress={meanings.retry} />
        </FailureNotice> : null}
        <View style={styles.order}><Select label="Word order" size="compact" value={order}
            options={[{ value: 'reading', label: 'Reading order' }, { value: 'unknown', label: 'Unknown first' }]}
            onValueChange={value => { setOrder(value === 'unknown' ? 'unknown' : 'reading'); setOffset(0); }} /></View>
        <Row>
            {([['all', 'All'], ['dictionary', 'Dictionary only'], ['hovered', 'Hovered words']] as const).map(([value, label]) =>
                <Button key={value} label={label} variant="pill" tone={filter === value ? 'info' : 'neutral'} size="compact"
                    accessibilityState={{ selected: filter === value }} onPress={() => { setFilter(value); setOffset(0); }} />)}
        </Row>
        {more.map(item => <Button key={item.descriptor.resourceId} label={`More text on page ${item.descriptor.pageIndex + 1}`}
            variant="quiet" size="compact" disabled={item.analyzing} onPress={() => {
                const next = item.page ? imageAnalysisWindow(item.page, item.analysisOffset).next : null;
                if (item.page && next !== null) void onAnalyze?.(item.page, next);
            }} />)}
    </View>;
    return <View style={styles.panel} testID="reader-side-panel">
        <CaptureList client={client} candidates={cards} presentation="cards" header={header}
            onInspect={(candidate, anchor: TextAnchor) => {
                const word = visible.find(value => value.candidate.key === candidate.key);
                const sourceAnchor = candidate.content.source;
                if (!word || !sourceAnchor) return;
                onInspect({ sourceForm: candidate.content.phrase, context: candidate.content.context,
                    targets: [...word.targets], packageRevision: word.packageRevision, sourceAnchor, showContext: true,
                    anchor: { ...anchor, restoreFocus: () => {
                        if (visibleKeys.current.has(candidate.key)) anchor.restoreFocus();
                        else close.current?.focus();
                    } } });
            }}
            onLocate={candidate => { if (candidate.content.source) onLocate(candidate.content.source); }}
            onOpenMaterial={id => router.push({ pathname: '../materials', params: { id, sourceId: source.id } })} />
        {!visible.length ? <Text muted accessibilityLiveRegion="polite">
            {status ?? (filter === 'hovered' ? 'Words you inspect appear here.' : 'No words here yet.')}
        </Text> : null}
        {filtered.length > pageSize ? <Row>
            <Button label="Previous words" variant="secondary" size="compact" disabled={first === 0}
                onPress={() => setOffset(Math.max(0, first - pageSize))} />
            <Button label="More words" variant="secondary" size="compact" disabled={first + visible.length >= filtered.length}
                onPress={() => setOffset(first + pageSize)} />
        </Row> : null}
    </View>;
}

const styles = StyleSheet.create(theme => ({
    panel: { gap: theme.spacing.compact },
    heading: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch', gap: theme.spacing.small },
    title: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
    controls: { gap: theme.spacing.compact, alignItems: 'flex-start' },
    order: { minWidth: 160 },
}));
