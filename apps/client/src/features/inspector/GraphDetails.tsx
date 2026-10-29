import { useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { GraphCursor, GraphPage, GraphProperty, LinguisticEntity, RelationCategory } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';

type Props = {
    readonly client: RuntimeClient;
    readonly packageId: string;
    readonly targetId: string;
    readonly packageRevision: string;
    readonly onInspectTarget: (targetId: string) => void;
};
const categories = {
    identity: 'Identity',
    property: 'Properties',
    alternative: 'Alternatives',
    support: 'Support',
} as const satisfies Record<RelationCategory, string>;

/** Scope changes remount the bounded presentation before old content can be used. */
export function GraphDetails(props: Props) {
    return <GraphDetailsBody key={JSON.stringify([props.packageId, props.targetId, props.packageRevision])} {...props} />;
}

function GraphDetailsBody({ client, packageId, targetId, packageRevision, onInspectTarget }: Props) {
    const [page, setPage] = useState<GraphPage | null>(null);
    const [pending, setPending] = useState(true);
    const [error, setError] = useState('');
    const [unsupported, setUnsupported] = useState(false);
    const [stopped, setStopped] = useState(false);
    const [showSources, setShowSources] = useState(false);
    const operation = useRef<object | null>(null);
    const retry = useRef<GraphCursor | null>(null);
    async function load(after: GraphCursor | null) {
        if (operation.current) return;
        const owner = {};
        operation.current = owner;
        retry.current = after;
        setPending(true); setError(''); setUnsupported(false); setStopped(false);
        try {
            const value = await client.graphNeighborhood({
                packageId, targetId, expectedRevision: packageRevision, after,
            });
            if (operation.current === owner) setPage(value);
        } catch (cause) {
            if (operation.current !== owner) return;
            const message = cause instanceof Error ? cause.message : String(cause);
            setError(message);
            // The current native contract reports capability absence as an operation
            // error, not a separate response variant. Do not infer it from empty data.
            setUnsupported(cause instanceof RuntimeError
                && message === 'Package does not provide related-entity inspection');
        } finally {
            if (operation.current === owner) { operation.current = null; setPending(false); }
        }
    }
    useLayoutEffect(() => {
        setPage(null);
        void load(null);
        return () => { operation.current = null; };
    }, [client, packageId, targetId, packageRevision]);
    return <View style={styles.stack} testID="graph-details">
        <Row>
            <Text tone="media" variant="inspectionBody" accessibilityRole="header">Related entities</Text>
            <Button label="Graph sources" variant="disclosure" size="compact"
                icon={showSources ? 'chevronDown' : 'chevronRight'}
                accessibilityState={{ expanded: showSources }}
                onPress={() => setShowSources(value => !value)} />
        </Row>
        {page ? <>
            <EntityDetails entity={page.entity} page={page} showSources={showSources} />
            <Text tone="media" muted variant="caption">Relations do not transfer Knowledge between targets.</Text>
            {!page.connections.length ? <Text tone="media">No relations on this page.</Text> : null}
            {Object.entries(categories).map(([category, label]) => {
                const connections = page.connections.filter(item => item.relation.category === category);
                return connections.length ? <View key={category} style={styles.stack} testID={`graph-${category}`}>
                    <Text tone="media" variant="inspectionBody" accessibilityRole="header">{label}</Text>
                    {connections.map(({ entity, relation }) => <View key={relation.id}
                        style={styles.relation} testID="graph-relation">
                        <Text tone="media" selectable>{relation.from === page.entity.id
                            ? `${page.entity.label} → ${relation.predicate.label} → ${entity.label}`
                            : `${entity.label} → ${relation.predicate.label} → ${page.entity.label}`}</Text>
                        <EntityDetails entity={entity} page={page} showSources={showSources} />
                        {showSources ? <Properties properties={relation.qualifiers} showSources /> : null}
                        {showSources ? <Text tone="media" muted variant="caption" selectable>
                            Relation: {relation.id}{'\n'}Predicate: {relation.predicate.id}
                            {'\n'}{[...new Set([relation.attribution, relation.predicate.attribution])].join('\n')}
                        </Text> : null}
                        {entity.targetId !== null ? <Button label={`Inspect ${entity.label}`} variant="media"
                            size="compact" accessibilityLabel={`Inspect ${entity.label} target ${entity.targetId}`}
                            onPress={() => {
                                if (entity.targetId !== null) onInspectTarget(entity.targetId);
                            }} /> : <Text tone="media" muted variant="caption">Fact only · no Knowledge target</Text>}
                    </View>)}
                </View> : null;
            })}
        </> : null}
        {pending ? <Text tone="media" accessibilityLiveRegion="polite">Loading related entities…</Text> : null}
        {stopped ? <Text tone="media" accessibilityLiveRegion="polite">Related-entity loading stopped.</Text> : null}
        {unsupported ? <Text tone="media" accessibilityRole="alert">Related-entity inspection is unsupported by this package.</Text>
            : error ? <Text tone="media" accessibilityRole="alert">{error}</Text> : null}
        <Row>
            {pending ? <Button label="Stop loading relations" variant="media" size="compact" onPress={() => {
                // Reject this display receipt only; source cancellation is owned by
                // the host and must not interrupt unrelated Inspector/source work.
                operation.current = null; setPending(false); setStopped(true);
            }} /> : null}
            {error && !unsupported ? <Button label="Retry relations" variant="media" size="compact" disabled={pending}
                onPress={() => void load(retry.current)} /> : null}
            <Button label="Refresh relations" variant="media" size="compact" disabled={pending}
                onPress={() => void load(null)} />
            {page?.next ? <Button label="Next relations" variant="media" size="compact" disabled={pending || !!error}
                onPress={() => void load(page.next)} /> : null}
        </Row>
    </View>;
}

function EntityDetails({ entity, page, showSources }: {
    readonly entity: LinguisticEntity; readonly page: GraphPage; readonly showSources: boolean;
}) {
    return <View style={styles.stack}>
        <Text tone="media" selectable>{entity.label}</Text>
        <Text tone="media" muted variant="caption" selectable>{entity.kind.label}</Text>
        {showSources ? <Text tone="media" muted variant="caption" selectable>
            Entity: {entity.id}{'\n'}Kind: {entity.kind.id}
            {'\n'}{[...new Set([entity.attribution, entity.kind.attribution])].join('\n')}
        </Text> : null}
        <Properties properties={entity.properties} showSources={showSources} />
        {entity.targetId !== null ? entity.capabilities.map(capability => {
            const projection = page.knowledge.find(item => item.key.targetId === entity.targetId
                && item.key.packageId === page.packageId && item.key.capability === capability.id);
            return <Text key={capability.id} tone="media" variant="caption" selectable>
                {capability.label}: {projection?.status.replaceAll('_', ' ') ?? 'unavailable'}
            </Text>;
        }) : null}
    </View>;
}

function Properties({ properties, showSources }: {
    readonly properties: readonly GraphProperty[]; readonly showSources: boolean;
}) {
    // Unknown structured records are losslessly inspectable without turning the
    // ordinary detail list into a JSON dump. Scalar entity facts stay readable.
    return <>{properties.filter(property => showSources || property.value === null
        || typeof property.value !== 'object').map(property => <View key={property.id} style={styles.stack}>
        <Text tone="media" selectable>{property.label}: {typeof property.value === 'string'
            ? property.value : JSON.stringify(property.value)}</Text>
        {showSources ? <Text tone="media" muted variant="caption" selectable>{property.id} · {property.attribution}</Text> : null}
    </View>)}</>;
}

// Inspector's body owns scrolling; wrapping children never create a second viewport.
const styles = StyleSheet.create(theme => ({
    stack: { gap: theme.spacing.small, minWidth: 0, maxWidth: '100%',
        _web: { overflowWrap: 'anywhere' } },
    relation: { gap: theme.spacing.small, minWidth: 0, maxWidth: '100%',
        borderTopWidth: 1, borderTopColor: theme.media.border, paddingTop: theme.spacing.small },
}));
