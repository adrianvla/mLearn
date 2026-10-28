import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, type Text as NativeText, type View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { CollectionFilter, CollectionResult, CollectionSort, Material, MaterialContent, PluginSummary } from '@mlearn/contracts';
import { AppShell, Panel, Row } from '@mlearn/ui/layout';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';
import { Select } from '@mlearn/ui/select';
import { Badge } from '@mlearn/ui/badge';
import { useRuntime } from '../../bootstrap/RuntimeProvider';
import { MaterialEditor } from './MaterialEditor';
import { emptyMaterial } from './content';

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
  const page = result?.state === 'ready' ? result.page : null;
  const [packages, setPackages] = useState<PluginSummary[]>([]);
  const [packageId, setPackageId] = useState('');
  const [editor, setEditor] = useState<{ key: string; content: MaterialContent; material?: Material; trigger: string | null } | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [opening, setOpening] = useState<{ id: string; pending: boolean; error: string; trigger: string | null } | null>(null);
  const [returning, setReturning] = useState<{ material: Material; location: string; pending: boolean; error: string } | null>(null);
  const [reload, setReload] = useState(0);
  const owner = useRef<object | null>(null);
  const openRequest = useRef<object | null>(null);
  const returnRequest = useRef<{ location: string } | null>(null);
  const triggers = useRef(new Map<string, View>());
  const heading = useRef<NativeText>(null);
  const collectionHeading = useRef<NativeText>(null);
  const loadedQuery = useRef('');
  const queryKey = JSON.stringify([after, query, sort, sourceId, sourceOnly, includeExcluded]);
  const restore = useRef<string | null>(null);
  const focusedEditor = useRef<string | null>(null);
  const opened = useRef('');
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
    const filters: CollectionFilter[] = [];
    if (query) filters.push({ kind: 'text', text: query });
    if (!includeExcluded) filters.push({ kind: 'material', state: 'not_excluded' });
    if (sourceOnly && sourceId) filters.push({ kind: 'source', sourceId });
    void Promise.all([
      host.client.collection({ packageId: null, surface: 'material',
        filter: { kind: 'all', filters }, sort, after }),
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
  }, [host, after, query, sort, sourceId, sourceOnly, includeExcluded, reload, queryKey]));
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
  return <AppShell header={<>
    <Row><Button label="Home" variant="quiet" onPress={() => router.replace('/')} />
      <Text ref={collectionHeading} variant="heading" accessibilityRole="header" accessible tabIndex={-1}>Material</Text>
      <Button label="Knowledge" variant="quiet" size="compact"
        onPress={() => router.push({ pathname: '../knowledge', params: { packageId } })} /></Row>
    {host.available ? <Row>
      <Select label="New Material language" value={packageId} options={packages.map(item => ({ value: item.id, label: item.displayName ?? item.id }))}
        onValueChange={setPackageId} />
      <Button label="Add Material" testID="material-add" ref={node => { if (node) triggers.current.set('add', node); else triggers.current.delete('add'); }}
        disabled={!packageId || !!opening?.pending} onPress={() => {
          if (returnRequest.current?.location === 'editor') returnRequest.current = null;
          setReturning(previous => previous?.location === 'editor' ? null : previous);
          setEditor({ key: `manual:${Date.now()}`, content: emptyMaterial(packageId), trigger: 'add' });
        }} />
      <Select label="Material order" value={sort} options={orders} onValueChange={value => {
        const selected = orders.find(item => item.value === value);
        if (selected) { setAfter(null); setSort(selected.value); }
      }} />
    </Row> : null}
  </>}>
    {!host.available ? <Text accessibilityRole="alert">{host.reason}</Text> : <>
      {opening?.trigger === null ? openStatus(opening.id) : null}
      {editor ? <Panel>
        <Row><Text ref={heading} variant="section" accessibilityRole="header" accessible tabIndex={-1}
          onLayout={() => {
            if (Platform.OS !== 'web' && focusedEditor.current !== editor.key) {
              focusedEditor.current = editor.key; focus(heading.current);
            }
          }}>{editor.material ? 'Edit Material' : 'Add Material'}</Text>
          <Button label="Close editor" variant="quiet" onPress={() => {
            restore.current = editor.trigger;
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
          onSaved={material => {
            setEditor(previous => previous ? { ...previous, material } : previous);
            setAfter(null);
            setReload(value => value + 1);
          }} />
      </Panel> : null}
      <Panel>
        <TextField label="Search Material" testID="material-search" value={search} onChangeText={setSearch} maxLength={2048} variant="search" />
        <Row><Button label="Search Material" testID="material-search-submit" disabled={pending} onPress={() => { setAfter(null); setQuery(search); setReload(value => value + 1); }} />
          <Button label="Include excluded" variant="secondary" accessibilityState={{ selected: includeExcluded }}
            onPress={() => { setAfter(null); setIncludeExcluded(value => !value); }} />
          {sourceId ? <Button label="This source only" variant="secondary" accessibilityState={{ selected: sourceOnly }}
            onPress={() => { setAfter(null); setSourceOnly(value => !value); }} /> : null}
        </Row>
        {pending ? <Text accessibilityLiveRegion="polite">Loading Material…</Text> : null}
        {error ? <><Text accessibilityRole="alert">{error}</Text><Button label="Retry Material list"
          onPress={() => { setAfter(null); setReload(value => value + 1); }} /></> : null}
        {result?.state === 'preparing' ? <Text accessibilityLiveRegion="polite">Preparing collection: {result.processed} of {result.total}</Text> : null}
        {result?.state === 'unavailable' ? <Text accessibilityRole="alert">{result.message}</Text> : null}
        {page ? <Text variant="caption" muted>{page.items.length} of {page.count} items</Text> : null}
        {page?.items.map(item => item.kind === 'material' ? <Panel key={item.material.id} inset="compact">
          <Text selectable variant="section">{item.material.content.phrase}</Text>
          <Text selectable>{item.material.content.meaning}</Text>
          {item.material.content.context ? <Text selectable muted>{item.material.content.context}</Text> : null}
          <Row>{item.material.excluded ? <Badge label="Excluded" /> : null}
            <Button label={`Edit ${item.material.content.phrase}`} variant="secondary" disabled={!!opening?.pending}
              ref={node => { if (node) triggers.current.set(item.material.id, node); else triggers.current.delete(item.material.id); }}
              busy={opening?.id === item.material.id && opening.pending} onPress={() => void open(item.material.id, item.material.id)} />
            {item.material.content.source ? <Button label={`Return to source: ${item.material.content.phrase}`} disabled={!!returning?.pending}
              busy={returning?.location === item.material.id && returning.pending}
              variant="quiet" onPress={() => void returnSource(item.material, item.material.id)} /> : null}</Row>
          {opening?.trigger === item.material.id ? openStatus(item.material.id) : null}
          {returnStatus(item.material.id)}
        </Panel> : null)}
        {!pending && page?.items.length === 0 ? <Text>No Material matches this query.</Text> : null}
        <Row><Button label="First Material page" variant="secondary" disabled={pending || after === null} onPress={() => setAfter(null)} />
          <Button label="Next Material page" variant="secondary" disabled={pending || page?.next == null} onPress={() => setAfter(page?.next ?? null)} /></Row>
        <Button label="Refresh Material" variant="quiet" disabled={pending}
          onPress={() => { setAfter(null); setReload(value => value + 1); }} />
      </Panel>
    </>}
  </AppShell>;
}
