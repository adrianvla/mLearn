import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, View, useWindowDimensions, type Text as NativeText } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import type { CollectionFilter, CollectionItemId, CollectionPreparationCommand, CollectionPreparationStatus, CollectionQuery, CollectionResult, CollectionSort, LanguageDescription, PluginSummary } from '@mlearn/contracts';
import { AppShell, Row } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { Select } from '@mlearn/ui/select';
import { TextField } from '@mlearn/ui/text-field';
import { Badge } from '@mlearn/ui/badge';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { Inspector, type Inspection } from '../inspector';
import { LinguisticWord } from '../linguistic';
import { CollectionFilters, CollectionSelectionControls, useCollectionSelection } from '../collection';

export function KnowledgeScreen() {
  const host = useRuntime();
  const router = useRouter();
  const params = useLocalSearchParams<{ packageId?: string }>();
  const compact = useWindowDimensions().width < 700;
  const [packages, setPackages] = useState<PluginSummary[]>([]);
  const [packageId, setPackageId] = useState(typeof params.packageId === 'string' ? params.packageId : '');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CollectionSort>('default');
  const [entityKind, setEntityKind] = useState('');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [filter, setFilter] = useState<CollectionFilter>({ kind: 'all', filters: [] });
  const [after, setAfter] = useState<string | null>(null);
  const [result, setResult] = useState<CollectionResult | null>(null);
  const [described, setDescribed] = useState<{ packageId: string; value: LanguageDescription } | null>(null);
  const description = described?.packageId === packageId ? described.value : null;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [preparation, setPreparation] = useState<CollectionPreparationStatus | null>(null);
  const preparing = useRef<CollectionPreparationCommand | null>(null);
  const owner = useRef<object | null>(null);
  const heading = useRef<NativeText>(null);
  const inspectionChanged = useRef(false);
  const loadedQuery = useRef('');
  const queryKey = JSON.stringify([packageId, query, filter, entityKind, sort, after]);
  const collectionQuery = useMemo<CollectionQuery>(() => ({
    packageId, surface: 'knowledge', filter: { kind: 'all', filters: [
      { kind: 'text', text: query }, filter,
      ...(entityKind ? [{ kind: 'entity_kind' as const, id: entityKind }] : []),
    ] }, sort, after: null,
  }), [packageId, query, filter, entityKind, sort]);
  const currentResult = loadedQuery.current === queryKey ? result : null;
  const page = currentResult?.state === 'ready' ? currentResult.page : null;
  const visibleItems = useMemo<CollectionItemId[]>(() => page?.items.flatMap(item => item.kind === 'target'
    ? [{ kind: 'target' as const, targetId: item.target.summary.targetId }] : []) ?? [], [page]);
  const selection = useCollectionSelection(host.available ? host.client : null, collectionQuery, visibleItems);
  useFocusEffect(useCallback(() => {
    if (!host.available) return;
    const scope = {};
    owner.current = scope;
    void Promise.all([host.client.snapshot(), host.client.currentCollectionPreparation()]).then(([snapshot, status]) => {
      if (owner.current !== scope) return;
      const languages = snapshot.installedPlugins.filter(item => item.capabilities.includes('text.analyze.v1'));
      setPackages(languages);
      // An explicit unavailable scope stays selected until the user replaces it.
      setPackageId(previous => previous || languages[0]?.id || '');
      setPreparation(status);
    }).catch((cause: unknown) => {
      if (owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { if (owner.current === scope) owner.current = null; };
  }, [host]));
  useFocusEffect(useCallback(() => {
    if (!host.available || !packageId) return;
    let active = true;
    void host.client.describeLanguage(packageId).then(value => {
      if (active) setDescribed({ packageId, value });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [host, packageId, reload]));
  useFocusEffect(useCallback(() => {
    if (!host.available || !packageId) return;
    let active = true;
    setPending(true); setError('');
    // Refreshing an unchanged page must preserve the Inspector's real trigger
    // and focus anchor. A different query must never display the old rows.
    if (loadedQuery.current !== queryKey) {
      loadedQuery.current = queryKey; setResult(null);
    }
    void host.client.collection({ ...collectionQuery, after }).then(value => {
      if (active) setResult(value);
    })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [host, packageId, collectionQuery, after, queryKey, reload]));
  useEffect(() => { setInspection(null); }, [packageId, query, filter, entityKind, sort, after]);
  async function prepare() {
    if (!host.available || preparing.current || !packageId) return;
    const scope = owner.current;
    const command = host.client.prepareCollection(packageId);
    preparing.current = command;
    setPreparation({ command, phase: 'preparing', processed: 0, total: null, message: null });
    setError('');
    try {
      const status = await host.client.prepareCollectionCatalog(command);
      if (scope && owner.current === scope) {
        setPreparation(status);
        setAfter(null); setReload(value => value + 1);
      }
    } catch (cause) {
      if (scope && owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (preparing.current === command) preparing.current = null; }
  }
  async function preparationControl(cancel: boolean) {
    if (!host.available || !preparation) return;
    const scope = owner.current;
    const command = preparation.command;
    try {
      const status = cancel ? await host.client.cancelCollectionPreparation(command.commandId)
        : await host.client.collectionPreparationStatus(command.commandId);
      if (scope && owner.current === scope) {
        setPreparation(status);
        if (status?.phase === 'succeeded') { setAfter(null); setReload(value => value + 1); }
      }
    } catch (cause) {
      if (scope && owner.current === scope) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const capabilityLabel = description?.capabilities.find(item => item.id === description.annotationCapability)?.label;
  const activePreparation = preparation?.phase === 'preparing' || preparation?.phase === 'cancelling';
  return <AppShell contentInset="none" header={<>
    <Row><Button label="Home" variant="quiet" size="compact" onPress={() => router.navigate('/')} />
      <Text ref={heading} variant="heading" accessibilityRole="header" accessible tabIndex={-1}>Knowledge</Text>
      <Button label="Material" variant="quiet" size="compact" onPress={() => router.navigate('/materials')} /></Row>
    <Row><Select label="Knowledge language" value={packageId}
      options={packages.map(item => ({ value: item.id, label: item.displayName ?? item.id }))}
      onValueChange={value => { setAfter(null); setFilter({ kind: 'all', filters: [] }); setEntityKind(''); setPackageId(value); }} />
      <Select label="Knowledge order" value={sort} options={[
        { value: 'default', label: 'Package order' },
        { value: 'label_ascending', label: 'Entry A–Z' },
        { value: 'label_descending', label: 'Entry Z–A' },
        { value: 'due_ascending', label: 'Due first' },
        { value: 'due_descending', label: 'Due last' },
      ]} onValueChange={value => {
        const option = ['default', 'label_ascending', 'label_descending', 'due_ascending', 'due_descending'] as const;
        const selected = option.find(item => item === value);
        if (selected) { setAfter(null); setSort(selected); }
      }} /></Row>
    <Row>
      {description?.catalog?.kinds.length ? <Select label="Knowledge entity kind" value={entityKind}
        options={[{ value: '', label: 'All entry kinds' }, ...description.catalog.kinds.map(kind => ({ value: kind.id, label: kind.label }))]}
        onValueChange={value => { setAfter(null); setEntityKind(value); }} /> : null}
      <Select label="Knowledge layout" value={layout} options={[
        { value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' },
      ]} onValueChange={value => { if (value === 'list' || value === 'grid') setLayout(value); }} />
    </Row>
    <Row><View style={styles.search}><TextField label="Search Knowledge" variant="search" placeholder="Search Knowledge" value={search} onChangeText={setSearch}
      onSubmitEditing={() => { setAfter(null); setQuery(search); }} /></View>
      <Button label="Search" icon="search" size="compact" variant="secondary"
        disabled={pending} onPress={() => { setAfter(null); setQuery(search); }} /></Row>
    {host.available && packageId ? <CollectionFilters key={packageId} client={host.client} packageId={packageId}
      value={filter} onApply={value => { setAfter(null); setFilter(value); }} /> : null}
  </>}>
    {!host.available ? <View style={styles.notice}><Text accessibilityRole="alert">{host.reason}</Text></View> : <>
      <View style={styles.results} accessibilityLiveRegion="polite">
        <View style={styles.notice}><CollectionSelectionControls state={selection} count={page?.count ?? 0}
          ready={!!page && !pending} surface="knowledge" packages={packages} client={host.client}
          onChanged={() => { setAfter(null); setReload(value => value + 1); }} /></View>
        {pending ? <View style={styles.notice}><Text>Loading Knowledge…</Text></View> : null}
        {error ? <View style={styles.notice}><Text accessibilityRole="alert">{error}</Text>
          <Button label="Retry Knowledge" variant="secondary" onPress={() => setReload(value => value + 1)} /></View> : null}
        {currentResult?.state === 'unavailable' ? <View style={styles.notice}>
          <Text>{currentResult.message}</Text>
          {description?.catalog ? <Button label="Prepare Knowledge collection" disabled={activePreparation || !packageId}
            onPress={() => void prepare()} /> : null}
        </View> : null}
        {currentResult?.state === 'preparing' ? <View style={styles.notice}>
          <Text>Collection preparation required · {currentResult.processed} of {currentResult.total}</Text>
          <Button label="Prepare Knowledge collection" disabled={activePreparation || !packageId} onPress={() => void prepare()} />
        </View> : null}
        {preparation?.command.packageId === packageId && !page ? <View style={styles.notice}>
          <Text>{preparation.phase} · {preparation.processed}{preparation.total === null ? '' : ` of ${preparation.total}`}</Text>
          {preparation.message ? <Text accessibilityRole="alert">{preparation.message}</Text> : null}
          {activePreparation ? <Row>
            <Button label="Refresh preparation status" variant="secondary" onPress={() => void preparationControl(false)} />
            <Button label="Cancel preparation" variant="quiet" onPress={() => void preparationControl(true)} />
          </Row> : null}
        </View> : null}
        {page ? <>
          <View style={styles.notice}><Text variant="caption">{page.count} entries</Text></View>
          {!compact && layout === 'list' ? <View style={styles.columns}>
            <View style={styles.word(false)}><Text variant="caption">Entry</Text></View>
            <View style={styles.meaning(false)}><Text variant="caption">Meaning</Text></View>
            <View style={styles.level(false)}><Text variant="caption">Level</Text></View>
            <View style={styles.knowledge(false)}><Text variant="caption">Knowledge{capabilityLabel ? ` · ${capabilityLabel}` : ''}</Text></View>
          </View> : null}
          <View style={layout === 'grid' ? styles.grid : undefined}>
          {page.items.map(item => {
            if (item.kind !== 'target') return null;
            const target = item.target;
            const projection = item.knowledge.find(value => target.capabilities.includes(value.key.capability)
              && value.key.capability === description?.annotationCapability);
            return <View key={target.summary.targetId} testID={`knowledge-target-${target.summary.targetId}`}
              style={layout === 'grid' ? styles.gridEntry : styles.entry(compact)}>
              <View style={styles.word(compact || layout === 'grid')}><LinguisticWord text={target.summary.headword} presentation={target.summary.presentation}
                activation={{ status: projection?.status ?? 'unavailable', inspectionMode: 'click', onActivate: anchor => {
                  inspectionChanged.current = false;
                  setInspection({
                  sourceForm: target.summary.headword, context: '', targets: [target.summary.targetId],
                  anchor: { ...anchor, restoreFocus: () => {
                    if (!inspectionChanged.current) { anchor.restoreFocus(); return; }
                    if (Platform.OS === 'web') heading.current?.focus();
                    else {
                      const tag = findNodeHandle(heading.current);
                      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
                    }
                  } }, sourceAnchor: null, packageRevision: page.packageRevision ?? undefined,
                }); } }} />
                {layout === 'list' && target.summary.reading && !target.summary.presentation?.readings.length
                  ? <Text variant="caption" muted>{target.summary.reading}</Text> : null}
              </View>
              {layout === 'list' ? <>
                <View style={styles.meaning(compact)}><Text numberOfLines={compact ? 3 : 2}>{target.summary.summary}</Text></View>
                <View style={styles.level(compact)}><Text variant="caption">{target.levels.map(level => level.level).join(' · ') || '—'}</Text></View>
              </> : null}
              <View style={styles.knowledge(compact || layout === 'grid')}>
                {selection.enabled ? <Button label="Select" accessibilityLabel={`Select ${target.summary.headword}`}
                  variant="secondary" size="compact" disabled={!selection.canToggle}
                  accessibilityState={{ selected: selection.selected({ kind: 'target', targetId: target.summary.targetId }) }}
                  onPress={() => selection.toggle({ kind: 'target', targetId: target.summary.targetId })} /> : null}
                {layout === 'list' ? <>
                  {compact && capabilityLabel ? <Text variant="caption" muted>{capabilityLabel}</Text> : null}
                  <Badge label={projection?.status.replaceAll('_', ' ') ?? 'Knowledge unavailable'} />
                </> : null}
              </View>
            </View>;
          })}
          </View>
          {!page.items.length ? <View style={styles.notice}><Text>No entries match this query.</Text></View> : null}
          <View style={styles.notice}><Row>
            <Button label="First Knowledge page" size="compact" variant="secondary" disabled={pending || after === null} onPress={() => setAfter(null)} />
            <Button label="Next Knowledge page" size="compact" variant="secondary" disabled={pending || page.next === null} onPress={() => setAfter(page.next)} />
            <Button label="Refresh Knowledge" size="compact" variant="quiet" disabled={pending} onPress={() => setReload(value => value + 1)} />
          </Row></View>
        </> : null}
      </View>
      {inspection ? <Inspector inspection={inspection} packageId={packageId} client={host.client}
        onClose={() => {
          setInspection(null);
          // A claim can invalidate any cursor or change the sorted membership.
          // Keep the active Inspector intact, then reload at a real focus target.
          if (inspectionChanged.current) { setAfter(null); setReload(value => value + 1); }
        }} onChanged={async () => { inspectionChanged.current = true; }} /> : null}
    </>}
  </AppShell>;
}

const styles = StyleSheet.create(theme => ({
  search: { flexGrow: 1, flexShrink: 1, minWidth: 0, flexBasis: 220 },
  results: { gap: 0 },
  // The collection page remains the only data window and AppShell owns scrolling.
  // Shared inline controls retain activation, Knowledge color and focus semantics.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.tiny,
    paddingHorizontal: theme.spacing.medium, paddingVertical: theme.spacing.small },
  gridEntry: { width: 96, maxWidth: '100%', minWidth: 0, padding: theme.spacing.small,
    gap: theme.spacing.tiny, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius, backgroundColor: theme.colors.background },
  notice: { paddingHorizontal: theme.spacing.medium, paddingVertical: theme.spacing.compact, gap: theme.spacing.small },
  columns: { flexDirection: 'row', paddingHorizontal: theme.spacing.medium, paddingVertical: theme.spacing.compact,
    gap: theme.spacing.compact, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderColor: theme.colors.border },
  entry: (compact: boolean) => ({ flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center',
    gap: compact ? theme.spacing.tiny : theme.spacing.compact, paddingHorizontal: theme.spacing.medium,
    paddingVertical: theme.spacing.compact, borderBottomWidth: 1, borderColor: theme.colors.border }),
  word: (compact: boolean) => ({ flex: compact ? undefined : 3, minWidth: 0, alignItems: 'flex-start' }),
  meaning: (compact: boolean) => ({ flex: compact ? undefined : 5, minWidth: 0 }),
  level: (compact: boolean) => ({ width: compact ? undefined : 80, minWidth: 0 }),
  knowledge: (compact: boolean) => ({ flex: compact ? undefined : 2.5, minWidth: 0, alignItems: 'flex-start' }),
}));
