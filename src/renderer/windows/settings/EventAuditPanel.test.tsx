// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { RuntimeTraceEntry } from '../../../shared/runtimeInspection';
import type { JournalEvent } from '../../../shared/world';

let settings: typeof DEFAULT_SETTINGS;
let setSettings: (key: 'devMode', value: boolean) => void;
let traceChanged: () => void;
let worldChanged: () => void;
let records: RuntimeTraceEntry[];
let events: JournalEvent[];
const world = { rooms: [{ id: 'room-a', title: 'Room A', participantIds: ['a'], createdAt: 1 }], threads: [], participants: [], reflectionRuns: [{ id: 'reflection-a', roomId: 'room-a', status: 'completed' }], autonomyJobs: [{ id: 'job-a', roomId: 'room-a', status: 'scheduled' }] };
const bridge = {
 diagnostics: { getRuntimeTraces: vi.fn(async () => ({ available: true, enabled: settings.devMode, revision: Math.random(), entries: records.map(({ input: _input, output: _output, ...summary }) => summary) })),
 getRuntimeTrace: vi.fn(async (id: string) => structuredClone(records.find(item => item.id === id) ?? null)), getRuntimeWorld: vi.fn(async () => world),
 onRuntimeTraceChanged: vi.fn((fn: () => void) => { traceChanged = fn; return vi.fn(); }), clearRuntimeTraces: vi.fn(async () => { records = []; }) },
 world: { onChanged: vi.fn((fn: () => void) => { worldChanged = fn; return vi.fn(); }) },
 journal: { readSeaProjection: vi.fn(async () => events), readThread: vi.fn(async () => events) }, files: { writeToClipboard: vi.fn(async (_text: string) => {}) },
};
vi.mock('../../../shared/bridges', () => ({ getBridge: () => bridge }));
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }), useSettings: () => ({ settings }) }));
import { EventAuditPanel } from './EventAuditPanel';
let dispose: (() => void) | undefined;
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(node => node.textContent?.trim() === `mlearn.ConversationAgent.Developer.${name}`)!;
function mount() { const container = document.createElement('div'); document.body.append(container); dispose = render(() => <EventAuditPanel />, container); return container; }
beforeEach(() => {
 vi.clearAllMocks();
 [settings, setSettings] = createStore({ ...DEFAULT_SETTINGS, devMode: true });
 records = [{ id: 'request-a', kind: 'model', context: { source: 'dreamer', roomId: 'room-a' }, provider: 'builtin', model: 'test-model', status: 'running', startedAt: 1, updatedAt: 1, input: { messages: [{ role: 'system', content: 'Exact dispatched instruction' }] }, output: { content: 'First chunk' }, truncated: false }];
 events = [{ id: 'memory-a', seq: 1, roomId: 'room-a', scope: { kind: 'sea' }, type: 'memory.belief', actorId: 'a', witnesses: ['a'], createdAt: 1, payload: { text: 'Actual stored memory', provenance: ['message-a'] } }];
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
describe('the settings inspector reads actual runtime capture, not reconstructed prompts', () => {
 it('does not read runtime data with developer mode off', async () => { setSettings('devMode', false); const el = mount(); await Promise.resolve(); expect(el.textContent).toContain('Developer.Disabled'); expect(bridge.diagnostics.getRuntimeTraces).not.toHaveBeenCalled(); expect(bridge.diagnostics.getRuntimeWorld).not.toHaveBeenCalled(); });
 it('shows the captured request and live model response and copies that capture', async () => {
  const el = mount(); await vi.waitFor(() => expect(el.textContent).toContain('Exact dispatched instruction'));
  expect(el.textContent).toContain('First chunk');
  records[0].output.content += ' followed by another chunk'; traceChanged();
  await vi.waitFor(() => expect(el.textContent).toContain('followed by another chunk'));
  expect(bridge.diagnostics.getRuntimeWorld).toHaveBeenCalledTimes(1);
  button('Copy').click(); await vi.waitFor(() => expect(bridge.files.writeToClipboard).toHaveBeenCalled());
  expect(bridge.files.writeToClipboard.mock.calls[0][0]).toContain('Exact dispatched instruction');
 });
 it('reads memories and refreshes committed journal changes without inventing empty data', async () => {
  const el = mount(); await vi.waitFor(() => expect(bridge.diagnostics.getRuntimeWorld).toHaveBeenCalled());
  const context = el.querySelector('select')!; context.value = 'room-a'; context.dispatchEvent(new Event('change', { bubbles: true }));
  button('Memories').click(); await vi.waitFor(() => expect(el.textContent).toContain('memory.belief'));
  expect(el.textContent).toContain('Actual stored memory'); expect(bridge.journal.readSeaProjection).toHaveBeenCalledWith('room-a');
  events = [...events, { ...events[0], id: 'memory-b', seq: 2, payload: { text: 'Newly committed belief' } }]; worldChanged();
  await vi.waitFor(() => expect(el.textContent).toContain('Newly committed belief'));
 });
 it('exposes persisted Dreamer and scheduled jobs, and clears captured calls', async () => {
  const el = mount(); await vi.waitFor(() => expect(el.textContent).toContain('First chunk')); button('Runs').click();
  expect(el.textContent).toContain('reflection-a'); expect(el.textContent).toContain('job-a');
  button('Calls').click(); button('Clear').click(); await vi.waitFor(() => expect(el.textContent).not.toContain('Exact dispatched instruction'));
  expect(bridge.diagnostics.clearRuntimeTraces).toHaveBeenCalledOnce();
 });
 it('removes already visible sensitive data immediately when developer mode is disabled', async () => {
  const el = mount(); await vi.waitFor(() => expect(el.textContent).toContain('Exact dispatched instruction'));
  setSettings('devMode', false); expect(el.textContent).not.toContain('Exact dispatched instruction'); expect(el.textContent).toContain('Developer.Disabled');
 });
});
