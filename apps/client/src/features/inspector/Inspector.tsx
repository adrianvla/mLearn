import { useState, useEffect } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ContextPanel } from '@mlearn/ui/context-panel';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import { Text } from '@mlearn/ui/text';
import { Row, Stack } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import type { LexicalEntry, KnowledgeProjection, ClaimChange } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
export type Inspection = {
    sourceForm: string;
    context: string;
    targets: string[];
    anchor: TextAnchor;
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
    const [showKnowledge, setShowKnowledge] = useState(false);
    const [showDefinition, setShowDefinition] = useState(false);
    useEffect(() => {
        let active = true;
        setError('');
        setEntry(null);
        setShowDefinition(false);
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
    return (
        <ContextPanel title={entry?.headword ?? inspection.sourceForm} anchor={inspection.anchor} onClose={onClose}
            footer={entry ? (
                <View style={styles.pills}>
                    {entry.capabilities.map((cap, capIndex) => {
                        const projection = knowledge.find(p => p.key.packageId === packageId && p.key.targetId === entry.targetId && p.key.capability === cap.id);
                        const status = projection?.status.replaceAll('_', ' ') ?? 'untracked';
                        return <Button key={cap.id} size="compact" variant="media"
                            label={`${cap.label} · ${status}`}
                            accessibilityLabel={capIndex === 0 ? 'Knowledge' : `Adjust ${cap.label} knowledge`}
                            accessibilityValue={{ text: `${cap.label} · ${status}` }}
                            accessibilityState={{ expanded: showKnowledge }}
                            onPress={() => setShowKnowledge(v => !v)} />;
                    })}
                </View>
            ) : null}>
            {entry ? <>
                <Text tone="media" selectable numberOfLines={showDefinition ? undefined : 2}>{entry.definition}</Text>
                {entry.reading ? <Text tone="media" selectable>{entry.reading}</Text> : null}
                <View style={styles.metadata}>
                    <Text tone="media" muted variant="caption">
                        {inspection.sourceForm !== entry.headword ? `${inspection.sourceForm} · ` : ''}{entry.partOfSpeech}
                    </Text>
                    <Button size="compact" label={showDefinition ? 'Less' : 'Full definition'} variant="media"
                        accessibilityState={{ expanded: showDefinition }} onPress={() => setShowDefinition(v => !v)} />
                </View>
                {inspection.targets.length > 1 ? <>
                <View style={styles.alternatives}>
                    <Button size="compact" label="‹" accessibilityLabel="Previous sense" variant="media"
                        disabled={index === 0 || busy} onPress={() => setIndex(i => i - 1)} />
                    <Text tone="media" variant="caption">Sense {index + 1} of {inspection.targets.length}</Text>
                    <Button size="compact" label="›" accessibilityLabel="Next sense" variant="media"
                        disabled={index + 1 >= inspection.targets.length || busy} onPress={() => setIndex(i => i + 1)} />
                </View>
                <Text tone="media" muted variant="caption">Dictionary alternatives · not context-ranked</Text>
                </> : null}
                <Text tone="media" muted variant="caption" selectable>{entry.attribution}</Text>
                {showKnowledge ? entry.capabilities.map(cap => {
                    const projection = knowledge.find(p => p.key.packageId === packageId && p.key.targetId === entry.targetId && p.key.capability === cap.id);
                    return (
                        <Stack key={cap.id}>
                            <Text tone="media">{cap.label} · {projection?.status.replaceAll('_', ' ') ?? 'untracked'}</Text>
                            <Row>
                                <Button size="compact" label="Known" accessibilityLabel={`Claim ${cap.label} known`}
                                    variant="media" disabled={busy}
                                    onPress={() => void commit(client.prepareClaim({ packageId, targetId: entry.targetId, capability: cap.id }, true))} />
                                <Button size="compact" label="Unknown" accessibilityLabel={`Claim ${cap.label} unknown`}
                                    variant="media" disabled={busy}
                                    onPress={() => void commit(client.prepareClaim({ packageId, targetId: entry.targetId, capability: cap.id }, false))} />
                                <Button size="compact" label="Withdraw" accessibilityLabel={`Withdraw ${cap.label} claim`}
                                    variant="media" disabled={busy || projection?.claim == null}
                                    onPress={() => void commit(client.prepareClaim({ packageId, targetId: entry.targetId, capability: cap.id }, null))} />
                            </Row>
                            <Text tone="media" muted variant="caption">
                                Assessed: {projection?.assessed == null ? 'unmeasured' : String(projection.assessed)} · Prediction: {projection?.prediction == null ? 'unavailable' : String(projection.prediction)}
                            </Text>
                        </Stack>
                    );
                }) : null}
            </> : !error ? <Text tone="media">Loading entry…</Text> : null}
            {error ? <>
                <Text tone="media" accessibilityRole="alert">{error}</Text>
                <Button size="compact" label={retry ? 'Retry claim' : 'Retry lookup'} disabled={busy}
                    onPress={() => retry ? void commit(retry) : setLookupVersion(v => v + 1)} />
            </> : null}
        </ContextPanel>
    );
}
const styles = StyleSheet.create(theme => ({
    metadata: {
        flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.small
    }, alternatives: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small
    }, pills: {
        flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.small
    }
}));
