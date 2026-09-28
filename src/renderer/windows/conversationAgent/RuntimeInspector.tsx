import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { RuntimeTraceEntry, RuntimeTraceList } from '../../../shared/runtimeInspection';
import { WORLD_CONTINUITY_ID, threadContextId, type JournalEvent, type WorldSnapshot } from '../../../shared/world';
import { Button, Disclosure, EmptyState, HintText, Input, ListRow, Select, TabContainer, Tag } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import './RuntimeInspector.css';

const json = (value: unknown): string => JSON.stringify(value, null, 2) ?? 'null';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Read-only developer view of captured calls and their authoritative stores.
 * Never recompiles a historical prompt from today's world state. */
export function RuntimeInspector(props: { initialRoomId?: string }) {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const bridge = getBridge();
  const label = (key: string) => t(`mlearn.ConversationAgent.Developer.${key}`);
  const [tab, setTab] = createSignal('calls');
  const [traceList, setTraceList] = createSignal<RuntimeTraceList | null>(null);
  const [traceId, setTraceId] = createSignal('');
  const [trace, setTrace] = createSignal<RuntimeTraceEntry | null>(null);
  const [world, setWorld] = createSignal<WorldSnapshot | null>(null);
  const [roomId, setRoomId] = createSignal(props.initialRoomId ?? '');
  const [threadId, setThreadId] = createSignal('');
  const [events, setEvents] = createSignal<JournalEvent[]>([]);
  const [query, setQuery] = createSignal('');
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [revision, setRevision] = createSignal(0);
  let disposed = false, frame: number | undefined, listVersion = 0, worldVersion = 0, refreshWorld = false;
  const fail = (key: string, error?: unknown): void => { setErrors(previous => ({ ...previous, [key]: error === undefined ? '' : String(error instanceof Error ? error.message : error) })); };
  const rooms = () => world()?.rooms ?? [];
  const threads = createMemo(() => (world()?.threads ?? []).filter(thread => !roomId() || threadContextId(thread) === roomId()));
  const matches = (value: unknown) => !query().trim() || json(value).toLocaleLowerCase().includes(query().trim().toLocaleLowerCase());
  const visibleTraces = createMemo(() => (traceList()?.entries ?? []).filter(item => (!roomId() || item.context.roomId === roomId() || item.context.threadId === roomId()) && matches(item)));
  createEffect(() => {
    const entries = visibleTraces();
    const selectedId = untrack(traceId);
    if (!entries.some(entry => entry.id === selectedId)) setTraceId(entries[0]?.id ?? '');
  });
  const visibleEvents = createMemo(() => events().filter(event => (tab() !== 'memories' || event.type === 'memory.belief' || event.type === 'resolution' || event.type === 'disclosure' || event.type === 'consolidation') && matches(event)).slice().reverse());
  const scopedRuns = () => {
    const w = world();
    if (!w) return null;
    const relevant = (value: unknown): boolean => !roomId() || (isRecord(value) && (value.roomId === roomId() || value.contextId === roomId() || value.threadId === roomId()));
    return { reflectionRuns: w.reflectionRuns?.filter(relevant) ?? [], autonomyJobs: w.autonomyJobs?.filter(relevant) ?? [],
      contacts: w.contacts?.filter(relevant) ?? [], scenarioCreations: w.scenarioCreations?.filter(relevant) ?? [], integrations: w.integrations?.filter(relevant) ?? [] };
  };

  const refresh = async (includeWorld = true): Promise<void> => {
    if (!settings.devMode || disposed) return;
    const listRequest = ++listVersion, worldRequest = includeWorld ? ++worldVersion : worldVersion;
    await Promise.all([
      bridge.diagnostics.getRuntimeTraces().then(value => {
        if (disposed || listRequest !== listVersion || !settings.devMode) return;
        setTraceList(value); fail('calls');

      }).catch(error => { if (!disposed && listRequest === listVersion) fail('calls', error); }),
      includeWorld ? bridge.diagnostics.getRuntimeWorld().then(value => {
        if (disposed || worldRequest !== worldVersion || !settings.devMode) return;
        setWorld(value); fail('world');
      }).catch(error => { if (!disposed && worldRequest === worldVersion) fail('world', error); }) : Promise.resolve(),
    ]);
  };
  const scheduleRefresh = (includeWorld = false): void => {
    refreshWorld ||= includeWorld;
    if (frame !== undefined || disposed) return;
    frame = requestAnimationFrame(() => { frame = undefined; const includeWorld = refreshWorld; refreshWorld = false; if (includeWorld) setRevision(value => value + 1); void refresh(includeWorld); });
  };
  onMount(() => {
    const offTraces = bridge.diagnostics.onRuntimeTraceChanged(() => scheduleRefresh(false));
    const offWorld = bridge.world.onChanged(() => scheduleRefresh(true));
    void refresh();
    onCleanup(() => { disposed = true; offTraces(); offWorld(); if (frame !== undefined) cancelAnimationFrame(frame); });
  });
  createEffect(() => {
    if (settings.devMode) return;
    batch(() => { setTraceList(null); setTrace(null); setWorld(null); setEvents([]); });
  });
  createEffect(() => {
    const id = traceId(); traceList()?.revision;
    if (!settings.devMode || !id) { setTrace(null); return; }
    let cancelled = false;
    // Keep the selected turn visible as chunks arrive, but never show another
    // turn's output while the new selection is loading.
    if (untrack(trace)?.id !== id) setTrace(null);
    void bridge.diagnostics.getRuntimeTrace(id).then(value => { if (!cancelled && settings.devMode) { setTrace(value); fail('detail'); } })
      .catch(error => { if (!cancelled) fail('detail', error); });
    onCleanup(() => { cancelled = true; });
  });
  createEffect(() => {
    const contextId = roomId(), selectedThread = threadId(), currentTab = tab(); revision();
    if (!settings.devMode || !contextId || (currentTab !== 'sea' && currentTab !== 'memories')) { setEvents([]); return; }
    let cancelled = false;
    const read = selectedThread ? bridge.journal.readThread(contextId, selectedThread) : bridge.journal.readSeaProjection(contextId);
    void read.then(value => { if (!cancelled && settings.devMode) { setEvents(value); fail('events'); } })
      .catch(error => { if (!cancelled) { setEvents([]); fail('events', error); } });
    onCleanup(() => { cancelled = true; });
  });
  const copy = async (value: unknown): Promise<void> => {
    try { await bridge.files.writeToClipboard(typeof value === 'string' ? value : json(value)); fail('copy'); }
    catch (error) { fail('copy', error); }
  };
  const clear = async (): Promise<void> => {
    try { await bridge.diagnostics.clearRuntimeTraces(); setTraceId(''); await refresh(); fail('clear'); }
    catch (error) { fail('clear', error); }
  };
  const chooseContext = (value: string): void => {
    batch(() => { setRoomId(value); setThreadId((world()?.threads ?? []).find(thread => thread.sandbox && thread.id === value)?.id ?? ''); setEvents([]); });
  };
  return <Show when={settings.devMode} fallback={<HintText>{label('Disabled')}</HintText>}>
    <section class="runtime-inspector" aria-label={label('Title')}>
      <div class="runtime-inspector-toolbar">
        <Select aria-label={label('Context')} value={roomId()} onChange={event => chooseContext(event.currentTarget.value)} options={[
          { value: '', label: label('AllContexts') }, { value: WORLD_CONTINUITY_ID, label: label('WorldContinuity') }, ...rooms().map(room => ({ value: room.id, label: room.title })),
          ...(world()?.threads ?? []).filter(thread => thread.sandbox).map(thread => ({ value: thread.id, label: thread.title || thread.id })),
        ]} />
        <Input type="search" size="sm" disabled={tab() === 'runs' || tab() === 'world'} value={query()} onInput={event => setQuery(event.currentTarget.value)} placeholder={label('Search')} aria-label={label('Search')} />
        <Button size="sm" variant="ghost" onClick={() => { setRevision(value => value + 1); void refresh(); }}>{label('Refresh')}</Button>
      </div>
      <Show when={Object.values(errors()).some(Boolean)}><p class="runtime-inspector-error" role="alert">{Object.values(errors()).filter(Boolean).join(' · ')}</p></Show>
      <TabContainer idBase="runtime-inspector" activeTab={tab()} onTabChange={value => { setTab(value); setQuery(''); }} variant="underline" size="sm"
        tabs={[{ id: 'calls', label: label('Calls') }, { id: 'runs', label: label('Runs') }, { id: 'memories', label: label('Memories') }, { id: 'sea', label: label('Journal') }, { id: 'world', label: label('World') }]}>
        <div class="runtime-inspector-panel" role="tabpanel" id={`runtime-inspector-panel-${tab()}`} aria-labelledby={`runtime-inspector-tab-${tab()}`}>
          <Show when={tab() === 'calls'}>
            <div class="runtime-inspector-capture-note"><HintText>{label('CaptureNotice')}</HintText><Button variant="ghost" size="sm" onClick={() => void clear()}>{label('Clear')}</Button></div>
            <Show when={traceList()?.available !== false} fallback={<EmptyState title={label('Unavailable')} />}>
              <div class="runtime-inspector-split">
                <div class="runtime-inspector-call-list">
                  <For each={visibleTraces()}>{entry => <ListRow selected={entry.id === traceId()} headline={entry.context.source}
                    description={`${entry.kind} · ${entry.provider ?? ''} ${entry.model ?? entry.tier ?? ''} · ${new Date(entry.startedAt).toLocaleTimeString()}`}
                    trailing={<Tag size="sm">{entry.status}</Tag>} onClick={() => setTraceId(entry.id)} />}</For>
                  <Show when={visibleTraces().length === 0}><HintText>{label('NoCalls')}</HintText></Show>
                </div>
                <div class="runtime-inspector-detail">
                  <Show when={trace()} fallback={<HintText>{label('SelectCall')}</HintText>}>{selected => <>
                    <div class="runtime-inspector-detail-heading"><strong>{selected().context.source}</strong><Tag>{selected().status}</Tag><Button variant="ghost" size="sm" onClick={() => void copy(selected())}>{label('Copy')}</Button></div>
                    <Disclosure title={label('Context')}><pre class="runtime-inspector-meta">{json({ id: selected().id, ...selected().context, provider: selected().provider, model: selected().model, tier: selected().tier, startedAt: selected().startedAt, providerStartedAt: selected().providerStartedAt, firstTokenAt: selected().firstTokenAt, timeToFirstTokenMs: selected().timeToFirstTokenMs, finishedAt: selected().finishedAt })}</pre></Disclosure>
                    <Show when={selected().truncated}><HintText>{label('Truncated')}</HintText></Show>
                    <Disclosure open title={label('Request')}><pre>{json(selected().input)}</pre><Button variant="ghost" size="sm" onClick={() => void copy(selected().input)}>{label('Copy')}</Button></Disclosure>
                    <Disclosure open title={label('Response')}><Show when={selected().output.content !== undefined}><pre class="runtime-inspector-output">{selected().output.content}</pre></Show><pre>{json(Object.fromEntries(Object.entries(selected().output).filter(([key]) => key !== 'content')))}</pre></Disclosure>
                  </>}</Show>
                </div>
              </div>
            </Show>
          </Show>
          <Show when={tab() === 'runs'}><HintText>{label('RunsNotice')}</HintText>
            <For each={Object.entries(scopedRuns() ?? {})}>{([key, value]) => <Disclosure open title={`${key} (${value.length})`}><pre>{json(value)}</pre><Button size="sm" variant="ghost" onClick={() => void copy(value)}>{label('Copy')}</Button></Disclosure>}</For>
          </Show>
          <Show when={tab() === 'world'}><HintText>{label('WorldNotice')}</HintText><Button size="sm" variant="ghost" onClick={() => void copy(world())}>{label('Copy')}</Button><pre>{json(world())}</pre></Show>
          <Show when={tab() === 'sea' || tab() === 'memories'}>
            <HintText>{label('JournalNotice')}</HintText>
            <Show when={roomId()} fallback={<EmptyState title={label('ChooseContext')} />}>
              <Select aria-label={label('Scope')} value={threadId()} onChange={event => { setThreadId(event.currentTarget.value); setEvents([]); }} options={[
                { value: '', label: 'Sea' }, ...threads().map(thread => ({ value: thread.id, label: thread.title || thread.id })),
              ]} />
              <Show when={visibleEvents().length === 0}><EmptyState title={label('NoEvents')} /></Show>
              <For each={visibleEvents()}>{event => <Disclosure title={`${event.seq} · ${event.type} · ${event.actorId} · ${new Date(event.createdAt).toLocaleString()}`}>
                <pre>{json(event)}</pre><Button size="sm" variant="ghost" onClick={() => void copy(event)}>{label('Copy')}</Button>
              </Disclosure>}</For>
            </Show>
          </Show>
        </div>
      </TabContainer>
    </section>
  </Show>;
}
