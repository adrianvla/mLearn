import { useEffect, useRef, useState, type RefObject } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { AnalysisBatch, DictionaryResult, SourceAnchor, SourceRecord } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { DictionaryCard } from '@mlearn/ui/dictionary-card';
import { MediaOverlay } from '@mlearn/ui/media-overlay';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import type { Inspection } from '../inspector';
import { cueAnchor } from '../material';

type Card = {
    readonly id: string;
    readonly result: DictionaryResult;
    readonly sourceForm: string;
    readonly context: string;
    readonly alternatives: string[];
    readonly sourceAnchor: SourceAnchor;
    readonly expiresAt: number;
};

/** A bounded display history, never a second dictionary or Knowledge authority. */
export function LiveWordCards({ client, batch, source, cueKey, onInspect, focusFallback, onClose }: {
    readonly client: RuntimeClient;
    readonly batch: AnalysisBatch;
    readonly source: SourceRecord;
    readonly cueKey: string;
    readonly onInspect: (inspection: Inspection) => void;
    readonly focusFallback: RefObject<View | null>;
    readonly onClose: () => void;
}) {
    const viewport = useWindowDimensions();
    const [cards, setCards] = useState<readonly Card[]>([]);
    const [cardWidth, setCardWidth] = useState(300);
    const scroll = useRef<ScrollView>(null);
    const history = useRef<readonly Card[]>([]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const consumedReload = useRef(0);
    const candidates = new Map<string, Pick<Card, 'sourceForm' | 'context' | 'alternatives' | 'sourceAnchor'>>();
    const visible = new Set(cueKey.split(',').map(Number));
    for (const cue of batch.cues) {
        if (!visible.has(cue.cue.index)) continue;
        for (const token of cue.tokens) {
            if (token.nearbyMeaning === false || batch.annotations.some(annotation =>
                annotation.cueIndex === cue.cue.index && annotation.tokenStart === token.start
                && annotation.status === 'claimed_known')) continue;
            // One card per lexical group, not six homographs crowding out the
            // next word. The initial dictionary alternative is not a sense rank.
            const target = token.targets[0];
            if (target && candidates.size < 6 && !candidates.has(target))
                candidates.set(target, { sourceForm: token.text, context: cue.cue.text, alternatives: token.targets,
                    sourceAnchor: cueAnchor(source, cue.cue, token, Math.max(0, cue.cue.startMs - source.subtitleOffsetMs)) });
        }
    }
    const targets = [...candidates.keys()];
    const targetKey = JSON.stringify(targets);
    function publish(next: readonly Card[]) {
        history.current = next;
        setCards(next);
    }
    useEffect(() => {
        let active = true;
        setPending(false);
        setError('');
        if (!targets.length) return;
        const now = Date.now();
        const retained = history.current.filter(card => card.expiresAt > now);
        const retrying = reload !== consumedReload.current;
        consumedReload.current = reload;
        const missing = targets.filter(id => retrying || !retained.some(card => card.id === id));
        function present(items: readonly DictionaryResult[]) {
            if (!active) return;
            const current = targets.flatMap(id => {
                const source = candidates.get(id);
                const result = items.find(item => (item.state === 'available' ? item.summary.targetId : item.targetId) === id)
                    ?? retained.find(card => card.id === id)?.result;
                return source && result ? [{ id, ...source, result, expiresAt: Date.now() + 30000 }] : [];
            });
            publish([...current, ...retained.filter(card => !targets.includes(card.id))].slice(0, 6));
        }
        if (!missing.length) present([]);
        else {
            setPending(true);
            void client.inspectTargets(batch.sourceId, batch.subtitleRevision, batch.packageRevision, missing)
                .then(value => { if (active) present(value.items); })
                .catch((cause: unknown) => {
                    if (active) setError(cause instanceof Error ? cause.message : String(cause));
                }).finally(() => { if (active) setPending(false); });
        }
        return () => { active = false; };
    }, [client, batch.sourceId, batch.subtitleRevision, batch.packageRevision, cueKey, targetKey, reload]);
    useEffect(() => {
        if (!cards.length) return;
        const timer = setTimeout(() => publish(history.current.filter(card => card.expiresAt > Date.now())),
            Math.max(0, Math.min(...cards.map(card => card.expiresAt)) - Date.now()));
        return () => clearTimeout(timer);
    }, [cards]);
    const sourceIdentity = JSON.stringify([batch.sourceId, batch.subtitleRevision, batch.packageRevision]);
    const current = useRef<string | null>(sourceIdentity); current.current = sourceIdentity;
    useEffect(() => () => { current.current = null; }, []);
    async function inspect(card: Card, anchor: Inspection['anchor']) {
        const captured = card.sourceAnchor;
        const cueIndex = captured.locator.cueIndex;
        if (cueIndex === null || captured.locator.subtitleRevision === null) return;
        try {
            const position = await client.cuePosition(captured.sourceId, captured.locator.subtitleRevision, cueIndex);
            if (current.current !== sourceIdentity) return;
            onInspect({ sourceForm: card.sourceForm, context: card.context, targets: card.alternatives,
                initialTargetId: card.id, packageRevision: batch.packageRevision, anchor,
                sourceAnchor: { ...captured, locator: { ...captured.locator, positionMs: position } } });
        } catch (cause) { if (current.current === sourceIdentity) setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    if (!cards.length && !pending && !error) return null;
    const rows = viewport.width < 720 && viewport.height < 650 ? 1 : 2;
    return <MediaOverlay testID="live-word-cards" variant="cards"
        closeLabel="Hide live word translator" onClose={onClose}>
        <View style={[styles.content, pending || error ? styles.feedback : null]}>
            <ScrollView ref={scroll} horizontal style={styles.scroll} contentContainerStyle={styles.cards}
                onLayout={event => setCardWidth(Math.min(300, event.nativeEvent.layout.width))}
                keyboardShouldPersistTaps="handled">
                {Array.from({ length: Math.ceil(cards.length / rows) }, (_, column) =>
                    <View key={column} style={[styles.column, { width: cardWidth }]}
                        onFocus={() => scroll.current?.scrollTo({ x: column * (cardWidth + 10), animated: false })}>
                    {cards.slice(column * rows, (column + 1) * rows).map(card => card.result.state === 'available' ?
                    <DictionaryCard key={card.id} meaning={card.result.summary.summary}
                        focusFallback={focusFallback}
                        reading={card.result.summary.reading ?? card.result.summary.headword}
                        onActivate={anchor => void inspect(card, anchor)} /> :
                    <View key={card.id} style={styles.unavailable}>
                        <Text variant="caption" tone="media">{card.sourceForm}: {card.result.message}</Text>
                        <Button label="Retry dictionary entry" size="compact" variant="media" onPress={() => setReload(value => value + 1)} />
                    </View>)}
                    </View>)}
            </ScrollView>
            {pending ? <Text variant="caption" tone="media" accessibilityLiveRegion="polite">Looking up dictionary meanings…</Text> : null}
            {error ? <><Text variant="caption" tone="media" accessibilityRole="alert">{error}</Text>
                <Button label="Retry live word lookup" size="compact" variant="media" onPress={() => setReload(value => value + 1)} /></> : null}
        </View>
    </MediaOverlay>;
}

const styles = StyleSheet.create(theme => ({
    content: { minWidth: 0, gap: theme.spacing.tiny },
    scroll: { flexGrow: 0, flexShrink: 1 },
    cards: { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 10 },
    column: { gap: 10 },
    feedback: { padding: theme.spacing.small, borderRadius: theme.radius, backgroundColor: theme.media.chrome },
    unavailable: { maxWidth: 300, gap: theme.spacing.tiny, padding: theme.spacing.small,
        borderRadius: theme.radius, backgroundColor: theme.media.chrome },
}));
