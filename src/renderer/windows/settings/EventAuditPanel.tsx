/**
 * Event Audit — developer/debug panel for the conversational runtime.
 *
 * Renders a room's journal events with full provenance and answers "why did X
 * say this" by re-deriving the exact compiler context for that turn: events up
 * to the message's seq are fed through compileContext for the actor, and every
 * CompiledContext section is rendered verbatim (display-only formatting).
 *
 * Debug tooling: literal English strings, no locale keys, no polish.
 */

import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { getBridge } from '../../../shared/bridges';
import { compileContext, visibleEventsFor, type CompiledContext } from '../../../shared/contextCompiler';
import type { JournalEvent, Participant, WorldSnapshot } from '../../../shared/world';
import './EventAuditPanel.css';

const PAYLOAD_PREVIEW_LIMIT = 120;

function payloadPreview(e: JournalEvent): string {
  try {
    return JSON.stringify(e.payload);
  } catch {
    return String(e.payload);
  }
}

function scopeLabel(e: JournalEvent): string {
  return e.scope.kind === 'thread' ? `thread:${e.scope.threadId}` : 'sea';
}

function CompiledContextView(props: { context: CompiledContext }) {
  const c = () => props.context;
  return (
    <div class="event-audit-compiled">
      <div class="event-audit-section">
        <div class="event-audit-section-title">persona</div>
        <div class="event-audit-section-body">
          <div>{c().persona.text}</div>
          <div>facets: {JSON.stringify(c().persona.facets)}</div>
        </div>
      </div>
      <Show when={c().canonBaseline}>
        {(baseline) => (
          <div class="event-audit-section">
            <div class="event-audit-section-title">canonBaseline</div>
            <div class="event-audit-section-body">
              <div>coordinate: {JSON.stringify(baseline().coordinate)}</div>
              <div>lore: {baseline().lore}</div>
              <div>context: {baseline().context}</div>
              <div>quotes: {baseline().quotes.join(' | ')}</div>
            </div>
          </div>
        )}
      </Show>
      <div class="event-audit-section">
        <div class="event-audit-section-title">negativeKnowledge</div>
        <div class="event-audit-section-body">
          <For each={c().negativeKnowledge}>{(nk) => <div>- {nk}</div>}</For>
          <Show when={c().negativeKnowledge.length === 0}>
            <div>(none)</div>
          </Show>
        </div>
      </div>
      <div class="event-audit-section">
        <div class="event-audit-section-title">relationships</div>
        <div class="event-audit-section-body">
          <For each={c().relationships}>{(r) => <div>{r.toId} -&gt; {r.label}</div>}</For>
          <Show when={c().relationships.length === 0}>
            <div>(none)</div>
          </Show>
        </div>
      </div>
      <div class="event-audit-section">
        <div class="event-audit-section-title">memories</div>
        <div class="event-audit-section-body">
          <For each={c().memories}>
            {(m) => (
              <div>
                [{m.kind}] {m.text} @ {new Date(m.createdAt).toISOString()}
              </div>
            )}
          </For>
          <Show when={c().memories.length === 0}>
            <div>(none)</div>
          </Show>
        </div>
      </div>
      <div class="event-audit-section">
        <div class="event-audit-section-title">openLoops</div>
        <div class="event-audit-section-body">
          <For each={c().openLoops}>
            {(l) => (
              <div>
                {l.text} @ {new Date(l.createdAt).toISOString()}
              </div>
            )}
          </For>
          <Show when={c().openLoops.length === 0}>
            <div>(none)</div>
          </Show>
        </div>
      </div>
      <Show when={c().learnerProjection}>
        {(lp) => (
          <div class="event-audit-section">
            <div class="event-audit-section-title">learnerProjection</div>
            <div class="event-audit-section-body">{JSON.stringify(lp())}</div>
          </div>
        )}
      </Show>
      <div class="event-audit-section">
        <div class="event-audit-section-title">recentThreadEvents</div>
        <div class="event-audit-section-body">
          <For each={c().recentThreadEvents}>
            {(t) => (
              <div>
                seq {t.seq} {t.type} {t.actorId}
                {t.text ? `: ${t.text}` : ''}
              </div>
            )}
          </For>
          <Show when={c().recentThreadEvents.length === 0}>
            <div>(none)</div>
          </Show>
        </div>
      </div>
      <div class="event-audit-section">
        <div class="event-audit-section-title">callerProjection</div>
        <div class="event-audit-section-body">
          <div>beliefs: {c().callerProjection.beliefs.length}</div>
          <div>openLoops: {c().callerProjection.openLoops.length}</div>
          <div>episodes: {c().callerProjection.episodes.length}</div>
          <div>relationships: {c().callerProjection.relationships.length}</div>
          <div>roomCulture: {c().callerProjection.roomCulture.length}</div>
        </div>
      </div>
    </div>
  );
}

