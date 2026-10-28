import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { KnowledgeEvidenceCursor, KnowledgeEvidencePage, KnowledgeKey } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';

export function KnowledgeEvidence({ client, knowledgeKey, label, onBack }: {
    readonly client: RuntimeClient;
    readonly knowledgeKey: KnowledgeKey;
    readonly label: string;
    readonly onBack: () => void;
}) {
    const [page, setPage] = useState<KnowledgeEvidencePage | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [stopped, setStopped] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const operation = useRef<object | null>(null);
    const retry = useRef<KnowledgeEvidenceCursor | null>(null);
    const back = useRef<View>(null);
    async function load(after: KnowledgeEvidenceCursor | null) {
        const owner = {};
        operation.current = owner;
        retry.current = after;
        setPending(true); setError(''); setStopped(false);
        try {
            const value = await client.knowledgeEvidence({ key: knowledgeKey, after });
            if (operation.current !== owner) return;
            setPage(value); setExpanded(null);
        } catch (cause) {
            if (operation.current === owner)
                setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (operation.current === owner) {
                operation.current = null; setPending(false);
            }
        }
    }
    useEffect(() => {
        back.current?.focus();
        void load(null);
        return () => { operation.current = null; };
    }, [client, knowledgeKey.packageId, knowledgeKey.targetId, knowledgeKey.capability]);
    return <View style={styles.stack} testID="knowledge-evidence">
        <Row>
            <Button ref={back} label="Back to entry" icon="arrowLeft" variant="media" size="compact" onPress={onBack} />
            <Text variant="inspectionBody" tone="media" accessibilityRole="header">{label} evidence</Text>
        </Row>
        {page ? <>
            <Text tone="media" selectable>Displayed status: {page.projection.status.replaceAll('_', ' ')}</Text>
            <Text tone="media" selectable>Explicit claim: {page.projection.claim === null ? 'none' : page.projection.claim ? 'known' : 'unknown'}
                {page.claimRevision !== null ? ` · revision ${page.claimRevision}` : ''}</Text>
            <Text tone="media" selectable>Assessed self-report: {page.projection.assessed === null ? 'unmeasured'
                : page.projection.assessed ? 'remembered' : 'missed'}</Text>
            <Text tone="media" selectable>Prediction: {page.projection.prediction === null ? 'unavailable'
                : String(page.projection.prediction)}</Text>
            <Text tone="media" muted variant="caption">
                Explicit claims take precedence without changing observations. Assessment uses the latest active qualifying
                independent retrieval self-report, not a success rate or externally validated performance.
                Worked-out, assisted and untested responses do not establish that assessment.
                No predictive model is available. Claim timestamps and a lifetime claim history are not recorded.
            </Text>
            <Text tone="media" variant="inspectionBody" accessibilityRole="header">Review observations</Text>
            {!page.observations.length ? <Text tone="media">No recorded Review observations for this capability.</Text> : null}
            {page.observations.map(item => <View key={item.attemptId} style={styles.observation}>
                <Button label={`${new Date(item.createdAt * 1000).toLocaleString()} · ${item.grade.method === 'remembered' ? 'Remembered' : 'Worked out'} · ${item.grade.quality}`}
                    accessibilityLabel={`Attempt ${item.sequence} details`} variant="media" size="compact"
                    icon={expanded === item.attemptId ? 'chevronDown' : 'chevronRight'}
                    accessibilityState={{ expanded: expanded === item.attemptId }}
                    onPress={() => setExpanded(value => value === item.attemptId ? null : item.attemptId)} />
                <Text tone="media" muted variant="caption">{!item.active ? 'Undone · excluded from assessment'
                    : page.assessedAttempt === item.attemptId ? 'Current assessment basis' : 'Recorded observation'}
                    {item.practice ? ' · Practice' : ' · Review'}</Text>
                {expanded === item.attemptId ? <>
                    <Text tone="media" selectable>Conditions: {item.conditions.exposureCount} exposure(s)
                        {' · '}{item.conditions.revealed ? 'answer revealed' : 'answer not revealed'}
                        {' · '}delivery {item.conditions.delivery.replaceAll('_', ' ')}
                        {' · '}assistance {item.conditions.assistance.length
                            ? item.conditions.assistance.map(value => value.replaceAll('_', ' ')).join(', ') : 'none'}</Text>
                    <Text tone="media" selectable>Assessment contribution: {item.assessed === null ? 'none'
                        : item.assessed ? 'remembered' : 'missed'}{item.grade.easy ? ' · marked easy' : ''}</Text>
                    <Text tone="media" muted variant="caption">Corrections replace this physical attempt's response,
                        retaining its original time and conditions; they are not additional retrievals.</Text>
                    <Text tone="media" selectable variant="caption">Material: {item.materialId} · revision {item.materialRevision}</Text>
                    <Text tone="media" selectable variant="caption">Package: {knowledgeKey.packageId} · {item.packageVersion}
                        {'\n'}Revision: {item.packageRevision}</Text>
                    <Text tone="media" selectable variant="caption">Probe: {item.probeId} · contract {item.probeContractVersion}
                        {' · '}{item.direction}</Text>
                    <Text tone="media" selectable variant="caption">Attempt: {item.attemptId}{'\n'}Session: {item.sessionId}
                        {'\n'}Encounter: {item.encounterId}</Text>
                    <Text tone="media" selectable variant="caption">{item.source
                        ? `Source: ${item.source.locator.kind} · ${item.source.sourceId} · revision ${item.source.contentRevision}\n${item.source.text}`
                        : 'Source: none recorded'}</Text>
                </> : null}
            </View>)}
        </> : null}
        {pending ? <Text tone="media" accessibilityLiveRegion="polite">Loading evidence…</Text> : null}
        {stopped ? <Text tone="media" accessibilityLiveRegion="polite">Evidence loading stopped.</Text> : null}
        {error ? <Text tone="media" accessibilityRole="alert">{error}</Text> : null}
        <Row>
            {pending ? <Button label="Stop loading evidence" variant="media" size="compact" onPress={() => {
                operation.current = null; setPending(false); setStopped(true);
            }} /> : null}
            {error ? <Button label="Retry evidence" variant="media" size="compact" disabled={pending}
                onPress={() => void load(retry.current)} /> : null}
            <Button label="Refresh evidence" variant="media" size="compact" disabled={pending}
                onPress={() => void load(null)} />
            {page?.next ? <Button label="Older observations" variant="media" size="compact" disabled={pending}
                onPress={() => void load(page.next)} /> : null}
        </Row>
    </View>;
}

const styles = StyleSheet.create(theme => ({
    stack: { gap: theme.spacing.small, minWidth: 0 },
    observation: { gap: theme.spacing.small, borderTopWidth: 1, borderTopColor: theme.media.border,
        paddingTop: theme.spacing.small, minWidth: 0 },
}));
