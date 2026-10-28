import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { CollectionDescription, CollectionFilter } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Select } from '@mlearn/ui/select';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';

type Predicate = Exclude<CollectionFilter, { kind: 'all' | 'any' | 'not' }>;
type Draft = { id: number; negated: boolean } & (
  | { kind: 'group'; mode: 'all' | 'any'; children: Draft[] }
  | { kind: 'rule'; predicate: Predicate }
);
type Option = { value: string; label: string };
const states = [
  { value: 'untracked', label: 'Untracked' },
  { value: 'claimed_known', label: 'Claimed known' },
  { value: 'claimed_unknown', label: 'Claimed unknown' },
  { value: 'assessed_known', label: 'Assessed known' },
  { value: 'assessed_unknown', label: 'Assessed unknown' },
] as const;
const materialStates = [
  { value: 'saved', label: 'Saved Material' },
  { value: 'unsaved', label: 'No saved Material' },
  { value: 'excluded', label: 'Excluded' },
  { value: 'not_excluded', label: 'Not excluded' },
] as const;

function expression(node: Draft): CollectionFilter {
  const filter: CollectionFilter = node.kind === 'group'
    ? { kind: node.mode, filters: node.children.map(expression) } : node.predicate;
  return node.negated ? { kind: 'not', filter } : filter;
}
function replace(node: Draft, id: number, next: Draft): Draft {
  if (node.id === id) return next;
  return node.kind === 'group' ? { ...node, children: node.children.map(child => replace(child, id, next)) } : node;
}
function size(filter: CollectionFilter): { nodes: number; depth: number } {
  switch (filter.kind) {
    case 'all': case 'any': {
      const children = filter.filters.map(size);
      return { nodes: 1 + children.reduce((total, child) => total + child.nodes, 0),
        depth: children.length ? 1 + Math.max(...children.map(child => child.depth)) : 0 };
    }
    case 'not': {
      const child = size(filter.filter);
      return { nodes: child.nodes + 1, depth: child.depth + 1 };
    }
    default: return { nodes: 1, depth: 0 };
  }
}

