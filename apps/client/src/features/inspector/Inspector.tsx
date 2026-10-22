import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { ContextPanel } from '@mlearn/ui/context-panel';
import type { TextAnchor } from '@mlearn/ui/inline-word';
import { Text } from '@mlearn/ui/text';
import { Row } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import { Badge } from '@mlearn/ui/badge';
import { Dialog } from '@mlearn/ui/dialog';
import { useRouter } from 'expo-router';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import type { ClaimChange, LexicalSense, SourceAnchor } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Pronunciation } from '../linguistic';
import { CaptureList, MaterialEditor, emptyMaterial } from '../material';
export type Inspection = {
    sourceForm: string;
    context: string;
    targets: string[];
    anchor: TextAnchor;
    sourceAnchor: SourceAnchor;
    packageRevision?: string;
    initialTargetId?: string;
    showContext?: boolean;
    onChanged?: () => Promise<void>;
};
export function Inspector({ inspection, packageId, client, onChanged, onClose }: {
    inspection: Inspection;
    packageId: string;
    client: RuntimeClient;
    onChanged: () => Promise<void>;
    onClose: () => void;
}) {
    const router = useRouter();
    const host = useRuntime();
    const [selectedSense, setSelectedSense] = useState<LexicalSense | null>(null);
    const [captureOpen, setCaptureOpen] = useState(false);
    const [captureRefresh, setCaptureRefresh] = useState(0);
    const [index, setIndex] = useState(() => Math.max(0, inspection.targets.indexOf(inspection.initialTargetId ?? '')));
    const [result, setResult] = useState<Awaited<ReturnType<RuntimeClient['inspectTarget']>> | null>(null);
    const entry = result?.entry ?? null;
    const knowledge = result?.knowledge.projections ?? [];
    const scope = useRef<object | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [retry, setRetry] = useState<ClaimChange | null>(null);
    const [lookupVersion, setLookupVersion] = useState(0);
    const [expandedCapability, setExpandedCapability] = useState<string | null>(null);
    const [showSource, setShowSource] = useState(false);
    const [showAlternatives, setShowAlternatives] = useState(false);
    const [showPronunciation, setShowPronunciation] = useState(false);
    useLayoutEffect(() => {
        if (!entry || process.env.EXPO_PUBLIC_MLEARN_METRICS !== '1') return;
        const frame = requestAnimationFrame(() => {
            console.info(`annotation-ui phase=inspect_commit timestamp_ms=${Date.now()}`);
        });
        return () => cancelAnimationFrame(frame);
    }, [entry]);
    useEffect(() => {
        let active = true;
        const owner = {};
        scope.current = owner;
        setError('');
        setResult(null);
        setBusy(false);
        setRetry(null);
        setExpandedCapability(null);
        setShowSource(false);
        setShowPronunciation(false);
        setSelectedSense(null);
        setCaptureOpen(false);
        client.inspectTarget(packageId, inspection.targets[index], inspection.packageRevision ?? null).then(value => {
            if (active)
                setResult(value);
        }).catch(e => {
            if (active)
                setError(String(e.message ?? e));
        });
        return () => { active = false; if (scope.current === owner) scope.current = null; };
    }, [client, packageId, inspection.targets, inspection.packageRevision, inspection.sourceAnchor, index, lookupVersion]);
    async function commit(change: ClaimChange) {
        const owner = scope.current;
        setBusy(true);
        setError('');
        try {
            await client.changeClaim(change);
            if (!owner || scope.current !== owner) return;
            setRetry(null);
            await onChanged();
            if (scope.current !== owner) return;
            const refreshed = await client.inspectTarget(packageId, change.key.targetId, inspection.packageRevision ?? null);
            if (scope.current === owner) setResult(refreshed);
        }
        catch (e) {
            if (owner && scope.current === owner) {
                setError(e instanceof Error ? e.message : String(e));
                setRetry(change);
            }
        }
        finally {
            if (owner && scope.current === owner) setBusy(false);
        }
    }
    const activeCapability = entry?.capabilities.find(cap => cap.id === expandedCapability);
    const materialContent = entry && result ? {
        ...emptyMaterial(packageId), targetId: entry.targetId, packageRevision: result.packageRevision,
        sense: selectedSense, phrase: inspection.sourceForm, reading: entry.reading ?? '',
        meaning: selectedSense?.definitions.join('; ') ?? entry.summary ?? entry.definition,
        context: inspection.context, source: inspection.sourceAnchor,
    } : null;
    const activeProjection = knowledge.find(projection =>
        projection.key.packageId === packageId && projection.key.targetId === entry?.targetId
        && projection.key.capability === expandedCapability);
    const claim = result ? ({
        unavailable: { label: 'Knowledge unavailable', tone: 'neutral', icon: 'circle' },
        untracked: { label: 'Untracked', tone: 'neutral', icon: 'circle' },
        claimed_known: { label: 'Known', tone: 'positive', icon: 'checkCircle' },
        claimed_unknown: { label: 'Unknown', tone: 'negative', icon: 'closeCircle' },
        mixed: { label: 'Mixed', tone: 'neutral', icon: 'circle' },
    } as const)[result.knowledge.claim] : null;
    return (
        <ContextPanel title={entry?.headword ?? inspection.sourceForm} anchor={inspection.anchor} onClose={onClose} sourceContext={inspection.context} alwaysShowContext={inspection.showContext}
            popover={entry && activeCapability ? <View style={styles.adjustment}>
                    <View style={styles.pills}>
                        {entry.capabilities.map(cap => <Button key={cap.id} size="compact" variant="media"
                            label={cap.label} disabled={busy}
                            accessibilityState={{ selected: expandedCapability === cap.id }}
                            onPress={() => setExpandedCapability(cap.id)} />)}
                    </View>
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
            footer={entry && claim ? <Button size="compact" variant="pill"
                label={claim.label}
                tone={claim.tone}
                icon={claim.icon}
                accessibilityLabel="Knowledge"
                accessibilityValue={{ text: claim.label }}
                accessibilityState={{ expanded: expandedCapability !== null }}
                disabled={busy || result?.knowledge.claim === 'unavailable'}
                onPress={() => setExpandedCapability(value => value ? null : entry.capabilities[0]?.id ?? null)} /> : null}>
            {entry ? <>
                <Text selectable variant="inspectionBody" tone="media">{entry.summary ?? entry.definition}</Text>
                <Row>
                <Pronunciation presentation={entry.presentation} reading={entry.reading} expanded={showPronunciation} />
                {entry.presentation ? <Button label="Pronunciation details" icon="info" iconOnly size="compact" variant="media"
                    accessibilityState={{ expanded: showPronunciation }}
                    onPress={() => setShowPronunciation(value => !value)} /> : null}
                </Row>
                {inspection.targets.length > 1 ? <>
                <Button size="compact" label={`Dictionary alternatives (${inspection.targets.length - 1})`} variant="disclosure"
                    icon={showAlternatives ? 'chevronDown' : 'chevronRight'}
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
                        <Button label={`Select sense ${senseIndex + 1} for capture`} variant="media" size="compact"
                            accessibilityState={{ selected: selectedSense === sense }}
                            onPress={() => setSelectedSense(sense)} />
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
                    {materialContent ? <>
                        <CaptureList key={JSON.stringify([inspection.sourceAnchor, entry.targetId, selectedSense])}
                            client={client} candidates={[{ key: entry.targetId, content: materialContent }]} refreshKey={captureRefresh}
                            onOpenMaterial={id => router.push({ pathname: '../materials', params: { id, sourceId: inspection.sourceAnchor.sourceId } })} />
                        <Dialog open={captureOpen} onOpenChange={setCaptureOpen} title="Capture Material"
                            description="Author this Material without changing its source reference or selected dictionary sense."
                            trigger={<Button label="Edit before capture" size="compact" variant="media" />}>
                            <MaterialEditor key={JSON.stringify([inspection.sourceAnchor, entry.targetId, selectedSense])} client={client} authoredMedia={host.available ? host.authoredMedia : null} initial={materialContent}
                                onSaved={() => setCaptureRefresh(value => value + 1)} />
                        </Dialog>
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
        gap: 0
    }, definitionRow: {
        flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.small, marginLeft: -theme.spacing.medium
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
        gap: theme.spacing.small
    }
}));
