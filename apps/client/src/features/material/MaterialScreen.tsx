import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, View, type Text as NativeText } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { CollectionFilter, CollectionItemId, CollectionQuery, CollectionResult, CollectionSort, Material, MaterialContent, PluginSummary } from '@mlearn/contracts';
import { AppShell, Panel, Row } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { Select } from '@mlearn/ui/select';
import { Badge } from '@mlearn/ui/badge';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { MaterialEditor } from './MaterialEditor';
import { MaterialProposalReview } from './MaterialProposalReview';
import { emptyMaterial } from './content';
import { CollectionFilters, CollectionSelectionControls, useCollectionSelection } from '../collection';

const orders = [
  { value: 'default', label: 'Default order' },
  { value: 'label_ascending', label: 'Text A–Z' },
  { value: 'label_descending', label: 'Text Z–A' },
  { value: 'due_ascending', label: 'Due first' },
  { value: 'due_descending', label: 'Due last' },
] as const;

function focus(target: View | NativeText | null | undefined) {
  if (Platform.OS === 'web') target?.focus();
  else {
    const tag = findNodeHandle(target ?? null);
    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  }
}

export function MaterialScreen() {
  const { theme } = useUnistyles();
  const [gridWidth, setGridWidth] = useState(0);
  const columns = Math.max(1, Math.floor((gridWidth + theme.spacing.medium) / (280 + theme.spacing.medium)));
  const cardWidth = gridWidth ? (gridWidth - (columns - 1) * theme.spacing.medium) / columns : undefined;
  const host = useRuntime();
  const router = useRouter();
  const params = useLocalSearchParams<{ sourceId?: string; id?: string }>();
  const sourceId = typeof params.sourceId === 'string' ? params.sourceId : null;
  const [sourceOnly, setSourceOnly] = useState(!!sourceId);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [after, setAfter] = useState<string | null>(null);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [result, setResult] = useState<CollectionResult | null>(null);
  const [sort, setSort] = useState<CollectionSort>('default');
  const [collectionPackageId, setCollectionPackageId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CollectionFilter>({ kind: 'all', filters: [] });
  const page = result?.state === 'ready' ? result.page : null;
  const [packages, setPackages] = useState<PluginSummary[]>([]);
  const [packageId, setPackageId] = useState('');
  const [editor, setEditor] = useState<{ key: string; content: MaterialContent; material?: Material; trigger: string | null } | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState<{ id: string; pending: boolean; error: string; trigger: string | null } | null>(null);
  const [returning, setReturning] = useState<{ material: Material; location: string; pending: boolean; error: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [proposalSeed, setProposalSeed] = useState<Material | null>(null);
  const proposalTrigger = useRef<View>(null);
  const proposalFocus = useRef<View | null>(null);
  const owner = useRef<object | null>(null);
  const openRequest = useRef<object | null>(null);
  const returnRequest = useRef<{ location: string } | null>(null);
  const triggers = useRef(new Map<string, View>());
  const heading = useRef<NativeText>(null);
  const collectionHeading = useRef<NativeText>(null);
  const loadedQuery = useRef('');
  const queryKey = JSON.stringify([after, query, filter, collectionPackageId, sort, sourceId, sourceOnly, includeExcluded]);
  const restore = useRef<string | null>(null);
  const focusedEditor = useRef<string | null>(null);
  const opened = useRef('');
  const collectionQuery = useMemo<CollectionQuery>(() => {
    const filters: CollectionFilter[] = [filter];
    if (query) filters.push({ kind: 'text', text: query });
    if (!includeExcluded) filters.push({ kind: 'material', state: 'not_excluded' });
    if (sourceOnly && sourceId) filters.push({ kind: 'source', sourceId });
    return { packageId: collectionPackageId, surface: 'material', filter: { kind: 'all', filters }, sort, after: null };
  }, [filter, query, includeExcluded, sourceOnly, sourceId, collectionPackageId, sort]);
  const visibleItems = useMemo<CollectionItemId[]>(() => page?.items.flatMap(item => item.kind === 'material'
    ? [{ kind: 'material' as const, id: item.material.id }] : []) ?? [], [page]);
  const selection = useCollectionSelection(host.available ? host.client : null, collectionQuery, visibleItems);
  useFocusEffect(useCallback(() => {
    if (!host.available) return;
    const scope = {}; owner.current = scope;
    return () => {
      if (owner.current === scope) {
        owner.current = null; openRequest.current = null; returnRequest.current = null;
        setOpening(null); setReturning(null);
      }
    };
  }, [host]));
  useLayoutEffect(() => {
    if (editor) {
      if (Platform.OS === 'web') focus(heading.current);
    } else if (restore.current) {
      focus(triggers.current.get(restore.current) ?? collectionHeading.current);
      restore.current = null;
    }
  }, [editor?.key]);
  useFocusEffect(useCallback(() => {
    if (!host.available) return;
    let active = true;
    setPending(true); setError('');
    if (loadedQuery.current !== queryKey) setResult(null);
    void Promise.all([
      host.client.collection({ ...collectionQuery, after }),
      host.client.snapshot(),
    ]).then(([value, snapshot]) => {
      if (!active) return;
      const languages = snapshot.installedPlugins.filter(item => item.capabilities.includes('text.analyze.v1'));
      setResult(value); setPackages(languages); loadedQuery.current = queryKey;
      setPackageId(previous => languages.some(item => item.id === previous) ? previous : languages[0]?.id || '');
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [host, after, collectionQuery, reload, queryKey]));
  const open = useCallback(async (id: string, trigger: string | null) => {
    if (!host.available || openRequest.current) return;
    const scope = owner.current;
    const request = {}; openRequest.current = request;
    setOpening({ id, trigger, pending: true, error: '' });
    try {
      const material = await host.client.material(id);
      if (scope && owner.current === scope && openRequest.current === request) {
        if (returnRequest.current?.location === 'editor') returnRequest.current = null;
        setReturning(previous => previous?.location === 'editor' ? null : previous);
        opened.current = id;
        setEditor({ key: `${id}:${material.revision}`, material, content: material.content, trigger });
        setOpening(null);
      }
    } catch (cause) {
      if (owner.current === scope && openRequest.current === request)
        setOpening({ id, trigger, pending: false, error: cause instanceof Error ? cause.message : String(cause) });
    } finally { if (openRequest.current === request) openRequest.current = null; }
  }, [host]);
  useFocusEffect(useCallback(() => {
    if (typeof params.id === 'string' && opened.current !== params.id) void open(params.id, null);
  }, [params.id, open]));
  async function returnSource(material: Material, location: string) {
    if (!host.available || returnRequest.current) return;
    const scope = owner.current;
    const request = { location }; returnRequest.current = request;
    setReturning({ material, location, pending: true, error: '' });
    try {
      const result = await host.client.returnMaterialSource(material.id);
      if (scope && owner.current === scope && returnRequest.current === request) {
        setReturning(null);
        if (result.type === 'conversation_material_source') {
          router.push({ pathname: '../messenger', params: {
            id: result.conversation.id, messageId: result.message.id,
            messageSequence: String(result.message.sequence), materialId: material.id,
          } });
        } else {
          router.push({ pathname: result.type === 'material_source' ? '/watch' : '../reader',
            params: { id: result.window.source.id, materialId: material.id } });
        }
      }
    } catch (cause) {
      if (owner.current === scope && returnRequest.current === request)
        setReturning({ material, location, pending: false, error: cause instanceof Error ? cause.message : String(cause) });
    } finally { if (returnRequest.current === request) returnRequest.current = null; }
  }
  function openStatus(id: string) {
    return opening?.id === id ? <>
      {opening.pending ? <Text accessibilityLiveRegion="polite">Opening Material…</Text> : null}
      {opening.error ? <><Text accessibilityRole="alert">{opening.error}</Text>
        <Button label="Retry opening Material" onPress={() => void open(opening.id, opening.trigger)} /></> : null}
    </> : null;
  }
  function returnStatus(location: string) {
    return returning?.location === location ? <>
      {returning.pending ? <Text accessibilityLiveRegion="polite">Returning to source…</Text> : null}
      {returning.error ? <><Text accessibilityRole="alert">{returning.error}</Text>
        <Button label="Retry returning to source" onPress={() => void returnSource(returning.material, location)} /></> : null}
    </> : null;
  }
  return <AppShell contentInset="none" navigation={<>
      <Text ref={collectionHeading} variant="heading" accessibilityRole="header" accessible tabIndex={-1}>Material</Text>
      <Button label="Home" variant="navigation" size="compact" onPress={() => router.navigate('/')} />
      <Button label="Knowledge" variant="navigation" size="compact"
        onPress={() => router.navigate({ pathname: '/knowledge', params: { packageId } })} />
    {host.available ? <>
      <Select label="New Material language" value={packageId} options={packages.map(item => ({ value: item.id, label: item.displayName ?? item.id }))}
        onValueChange={setPackageId} />
      <Button label="Add Material" testID="material-add" ref={node => { if (node) triggers.current.set('add', node); else triggers.current.delete('add'); }}
        disabled={!packageId || !!opening?.pending} onPress={() => {
          if (returnRequest.current?.location === 'editor') returnRequest.current = null;
          setReturning(previous => previous?.location === 'editor' ? null : previous);
          setEditor({ key: `manual:${Date.now()}`, content: emptyMaterial(packageId), trigger: 'add' });
        }} />
      <Button ref={proposalTrigger} label="Review proposals" variant="secondary" onPress={() => {
        proposalFocus.current = proposalTrigger.current;
        setProposalSeed(null); setProposalsOpen(true);
      }} />
    </> : null}
  </>} header={<>
    {host.available ? <Row>
      <View style={styles.search}><TextField label="Search Material" testID="material-search" value={search}
        placeholder="Search Material" onChangeText={setSearch} maxLength={2048} variant="search"
        onSubmitEditing={() => { setAfter(null); setQuery(search); setReload(value => value + 1); }} /></View>
      <Button label="Search Material" testID="material-search-submit" size="compact" variant="secondary" disabled={pending}
        onPress={() => { setAfter(null); setQuery(search); setReload(value => value + 1); }} />
      <Select label="Material order" value={sort} options={orders} size="compact" onValueChange={value => {
        const selected = orders.find(item => item.value === value);
        if (selected) { setAfter(null); setSort(selected.value); }
      }} />
      {page ? <Text variant="caption" muted>{page.items.length} of {page.count} items</Text> : null}
    </Row> : null}
    {host.available ? <Row>
      <Select label="Material collection language" value={collectionPackageId ?? '*'} size="compact"
        options={[{ value: '*', label: 'All languages' }, ...packages.map(item => ({ value: item.id, label: item.displayName ?? item.id }))]}
        onValueChange={value => {
          setAfter(null); setFilter({ kind: 'all', filters: [] }); setCollectionPackageId(value === '*' ? null : value);
        }} />
      <Button label="Include excluded" variant="secondary" size="compact" accessibilityState={{ selected: includeExcluded }}
        onPress={() => { setAfter(null); setIncludeExcluded(value => !value); }} />
      {sourceId ? <Button label="This source only" variant="secondary" size="compact" accessibilityState={{ selected: sourceOnly }}
        onPress={() => { setAfter(null); setSourceOnly(value => !value); }} /> : null}
    </Row> : null}
    {host.available ? <CollectionFilters key={collectionPackageId ?? '*'} client={host.client} packageId={collectionPackageId}
      sourceId={sourceId} value={filter} onApply={value => { setAfter(null); setFilter(value); }} /> : null}
  </>}>
    {!host.available ? <View style={styles.notice}><Text accessibilityRole="alert">{host.reason}</Text></View> : <>
      <View style={styles.notice}><CollectionSelectionControls state={selection} count={page?.count ?? 0}
        ready={!!page && !pending} surface="material" packages={packages} client={host.client}
        onChanged={() => { setAfter(null); setReload(value => value + 1); }} /></View>
      {opening?.trigger === null ? openStatus(opening.id) : null}
      {editor ? <View style={styles.notice}><Panel>
        <Row><Text ref={heading} variant="section" accessibilityRole="header" accessible tabIndex={-1}
          onLayout={() => {
            if (Platform.OS !== 'web' && focusedEditor.current !== editor.key) {
              focusedEditor.current = editor.key; focus(heading.current);
            }
          }}>{editor.material ? 'Edit Material' : 'Add Material'}</Text>
          <Button label="Close editor" variant="quiet" onPress={() => {
            restore.current = editor.trigger;
            opened.current = '';
            router.setParams({ id: undefined });
            openRequest.current = null; setOpening(null);
            if (returning?.location === 'editor') { returnRequest.current = null; setReturning(null); }
            focusedEditor.current = null; setEditor(null);
          }} /></Row>
        {editor.material?.content.source ? <>
          <Button label="Return to source" busy={returning?.location === 'editor' && returning.pending} disabled={!!returning?.pending}
            onPress={() => { if (editor.material) void returnSource(editor.material, 'editor'); }} />
          {returnStatus('editor')}
        </> : null}
        <MaterialEditor key={editor.key} client={host.client} authoredMedia={host.authoredMedia} initial={editor.content} material={editor.material}
          onPropose={(material, trigger) => {
            proposalFocus.current = trigger;
            setProposalSeed(material); setProposalsOpen(true);
          }}
          onSaved={material => {
            setEditor(previous => previous ? { ...previous, material } : previous);
            setAfter(null);
            setReload(value => value + 1);
          }} />
      </Panel></View> : null}
      <View style={styles.notice}>
        {pending ? <Text accessibilityLiveRegion="polite">Loading Material…</Text> : null}
        {error ? <><Text accessibilityRole="alert">{error}</Text><Button label="Retry Material list"
          onPress={() => { setAfter(null); setReload(value => value + 1); }} /></> : null}
        {result?.state === 'preparing' ? <Text accessibilityLiveRegion="polite">Preparing collection: {result.processed} of {result.total}</Text> : null}
        {result?.state === 'unavailable' ? <Text accessibilityRole="alert">{result.message}</Text> : null}
      </View>
      <View style={styles.gridInset}>
      <View style={styles.grid} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>
        {page?.items.map(item => item.kind === 'material' ? <View key={item.material.id}
          testID={`material-card-${item.material.id}`} style={{ width: cardWidth ?? '100%', minWidth: 0 }}>
        <Panel inset="spacious">
          <View style={styles.copy}>
          {item.material.content.reading ? <Text selectable variant="detail" muted>{item.material.content.reading}</Text> : null}
          <Text selectable variant="entryTitle">{item.material.content.phrase}</Text>
          </View>
          <Text selectable variant="caption" muted>{item.material.content.meaning}</Text>
          {item.material.content.context ? <Text selectable muted>{item.material.content.context}</Text> : null}
          <View style={styles.actions}><Row>{item.material.excluded ? <Badge label="Excluded" variant="label" /> : null}
            {selection.enabled ? <Button label="Select" accessibilityLabel={`Select ${item.material.content.phrase || item.material.id}`}
              variant="secondary" size="compact" disabled={!selection.canToggle}
              accessibilityState={{ selected: selection.selected({ kind: 'material', id: item.material.id }) }}
              onPress={() => selection.toggle({ kind: 'material', id: item.material.id })} /> : null}
            <Button label="Edit" accessibilityLabel={`Edit ${item.material.content.phrase}`} variant="secondary" size="compact" disabled={!!opening?.pending}
              ref={node => { if (node) triggers.current.set(item.material.id, node); else triggers.current.delete(item.material.id); }}
              busy={opening?.id === item.material.id && opening.pending} onPress={() => void open(item.material.id, item.material.id)} />
            {item.material.content.source ? <Button label="Return to source" accessibilityLabel={`Return to source: ${item.material.content.phrase}`} size="compact" disabled={!!returning?.pending}
              busy={returning?.location === item.material.id && returning.pending}
              variant="quiet" onPress={() => void returnSource(item.material, item.material.id)} /> : null}</Row></View>
          {opening?.trigger === item.material.id ? openStatus(item.material.id) : null}
          {returnStatus(item.material.id)}
        </Panel></View> : null)}
      </View>
      </View>
      <View style={styles.notice}>
        {!pending && page?.items.length === 0 ? <Text>No Material matches this query.</Text> : null}
        <Row><Button label="First Material page" variant="secondary" disabled={pending || after === null} onPress={() => setAfter(null)} />
          <Button label="Next Material page" variant="secondary" disabled={pending || page?.next == null} onPress={() => setAfter(page?.next ?? null)} /></Row>
        <Button label="Refresh Material" variant="quiet" disabled={pending}
          onPress={() => { setAfter(null); setReload(value => value + 1); }} />
      </View>
      <MaterialProposalReview client={host.client} open={proposalsOpen} onOpenChange={setProposalsOpen}
        seed={proposalSeed} focusTarget={() => proposalFocus.current ?? proposalTrigger.current}
        onOpenMaterial={id => void open(id, null)}
        onChanged={() => { setAfter(null); setReload(value => value + 1); }} />
    </>}
  </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  search: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0 },
  notice: { paddingHorizontal: theme.spacing.large, gap: theme.spacing.small },
  gridInset: { padding: theme.spacing.large },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.medium, alignItems: 'flex-start' },
  copy: { gap: 0 },
  actions: { paddingTop: theme.spacing.medium, alignItems: 'flex-end' },
}));