/** Query editor shared by Knowledge and Material; native code owns membership. */
export function CollectionFilters({ client, packageId, value, sourceId, onApply }: {
  readonly client: RuntimeClient;
  readonly packageId: string | null;
  readonly value: CollectionFilter;
  readonly sourceId?: string | null;
  readonly onApply: (filter: CollectionFilter) => void;
}) {
  const sequence = useRef(size(value).nodes);
  function draftFor(filter: CollectionFilter): Draft {
    let nextId = 0;
    function visit(filter: CollectionFilter): Draft {
      const id = nextId++;
      switch (filter.kind) {
        case 'all': case 'any': return { id, negated: false, kind: 'group', mode: filter.kind, children: filter.filters.map(visit) };
        case 'not': {
          const child = visit(filter.filter);
          return { ...child, negated: !child.negated };
        }
        default: return { id, negated: false, kind: 'rule', predicate: filter };
      }
    }
    return visit(filter);
  }
  const [draft, setDraft] = useState(() => draftFor(value));
  const groupActions = useRef(new Map<number, View>());
  const restore = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (restore.current === null) return;
    const target = groupActions.current.get(restore.current);
    if (Platform.OS === 'web') target?.focus();
    else {
      const tag = findNodeHandle(target ?? null);
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    }
    restore.current = null;
  }, [draft]);
  const [expanded, setExpanded] = useState(false);
  const [catalog, setCatalog] = useState<CollectionDescription | null>(null);
  const [sources, setSources] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draftError, setDraftError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoading(true); setError('');
    void Promise.all([
      packageId ? client.describeLanguage(packageId) : Promise.resolve(null),
      client.recentSources(), client.recentDocuments(),
    ]).then(([language, videos, documents]) => {
      if (!active) return;
      setCatalog(language?.catalog ?? null);
      const options = new Map([...videos, ...documents].map(source => [source.id, { value: source.id, label: source.title }]));
      if (sourceId && !options.has(sourceId)) options.set(sourceId, { value: sourceId, label: 'Current source' });
      setSources([...options.values()]);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, packageId, sourceId, expanded, retry]);
  function change(next: Draft) {
    const bounds = size(expression(next));
    // Leave four nodes and one depth level for the screen's search/source scope.
    if (bounds.nodes > 60 || bounds.depth > 7) {
      setDraftError('This filter is too large. Remove a condition or group first.');
      return;
    }
    setDraftError(''); setDraft(next);
  }
  function newPredicate(kind: Predicate['kind']): Predicate | null {
    switch (kind) {
      case 'text': return { kind, text: '' };
      case 'material': return { kind, state: 'saved' };
      case 'scope': return catalog?.scopes[0] ? { kind, id: catalog.scopes[0].id } : null;
      case 'entity_kind': return catalog?.kinds[0] ? { kind, id: catalog.kinds[0].id } : null;
      case 'level': return catalog?.levels[0] ? { kind, scaleId: catalog.levels[0].scaleId, level: catalog.levels[0].level } : null;
      case 'capability': return catalog?.capabilities[0] ? { kind, capability: catalog.capabilities[0].id, states: ['untracked'] } : null;
      case 'source': return sources[0] ? { kind, sourceId: sources[0].value } : null;
    }
  }
  const fields: { value: Predicate['kind']; label: string }[] = [
    { value: 'text', label: 'Text contains' }, { value: 'material', label: 'Material state' },
    ...(catalog?.scopes.length ? [{ value: 'scope' as const, label: 'Package scope' }] : []),
    ...(catalog?.levels.length ? [{ value: 'level' as const, label: 'Level' }] : []),
    ...(catalog?.capabilities.length ? [{ value: 'capability' as const, label: 'Knowledge' }] : []),
    ...(catalog?.kinds.length ? [{ value: 'entity_kind' as const, label: 'Entity kind' }] : []),
    ...(sources.length ? [{ value: 'source' as const, label: 'Saved Material source' }] : []),
  ];
  function render(node: Draft, remove?: () => void): ReactNode {
    const update = (next: Draft) => change(replace(draft, node.id, next));
    const prefix = `${node.kind === 'group' ? 'Group' : 'Condition'} ${node.id + 1}`;
    function predicateControls(predicate: Predicate) {
      const set = (next: Predicate) => update({ ...node, kind: 'rule', predicate: next });
      switch (predicate.kind) {
        case 'text': return <View style={styles.field}><TextField label={`${prefix} text`} value={predicate.text}
          maxLength={2048} onChangeText={text => set({ ...predicate, text })} /></View>;
        case 'material': return <Select label={`${prefix} Material state`} value={predicate.state} options={materialStates} size="compact"
          onValueChange={value => { const choice = materialStates.find(item => item.value === value); if (choice) set({ ...predicate, state: choice.value }); }} />;
        case 'scope': case 'entity_kind': return <Select label={`${prefix} value`} value={predicate.id} size="compact"
          options={(predicate.kind === 'scope' ? catalog?.scopes : catalog?.kinds)?.map(item => ({ value: item.id, label: item.label })) ?? []}
          onValueChange={id => set({ ...predicate, id })} />;
        case 'level': {
          const levels = catalog?.levels ?? [];
          const selected = levels.findIndex(level => level.scaleId === predicate.scaleId && level.level === predicate.level);
          return <Select label={`${prefix} level`} value={String(selected)} size="compact"
            options={levels.map((level, index) => ({ value: String(index), label: level.label }))}
            onValueChange={value => { const level = levels.find((_, index) => String(index) === value);
              if (level) set({ ...predicate, scaleId: level.scaleId, level: level.level }); }} />;
        }
        case 'capability': return <>
          <Select label={`${prefix} capability`} value={predicate.capability} size="compact"
            options={catalog?.capabilities.map(item => ({ value: item.id, label: item.label })) ?? []}
            onValueChange={capability => set({ ...predicate, capability })} />
          <Select label={`${prefix} Knowledge state`} value={predicate.states[0]} options={states} size="compact"
            onValueChange={value => { const state = states.find(item => item.value === value); if (state) set({ ...predicate, states: [state.value] }); }} />
        </>;
        case 'source': return <Select label={`${prefix} source`} value={predicate.sourceId} options={sources} size="compact"
          onValueChange={sourceId => set({ ...predicate, sourceId })} />;
      }
    }
    return <View key={node.id} style={styles.group}>
      <Row>
        {node.kind === 'group' ? <Select label={`${prefix} matching`} value={node.mode} size="compact"
          options={[{ value: 'all', label: 'Match all' }, { value: 'any', label: 'Match any' }]}
          onValueChange={mode => { if (mode === 'all' || mode === 'any') update({ ...node, mode }); }} />
          : <><Select label={`${prefix} type`} value={node.predicate.kind} options={fields} size="compact"
            onValueChange={value => {
              const field = fields.find(field => field.value === value);
              const predicate = field ? newPredicate(field.value) : null;
              if (predicate) update({ ...node, predicate });
            }} />{predicateControls(node.predicate)}</>}
        <Button label="Not" accessibilityLabel={`${prefix} negated`} variant="secondary" size="compact"
          accessibilityState={{ selected: node.negated }} onPress={() => update({ ...node, negated: !node.negated })} />
        {remove ? <Button label="Remove" accessibilityLabel={`Remove ${prefix.toLowerCase()}`} variant="quiet" size="compact" onPress={remove} /> : null}
      </Row>
      {node.kind === 'group' ? <>
        {node.children.map(child => render(child, () => {
          restore.current = node.id;
          update({ ...node, children: node.children.filter(value => value.id !== child.id) });
        }))}
        <Row><Button label="Add condition" accessibilityLabel={`${prefix} add condition`} variant="secondary" size="compact"
          ref={target => { if (target) groupActions.current.set(node.id, target); else groupActions.current.delete(node.id); }}
          onPress={() => update({ ...node, children: [...node.children, { id: sequence.current++, kind: 'rule', negated: false, predicate: { kind: 'text', text: '' } }] })} />
          <Button label="Add group" accessibilityLabel={`${prefix} add group`} variant="quiet" size="compact"
            onPress={() => update({ ...node, children: [...node.children, { id: sequence.current++, kind: 'group', negated: false, mode: 'all', children: [] }] })} /></Row>
      </> : null}
    </View>;
  }
  return <View style={styles.root}>
    <Button label="Filters" variant="quiet" size="compact" accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} />
    {expanded ? <>
      <Text variant="caption" muted>Also matches the current search and source/excluded controls. Source choices are recent saved sources.</Text>
      {loading ? <Text accessibilityLiveRegion="polite">Loading filter options…</Text> : null}
      {error ? <><Text accessibilityRole="alert">{error}</Text><Button label="Retry filter options" variant="secondary"
        onPress={() => setRetry(value => value + 1)} /></> : null}
      {!packageId ? <Text variant="caption" muted>Choose a collection language for package scope, level and Knowledge filters.</Text> : null}
      {render(draft)}
      {draftError ? <Text accessibilityRole="alert">{draftError}</Text> : null}
      <Row><Button label="Apply filters" size="compact" disabled={loading || !!error} onPress={() => onApply(expression(draft))} />
        <Button label="Clear filters" variant="secondary" size="compact" onPress={() => {
          const empty: CollectionFilter = { kind: 'all', filters: [] };
          sequence.current = 1; setDraft(draftFor(empty)); setDraftError(''); onApply(empty);
        }} /></Row>
    </> : null}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  root: { gap: theme.spacing.small, minWidth: 0 },
  group: { gap: theme.spacing.small, paddingLeft: theme.spacing.compact, borderLeftWidth: 1, borderColor: theme.colors.border },
  field: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0 },
}));
