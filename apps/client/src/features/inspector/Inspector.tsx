import { useState, useEffect } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ContextPanel } from '@mlearn/ui/context-panel';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import { Text } from '@mlearn/ui/text';
import { Row } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import { Badge } from '@mlearn/ui/badge';
import type { LexicalEntry, KnowledgeProjection, ClaimChange } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
export type Inspection = {
    sourceForm: string;
    context: string;
    targets: string[];
    anchor: TextAnchor;
    showContext?: boolean;
    onChanged?: () => Promise<void>;
};
export function Inspector({ inspection, packageId, client, knowledge, onChanged, onClose }: {
    inspection: Inspection;
    packageId: string;
    client: RuntimeClient;
    knowledge: KnowledgeProjection[];
    onChanged: () => Promise<void>;
    onClose: () => void;
}) {
    const [index, setIndex] = useState(0);
    const [entry, setEntry] = useState<LexicalEntry | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [retry, setRetry] = useState<ClaimChange | null>(null);
    const [lookupVersion, setLookupVersion] = useState(0);
    const [expandedCapability, setExpandedCapability] = useState<string | null>(null);
    const [showSource, setShowSource] = useState(false);
    const [showAlternatives, setShowAlternatives] = useState(false);
    useEffect(() => {
        let active = true;
        setError('');
        setEntry(null);
        setRetry(null);
        setExpandedCapability(null);
        setShowSource(false);
        client.inspectTarget(packageId, inspection.targets[index]).then(value => {
            if (active)
                setEntry(value);
        }).catch(e => {
            if (active)
                setError(String(e.message ?? e));
        });
        return () => { active = false; };
    }, [client, packageId, inspection.targets, index, lookupVersion]);
    async function commit(change: ClaimChange) {
        setBusy(true);
        setError('');
        try {
            await client.changeClaim(change);
            setRetry(null);
            await onChanged();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setRetry(change);
        }
        finally {
            setBusy(false);
        }
    }
    const activeCapability = entry?.capabilities.find(cap => cap.id === expandedCapability);
    const activeProjection = knowledge.find(projection =>
        projection.key.packageId === packageId && projection.key.targetId === entry?.targetId
        && projection.key.capability === expandedCapability);
    return (
        <ContextPanel title={entry?.headword ?? inspection.sourceForm} anchor={inspection.anchor} onClose={onClose} sourceContext={inspection.context} alwaysShowContext={inspection.showContext}
            footer={entry ? <>
                {activeCapability ? <View style={styles.adjustment}>
                    <Text tone="media">{activeCapability.label} · {activeProjection?.status.replaceAll('_', ' ') ?? 'untracked'}</Text>
                    <Row>
                        <Button size="compact" label="Known" accessibilityLabel={`Claim ${activeCapability.label} known`}
                            variant="pill" tone="positive" disabled={busy}
                            onPress={() => void commit(client.prepareClaim({ packageId, targetId: entry.targetId, capability: activeCapability.id }, true))} />
                        <Button size="compact" label="Unknown" accessibilityLabel={`Claim ${activeCapability.label} unknown`}
                            variant="pill" tone="negative" disabled={busy}
                            onPress={() => void commit(client.prepareClaim({ packageId, targetId: entry.targetId, capability: activeCapability.id }, false))} />
                        <Button size="compact" label="Withdraw" accessibilityLabel={`Withdraw ${activeCapability.label} claim`}
                            variant="media" disabled={busy || activeProjection?.claim == null}
                            onPress={() => void commit(client.prepareClaim({ packageId, targetId: entry.targetId, capability: activeCapability.id }, null))} />
                    </Row>
                    <Text tone="media" muted variant="caption">
                        Assessed: {activeProjection?.assessed == null ? 'unmeasured' : String(activeProjection.assessed)} · Prediction: {activeProjection?.prediction == null ? 'unavailable' : String(activeProjection.prediction)}
                    </Text>
                    {error && retry?.key.capability === activeCapability.id ? <>
                        <Text tone="media" accessibilityRole="alert">{error}</Text>
                        <Button size="compact" label="Retry claim" disabled={busy} onPress={() => void commit(retry)} />
                    </> : null}
                </View> : null}
                <View style={styles.pills}>
                    {entry.capabilities.map((cap, capIndex) => {
                        const projection = knowledge.find(p => p.key.packageId === packageId && p.key.targetId === entry.targetId && p.key.capability === cap.id);
                        const status = projection?.status.replaceAll('_', ' ') ?? 'untracked';
                        return <Button key={cap.id} size="compact" variant="pill"
                            tone={projection?.claim === true ? 'positive' : projection?.claim === false ? 'negative' : 'neutral'}
                            label={`${projection?.claim === true ? '✓' : projection?.claim === false ? '×' : '○'} ${cap.label}`}
                            accessibilityLabel={capIndex === 0 ? 'Knowledge' : `Adjust ${cap.label} knowledge`}
                            accessibilityValue={{ text: `${cap.label} · ${status}` }}
                            accessibilityState={{ expanded: expandedCapability === cap.id }}
                            disabled={busy}
                            onPress={() => setExpandedCapability(value => value === cap.id ? null : cap.id)} />;
                    })}
                </View>
            </> : null}>
            {entry ? <>
                <Text selectable variant="inspectionBody" tone="media">{entry.summary ?? entry.definition}</Text>
                {entry.reading ? <View style={styles.metadata}>
                    <Badge label={entry.reading} variant="reading" selectable />
                </View> : null}
                {inspection.targets.length > 1 ? <>
                <Button size="compact" label={`Dictionary alternatives (${inspection.targets.length - 1})`} variant="media"
                    accessibilityState={{ expanded: showAlternatives }} onPress={() => setShowAlternatives(v => !v)} />
                {showAlternatives ? <View style={styles.alternatives}>
                    <Button size="compact" label="‹" accessibilityLabel="Previous sense" variant="media"
                        disabled={index === 0 || busy} onPress={() => setIndex(i => i - 1)} />
                    <Text tone="media" variant="caption">Entry {index + 1} of {inspection.targets.length}</Text>
                    <Button size="compact" label="›" accessibilityLabel="Next sense" variant="media"
                        disabled={index + 1 >= inspection.targets.length || busy} onPress={() => setIndex(i => i + 1)} />
                </View> : null}
                {showAlternatives ? <Text tone="media" muted variant="caption">Dictionary alternatives · not context-ranked</Text> : null}
                </> : null}
                {entry.senses ? <View style={styles.dictionary}>
                    {entry.senses.map((sense, senseIndex) => <View key={senseIndex} style={styles.sense}>
                        {sense.heading ? <View style={styles.metadata}>
                            <Badge label={sense.heading} />
                        </View> : null}
                        {sense.definitions.map((definition, definitionIndex) => (
                            <View key={definitionIndex} style={styles.definitionRow}>
                                <Text variant="inspectionBody" tone="media">•</Text>
                                <View style={styles.definitionText}><Text selectable variant="inspectionBody" tone="media">{definition}</Text></View>
                            </View>
                        ))}
                        {sense.notes.map((note, noteIndex) => <Text key={noteIndex} tone="media" muted variant="caption" selectable>{note}</Text>)}
                    </View>)}
                </View> : entry.partOfSpeech ? <View style={styles.metadata}>
                        <Badge label={entry.partOfSpeech} />
                    </View> : null}
                    {inspection.sourceForm !== entry.headword ? (
                        <Text tone="media" muted variant="caption" selectable>In text: {inspection.sourceForm}</Text>
                    ) : null}
                    <View style={styles.metadata}>
                        <Button size="compact" label="Dictionary source" variant="media"
                            accessibilityState={{ expanded: showSource }} onPress={() => setShowSource(v => !v)} />
                    </View>
                    {showSource ? <>
                        <Text tone="media" muted variant="caption" selectable>{entry.attribution}</Text>
                        {entry.senses?.map((sense, senseIndex) => <Text key={senseIndex} tone="media" muted variant="caption" selectable>{sense.labels.join(' · ')}</Text>)}
                    </> : null}
            </> : !error ? <Text tone="media">Loading entry…</Text> : null}
            {error && !retry ? <>
                <Text tone="media" accessibilityRole="alert">{error}</Text>
                <Button size="compact" label="Retry lookup" disabled={busy}
                    onPress={() => setLookupVersion(v => v + 1)} />
            </> : null}
        </ContextPanel>
    );
}
const styles = StyleSheet.create(theme => ({
    dictionary: {
        borderTopWidth: 1, borderTopColor: theme.media.border, paddingTop: theme.spacing.compact, gap: theme.spacing.small
    }, sense: {
        gap: theme.spacing.small
    }, definitionRow: {
        flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.small, paddingLeft: theme.spacing.compact
    }, definitionText: {
        flex: 1, minWidth: 0
    },
    metadata: {
        flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.small
    }, alternatives: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small
    }, pills: {
        flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.small
    }, adjustment: {
        gap: theme.spacing.small, paddingBottom: theme.spacing.compact, marginBottom: theme.spacing.compact,
        borderBottomWidth: 1, borderBottomColor: theme.media.border
    }
}));
