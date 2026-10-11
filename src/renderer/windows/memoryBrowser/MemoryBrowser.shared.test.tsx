// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JournalEvent } from '../../../shared/world';

const bridge = vi.hoisted(() => ({
  world: { getWorldState: vi.fn() },
  kvStore: { kvGet: vi.fn(async () => null), kvSet: vi.fn(async () => undefined) },
  journal: { readSeaProjection: vi.fn(), readThread: vi.fn(async () => []) },
}));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => bridge }));
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
import { MemoryBrowserContent } from './App';

let dispose: (() => void) | undefined;
let container: HTMLDivElement;
afterEach(() => { dispose?.(); container?.remove(); vi.clearAllMocks(); });

describe('shared memory sections', () => {
  it('shows retained user-witnessed beliefs and open loops without leaking character-private records', async () => {
    bridge.world.getWorldState.mockResolvedValue({
      rooms: [{ id: 'room', title: 'Study', participantIds: ['partner'], createdAt: 1 }],
      threads: [],
      participants: [{ id: 'partner', displayName: 'Partner', kind: 'persistent', personaText: '', setupComplete: true }],
    });
    const event = (id: string, kind: string, text: string, witnesses: string[]): JournalEvent => ({
      id, seq: Number(id), roomId: 'room', scope: { kind: 'sea' }, type: 'memory.belief',
      actorId: 'partner', witnesses, payload: { ownerId: 'partner', kind, text }, createdAt: Number(id),
    });
    bridge.journal.readSeaProjection.mockResolvedValue([
      event('1', 'belief', 'The learner likes novels', ['partner', 'user']),
      event('2', 'open-loop', 'Discuss the next chapter', ['partner', 'user']),
      event('3', 'belief', 'Character-private thought', ['partner']),
    ]);
    container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <MemoryBrowserContent launchContext={{ roomId: 'room' }} />, container);
    await vi.waitFor(() => expect(container.querySelectorAll('.memory-browser-tab')).toHaveLength(2));
    expect(container.textContent).toContain('The learner likes novels');
    expect(container.textContent).toContain('Discuss the next chapter');
    expect(container.textContent).not.toContain('Character-private thought');
    expect(container.textContent).not.toContain('mlearn.MemoryBrowser.Empty');
    expect(bridge.journal.readSeaProjection).toHaveBeenCalledExactlyOnceWith('room');
    expect(bridge.journal.readThread).not.toHaveBeenCalled();
  });
});
