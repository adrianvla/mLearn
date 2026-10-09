import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import type { RuntimeTraceEntry, RuntimeTraceList } from '../../../shared/runtimeInspection';
import { WORLD_CONTINUITY_ID, threadContextId, type JournalEvent, type WorldSnapshot } from '../../../shared/world';
import { Button, Disclosure, EmptyState, HintText, Input, ListRow, Select, SkeletonRows, TabContainer, Tag } from '../../components/common';
import { useLocalization, useSettings } from '../../context';
import { formatClockTime, formatDateTime } from '../../utils/timeFormatting';
import './RuntimeInspector.css';

const json = (value: unknown): string => JSON.stringify(value, null, 2) ?? 'null';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Read-only developer view of captured calls and their authoritative stores.
 * Never recompiles a historical prompt from today's world state. */
export function RuntimeInspector(props: { initialRoomId?: string }) {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const bridge = getBridge();
  const label = (key: string, params?: Record<string, string | number>) => t(`mlearn.ConversationAgent.Developer.${key}`, params);
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
  const [eventsLoading, setEventsLoading] = createSignal(false);
  const [eventsScope, setEventsScope] = createSignal('');
  const [callsLoading, setCallsLoading] = createSignal(true);
  const [worldLoading, setWorldLoading] = createSignal(true);
  const [detailLoading, setDetailLoading] = createSignal(false);
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
  const requestSummary = (entry: RuntimeTraceEntry): string => label(entry.kind === 'model' ? 'ModelRequestSummary' : 'ToolRequestSummary');
  const responseSummary = (entry: RuntimeTraceEntry): string => typeof entry.output.content === 'string'
    ? label('ResponseCharacters', { count: Array.from(entry.output.content).length })
    : entry.output.error !== undefined ? label('ResponseErrorCaptured') : label('ResponseCaptured');
  const worldSummary = (): string => {
    const current = world();
    return label('WorldSummary', { rooms: current?.rooms.length ?? 0, threads: current?.threads.length ?? 0,
      participants: current?.participants.length ?? 0 });
  };

  const refresh = async (includeWorld = true): Promise<void> => {
    if (!settings.devMode || disposed) return;
    const listRequest = ++listVersion, worldRequest = includeWorld ? ++worldVersion : worldVersion;
    setCallsLoading(true);
    if (includeWorld) setWorldLoading(true);
    await Promise.all([
      bridge.diagnostics.getRuntimeTraces().then(value => {
        if (disposed || listRequest !== listVersion || !settings.devMode) return;
        setTraceList(value); setCallsLoading(false); fail('calls');

      }).catch(error => { if (!disposed && listRequest === listVersion) { setCallsLoading(false); fail('calls', error); } }),
      includeWorld ? bridge.diagnostics.getRuntimeWorld().then(value => {
        if (disposed || worldRequest !== worldVersion || !settings.devMode) return;
        setWorld(value); setWorldLoading(false); fail('world');
      }).catch(error => { if (!disposed && worldRequest === worldVersion) { setWorldLoading(false); fail('world', error); } }) : Promise.resolve(),
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
    if (!settings.devMode || !id) { setTrace(null); setDetailLoading(false); return; }
    let cancelled = false;
    // Keep the selected turn visible as chunks arrive, but never show another
    // turn's output while the new selection is loading.
    setDetailLoading(true); fail('detail');
    if (untrack(trace)?.id !== id) setTrace(null);
    void bridge.diagnostics.getRuntimeTrace(id).then(value => { if (!cancelled && settings.devMode) { setTrace(value); setDetailLoading(false); fail('detail'); } })
      .catch(error => { if (!cancelled) { setDetailLoading(false); fail('detail', error); } });
    onCleanup(() => { cancelled = true; });
  });
  createEffect(() => {
    const contextId = roomId(), selectedThread = threadId(), currentTab = tab(); revision();
    if (!settings.devMode || !contextId || (currentTab !== 'sea' && currentTab !== 'memories')) { setEvents([]); setEventsLoading(false); return; }
    let cancelled = false;
    const scope = JSON.stringify([contextId, selectedThread]);
    if (untrack(eventsScope) !== scope) { setEvents([]); setEventsScope(scope); }
    setEventsLoading(true); fail('events');
    const read = selectedThread ? bridge.journal.readThread(contextId, selectedThread) : bridge.journal.readSeaProjection(contextId);
    void read.then(value => { if (!cancelled && settings.devMode) { setEvents(value); setEventsLoading(false); fail('events'); } })
      .catch(error => { if (!cancelled) { setEventsLoading(false); fail('events', error); } });
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
        <div class="runtime-inspector-status">
          <h2>{label('Title')}</h2>
          <HintText>{label('CaptureNotice')}</HintText>
        </div>
        <div class="runtime-inspector-controls">
        <Select aria-label={label('Context')} value={roomId()} onChange={event => chooseContext(event.currentTarget.value)} options={[
          { value: '', label: label('AllContexts') }, { value: WORLD_CONTINUITY_ID, label: label('WorldContinuity') }, ...rooms().map(room => ({ value: room.id, label: room.title })),
          ...(world()?.threads ?? []).filter(thread => thread.sandbox).map(thread => ({ value: thread.id, label: thread.title || thread.id })),
        ]} />
        <Input type="search" size="sm" disabled={tab() === 'runs' || tab() === 'world'} value={query()} onInput={event => setQuery(event.currentTarget.value)} placeholder={label('Search')} aria-label={label('Search')} />
        <Button size="sm" variant="ghost" onClick={() => { setRevision(value => value + 1); void refresh(); }}>{label('Refresh')}</Button>
        </div>
      </div>
      <Show when={Object.values(errors()).some(Boolean)}><p class="runtime-inspector-error" role="alert">{Object.values(errors()).filter(Boolean).join(' · ')}</p></Show>
      <TabContainer idBase="runtime-inspector" activeTab={tab()} onTabChange={value => { setTab(value); setQuery(''); }} variant="underline" size="sm"
        tabs={[{ id: 'calls', label: label('Calls') }, { id: 'runs', label: label('Runs') }, { id: 'memories', label: label('Memories') }, { id: 'sea', label: label('Journal') }, { id: 'world', label: label('World') }]}>
        <div class="runtime-inspector-panel" role="tabpanel" id={`runtime-inspector-panel-${tab()}`} aria-labelledby={`runtime-inspector-tab-${tab()}`}>
          <Show when={tab() === 'calls'}>
            <div class="runtime-inspector-capture-note"><HintText>{traceList()?.entries.length ?? 0} · {label('Calls')}</HintText><Button variant="ghost" size="sm" onClick={() => void clear()}>{label('Clear')}</Button></div>
            <Show when={traceList()?.available !== false} fallback={<EmptyState title={label('Unavailable')} />}>
              <div class="runtime-inspector-split">
                <div class="runtime-inspector-call-list">
                  <For each={visibleTraces()}>{entry => <ListRow selected={entry.id === traceId()} headline={entry.context.source}
                    description={`${entry.kind} · ${entry.provider ?? ''} ${entry.model ?? entry.tier ?? ''} · ${formatClockTime(entry.startedAt, settings.uiLanguage)}`}
                    trailing={<Tag size="sm">{entry.status}</Tag>} onClick={() => setTraceId(entry.id)} />}</For>
                  <Show when={callsLoading() && !traceList()}><SkeletonRows rows={3} /></Show>
                  <Show when={!callsLoading() && !errors().calls && visibleTraces().length === 0}><HintText>{label('NoCalls')}</HintText></Show>
                </div>
                <div class="runtime-inspector-detail">
                  <Show when={trace()} fallback={<Show when={detailLoading()} fallback={<Show when={!errors().detail}><HintText>{label('SelectCall')}</HintText></Show>}><SkeletonRows rows={3} /></Show>}>{selected => <>
                    <div class="runtime-inspector-detail-heading"><strong>{selected().context.source}</strong><Tag>{selected().status}</Tag><Button variant="ghost" size="sm" onClick={() => void copy(selected())}>{label('Copy')}</Button></div>
                    <Disclosure title={label('Context')}><pre class="runtime-inspector-meta">{json({ id: selected().id, ...selected().context, provider: selected().provider, model: selected().model, tier: selected().tier, startedAt: selected().startedAt, providerStartedAt: selected().providerStartedAt, firstTokenAt: selected().firstTokenAt, timeToFirstTokenMs: selected().timeToFirstTokenMs, finishedAt: selected().finishedAt })}</pre></Disclosure>
                    <Show when={selected().truncated}><HintText>{label('Truncated')}</HintText></Show>
                    <Disclosure title={`${label('Request')} · ${requestSummary(selected())}`}><pre>{json(selected().input)}</pre><Button variant="ghost" size="sm" onClick={() => void copy(selected().input)}>{label('Copy')}</Button></Disclosure>
                    <Disclosure title={`${label('Response')} · ${responseSummary(selected())}`}><Show when={selected().output.content !== undefined}><pre class="runtime-inspector-output">{selected().output.content}</pre></Show><pre>{json(Object.fromEntries(Object.entries(selected().output).filter(([key]) => key !== 'content')))}</pre><Button variant="ghost" size="sm" onClick={() => void copy(selected().output)}>{label('Copy')}</Button></Disclosure>
                  </>}</Show>
                </div>
              </div>
            </Show>
          </Show>
          <Show when={tab() === 'runs'}><HintText>{label('RunsNotice')}</HintText>
            <For each={Object.entries(scopedRuns() ?? {})}>{([key, value]) => <Disclosure title={`${key} · ${label('RecordCount', { count: value.length })}`}>
              <p class="runtime-inspector-summary">{value.length === 0 ? label('NoRuntimeData') : label('RecordCount', { count: value.length })}</p>
              <Disclosure title={label('RawData')}><pre>{json(value)}</pre></Disclosure>
              <Button size="sm" variant="ghost" onClick={() => void copy(value)}>{label('Copy')}</Button>
            </Disclosure>}</For>
          </Show>
          <Show when={tab() === 'world'}><HintText>{label('WorldNotice')}</HintText>
            <Show when={worldLoading() && !world()} fallback={<Show when={world()}><p class="runtime-inspector-summary">{worldSummary()}</p></Show>}><SkeletonRows rows={3} /></Show>
            <Disclosure title={label('RawData')}><pre>{json(world())}</pre></Disclosure>
            <Button size="sm" variant="ghost" onClick={() => void copy(world())}>{label('Copy')}</Button>
          </Show>
          <Show when={tab() === 'sea' || tab() === 'memories'}>
            <HintText>{label('JournalNotice')}</HintText>
            <Show when={roomId()} fallback={<EmptyState title={label('ChooseContext')} />}>
              <Select aria-label={label('Scope')} value={threadId()} onChange={event => { setThreadId(event.currentTarget.value); setEvents([]); }} options={[
                { value: '', label: 'Sea' }, ...threads().map(thread => ({ value: thread.id, label: thread.title || thread.id })),
              ]} />
              <Show when={eventsLoading() && events().length === 0}><SkeletonRows rows={3} /></Show>
              <Show when={!eventsLoading() && !errors().events && visibleEvents().length === 0}><EmptyState title={label('NoEvents')} /></Show>
              <For each={visibleEvents()}>{event => <Disclosure title={`${event.seq} · ${event.type} · ${event.actorId} · ${formatDateTime(event.createdAt, settings.uiLanguage)}`}>
                <pre>{json(event)}</pre><Button size="sm" variant="ghost" onClick={() => void copy(event)}>{label('Copy')}</Button>
              </Disclosure>}</For>
            </Show>
          </Show>
        </div>
      </TabContainer>
    </section>
  </Show>;
}