export function EventAuditPanel() {
  const [world, setWorld] = createSignal<WorldSnapshot | null>(null);
  const [roomId, setRoomId] = createSignal('');
  const [events, setEvents] = createSignal<JournalEvent[]>([]);
  const [expandedPayloads, setExpandedPayloads] = createSignal<ReadonlySet<string>>(new Set());
  const [inspected, setInspected] = createSignal<{ eventId: string; context: CompiledContext } | null>(null);
  const [perspectiveId, setPerspectiveId] = createSignal<string | null>(null);

  createEffect(() => {
    let cancelled = false;
    getBridge()
      .world.getWorldState()
      .then((w) => {
        if (cancelled) return;
        setWorld(w);
        if (w.rooms.length > 0) setRoomId(w.rooms[0].id);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const id = roomId();
    if (!id) return;
    let cancelled = false;
    getBridge()
      .journal.readSeaProjection(id)
      .then((evts) => {
        if (cancelled) return;
        setEvents(evts);
        setInspected(null);
        setPerspectiveId(null);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const roomParticipants = (): Participant[] => {
    const w = world();
    const id = roomId();
    if (!w || !id) return [];
    const room = w.rooms.find((r) => r.id === id);
    if (!room) return [];
    return room.participantIds
      .map((pid) => w.participants.find((p) => p.id === pid))
      .filter((p): p is Participant => p !== undefined);
  };

  const visibleEvents = (): JournalEvent[] => {
    const evts = events();
    const pid = perspectiveId();
    if (!pid) return evts;
    const participant = world()?.participants.find((p) => p.id === pid);
    return visibleEventsFor(pid, evts, participant?.capabilities);
  };

  const sortedEvents = (): JournalEvent[] => [...visibleEvents()].sort((a, b) => b.seq - a.seq);

  const inspectedContextFor = (eventId: string): CompiledContext | null => {
    const i = inspected();
    return i && i.eventId === eventId ? i.context : null;
  };

  function togglePayload(eventId: string) {
    setExpandedPayloads((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  function inspectEvent(e: JournalEvent) {
    const w = world();
    if (!w) return;
    const participant = w.participants.find((p) => p.id === e.actorId);
    if (!participant) return;
    // v1: sea-only snapshot; thread events for thread-scoped messages are not
    // folded in yet.
    const eventsUpTo = events().filter((x) => x.seq <= e.seq);
    const context = compileContext({
      participant,
      participants: w.participants,
      seaEvents: eventsUpTo,
    });
    setInspected({ eventId: e.id, context });
  }

  return (
    <div class="event-audit-panel">
      <div class="event-audit-header">
        <h2>Event Audit</h2>
        <select
          class="event-audit-room-select"
          value={roomId()}
          onChange={(ev) => setRoomId((ev.target as HTMLSelectElement).value)}
        >
          <For each={world()?.rooms ?? []}>
            {(room) => (
              <option value={room.id}>
                {room.title} ({room.id})
              </option>
            )}
          </For>
        </select>
      </div>

      <div class="event-audit-toolbar">
        <span class="event-audit-label">perspective projection:</span>
        <button
          type="button"
          classList={{ 'event-audit-perspective': true, active: perspectiveId() === null }}
          onClick={() => setPerspectiveId(null)}
        >
          all
        </button>
        <For each={roomParticipants()}>
          {(p) => (
            <button
              type="button"
              classList={{ 'event-audit-perspective': true, active: perspectiveId() === p.id }}
              onClick={() => setPerspectiveId(perspectiveId() === p.id ? null : p.id)}
            >
              {p.displayName} ({p.kind}
              {p.capabilities?.witnessScope ? `, witness:${p.capabilities.witnessScope}` : ''})
            </button>
          )}
        </For>
      </div>

      <div class="event-audit-list">
        <For each={sortedEvents()}>
          {(e) => {
            const preview = payloadPreview(e);
            const shown = expandedPayloads().has(e.id)
              ? preview
              : preview.length > PAYLOAD_PREVIEW_LIMIT
                ? `${preview.slice(0, PAYLOAD_PREVIEW_LIMIT)}...`
                : preview;
            return (
              <div class="event-audit-row" data-event-id={e.id}>
                <div class="event-audit-row-head">
                  <span class="event-audit-type">{e.type}</span>
                  <span class="event-audit-scope">{scopeLabel(e)}</span>
                  <span class="event-audit-actor">{e.actorId}</span>
                  <span class="event-audit-seq">seq {e.seq}</span>
                  <span class="event-audit-time">{new Date(e.createdAt).toISOString()}</span>
                  <Show when={e.type === 'message.character'}>
                    <button type="button" class="event-audit-inspect" onClick={() => inspectEvent(e)}>
                      inspect
                    </button>
                  </Show>
                </div>
                <div class="event-audit-witnesses">witnesses: {e.witnesses.join(', ')}</div>
                <div class="event-audit-provenance">
                  <Show when={e.provenance} fallback={<span>provenance: none</span>}>
                    <span>provenance: {JSON.stringify(e.provenance)}</span>
                  </Show>
                </div>
                <button type="button" class="event-audit-payload" onClick={() => togglePayload(e.id)}>
                  {shown}
                </button>
                <Show when={inspectedContextFor(e.id)}>
                  {(ctx) => <CompiledContextView context={ctx()} />}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default EventAuditPanel;