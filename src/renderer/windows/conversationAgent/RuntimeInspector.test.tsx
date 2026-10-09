// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { JournalEvent } from '../../../shared/world';
const mocks = vi.hoisted(() => ({ readSea: vi.fn(), readThread: vi.fn() }));
vi.mock('../../context', () => ({ useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, devMode: true } }), useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({
  diagnostics: { getRuntimeTraces: async () => ({ available: true, revision: 0, entries: [] }), getRuntimeWorld: async () => ({ rooms: [{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }], threads: [], participants: [] }), onRuntimeTraceChanged: () => () => {} },
  world: { onChanged: () => () => {} }, journal: { readSeaProjection: mocks.readSea, readThread: mocks.readThread },
}) }));
import { RuntimeInspector } from './RuntimeInspector';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
beforeEach(() => { vi.clearAllMocks(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function mount() {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <RuntimeInspector initialRoomId="first" />, host);
  host.querySelector<HTMLButtonElement>('#runtime-inspector-tab-sea')!.click();
  return host;
}
describe('RuntimeInspector authoritative journal states', () => {
  it('shows pending and failed reads without claiming the journal has no events, then retries', async () => {
    let reject!: (error: Error) => void;
    mocks.readSea.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue([]);
    const host = mount(); await flush();
    expect(host.textContent).not.toContain('mlearn.ConversationAgent.Developer.NoEvents');
    expect(host.querySelector('.skeleton-rows')).not.toBeNull();
    reject(new Error('offline')); await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('offline');
    expect(host.textContent).not.toContain('mlearn.ConversationAgent.Developer.NoEvents');
    Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('mlearn.ConversationAgent.Developer.Refresh'))!.click();
    await flush();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('mlearn.ConversationAgent.Developer.NoEvents');
  });
  it('rejects a late journal response from the previous context', async () => {
    let resolveOld!: (events: JournalEvent[]) => void;
    mocks.readSea.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([]);
    const host = mount(); await flush();
    const context = host.querySelector<HTMLSelectElement>('select[aria-label="mlearn.ConversationAgent.Developer.Context"]')!;
    context.value = 'second'; context.dispatchEvent(new Event('change', { bubbles: true })); await flush();
    resolveOld([{ seq: 1, type: 'memory.belief', actorId: 'STALE_ACTOR', createdAt: 1 } as JournalEvent]); await flush();
    expect(host.textContent).not.toContain('STALE_ACTOR');
    expect(mocks.readSea).toHaveBeenLastCalledWith('second');
  });
});
