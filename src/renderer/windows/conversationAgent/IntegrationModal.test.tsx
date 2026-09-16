// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/types';
import type { IntegrationPreview, Thread } from '../../../shared/world';

const previewIntegration = vi.fn();
const integrateThread = vi.fn();

vi.mock('../../components/common', () => ({
  Btn: (props: { children?: unknown; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children as string}</button>
  ),
  Tag: (props: { children?: unknown }) => <span>{props.children as string}</span>,
  HintText: (props: { children?: unknown }) => <small>{props.children as string}</small>,
  ModalForm: (props: { children?: unknown; footer?: unknown; title?: unknown }) => (
    <div data-testid="modal">{props.title as string}{props.children as string}{props.footer as string}</div>
  ),
}));

// Reactive settings store mirrors SettingsContext so consent flips re-render.
const [settingsStore, setSettingsStore] = createStore<Settings>({ ...DEFAULT_SETTINGS });
const updateSettingsMock = vi.fn((partial: Partial<Settings>) => setSettingsStore(partial));

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string, params?: Record<string, string | number>) => (
    params ? `${key}:${JSON.stringify(params)}` : key
  ) }),
  useSettings: () => ({ settings: settingsStore, updateSettings: updateSettingsMock }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({ world: { previewIntegration, integrateThread } }),
}));

import { IntegrationModal } from './IntegrationModal';

const thread: Thread = {
  id: 'thr_1',
  title: 'Practice',
  state: 'active',
  createdAt: 1,
  sandbox: { operationId: 'op-1', requestHash: 'hash', bindings: [], baselineHeads: {} },
};

const preview = (overrides: Partial<IntegrationPreview> = {}): IntegrationPreview => ({
  operations: [],
  threadId: 'thr_1',
  threadTitle: 'Practice',
  destinationRoomId: 'world-continuity',
  destinationRoomTitle: 'My World',
  destinationHasScenario: false,
  items: [{
    sourceEventId: 'evt_1',
    ownerId: 'B',
    kind: 'episode',
    text: 'A and B planned the garden.',
    witnesses: ['A', 'B', 'user'],
  }],
  people: [
    { id: 'A', displayName: 'Ava', originId: 'A', action: 'reference', required: false },
    { id: 'B', displayName: 'Ben', action: 'adopt', required: true },
  ],
  scenarioAvailable: false,
  requiredAdoptions: ['B'],
  problems: [],
  ...overrides,
});

describe('IntegrationModal', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  const onIntegrated = vi.fn(async () => {});
  const onClose = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Existing coverage runs with Living World enabled; the off-case sets it explicitly.
    setSettingsStore({ livingWorldEnabled: true });
    updateSettingsMock.mockClear();
    previewIntegration.mockReset();
    integrateThread.mockReset();
    onIntegrated.mockClear();
    onClose.mockClear();
    vi.stubGlobal('crypto', { randomUUID: () => 'integration-op-1' });
  });

  afterEach(() => {
    dispose?.();
    container.remove();
    vi.unstubAllGlobals();
  });

  const renderModal = (): void => {
    dispose = render(() => (
      <IntegrationModal thread={thread} rooms={[{ id: 'room-1', title: 'My World', participantIds: [], createdAt: 1 }]}
        onIntegrated={onIntegrated} onClose={onClose} />
    ), container);
  };

  const flush = async (): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  };

  const flushAll = async (): Promise<void> => {
    await flush();
    await flush();
  };
  const checkboxFor = (name: string): HTMLInputElement =>
    (Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]).find(input =>
      (input.closest('label')?.textContent ?? '').includes(name))!;

  const buttonWithText = (text: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text)!;

  it('auto-selects required adoptions and previews the admission catalog', async () => {
    previewIntegration.mockImplementation(async (input: { adoptParticipantIds: string[] }) =>
      preview({ problems: input.adoptParticipantIds.includes('B') ? [] : ['selection requires adopting sandbox person: Ben'] }));
    renderModal();
    await flush();
    await flush();

    expect(previewIntegration).toHaveBeenCalledWith({
      threadId: 'thr_1', destinationRoomId: 'world-continuity', memoryEventIds: [], adoptParticipantIds: [], includeScenario: false,
    });
    expect(checkboxFor('Ben').checked).toBe(true);
    expect(checkboxFor('A and B planned the garden.').checked).toBe(false);
    expect(container.textContent).toContain('mlearn.ConversationAgent.Integration.PersonAdopt');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Integration.PersonReference');
  });

  it('commits the selection with one stable operation id and surfaces the committed state', async () => {
    previewIntegration.mockResolvedValue(preview());
    integrateThread.mockResolvedValue({
      appended: [{ type: 'memory.belief' }, { type: 'integration' }],
      alreadyApplied: false,
    });
    renderModal();
    await flush();

    checkboxFor('A and B planned the garden.').click();
    await flush();
    await flush();

    integrateThread.mockClear();
    buttonWithText('mlearn.ConversationAgent.Integration.Confirm').click();
    await flush();

    expect(integrateThread).toHaveBeenCalledTimes(1);
    expect(integrateThread).toHaveBeenCalledWith({
      integrationId: 'integration-op-1',
      threadId: 'thr_1',
      destinationRoomId: 'world-continuity',
      memoryEventIds: ['evt_1'],
      adoptParticipantIds: ['B'],
      includeScenario: false,
    });
    expect(onIntegrated).toHaveBeenCalled();
    expect(container.textContent).toContain('mlearn.ConversationAgent.Integration.Done');

    // A retry after the commit replays the same operation instead of duplicating.
    buttonWithText('mlearn.ConversationAgent.Integration.Close').click();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the operation id across a failed attempt so a retry is the same integration', async () => {
    previewIntegration.mockResolvedValue(preview());
    integrateThread.mockRejectedValueOnce(new Error('destination busy'));
    integrateThread.mockResolvedValueOnce({ appended: [], alreadyApplied: false });
    renderModal();
    await flush();

    checkboxFor('A and B planned the garden.').click();
    await flush();
    await flush();

    buttonWithText('mlearn.ConversationAgent.Integration.Confirm').click();
    await flush();
    expect(container.textContent).toContain('destination busy');

    buttonWithText('mlearn.ConversationAgent.Integration.Confirm').click();
    await flush();
    const ids = integrateThread.mock.calls.map(call => (call[0] as { integrationId: string }).integrationId);
    expect(ids).toEqual(['integration-op-1', 'integration-op-1']);
  });


  it('keeps the commit disabled while a changed selection re-previews', async () => {
    const gated = Promise.withResolvers<IntegrationPreview>();
    let previewCalls = 0;
    previewIntegration.mockImplementation(() => {
      previewCalls += 1;
      // Call 3 is the clicked selection; hold it so the commit gate is observable.
      if (previewCalls === 3) return gated.promise;
      return Promise.resolve(preview());
    });
    renderModal();
    await flushAll();

    checkboxFor('A and B planned the garden.').click();
    await flushAll();

    // The stale preview showed no problems, but its selection is no longer
    // the one under review, so the commit stays disabled until it resolves.
    expect(buttonWithText('mlearn.ConversationAgent.Integration.Confirm').disabled).toBe(true);
    gated.resolve(preview());
    await flushAll();
    expect(buttonWithText('mlearn.ConversationAgent.Integration.Confirm').disabled).toBe(false);
  });

  it('blocks the commit while the preview reports problems', async () => {
    previewIntegration.mockResolvedValue(preview({
      problems: ['the destination Room already has its own situation'],
      scenarioAvailable: false,
    }));
    renderModal();
    await flushAll();

    expect(container.textContent).toContain('the destination Room already has its own situation');
    const confirm = buttonWithText('mlearn.ConversationAgent.Integration.Confirm');
    expect(confirm.disabled).toBe(true);
    confirm.click();
    await flushAll();
    expect(integrateThread).not.toHaveBeenCalled();
  });
  it('drops automatic dependencies when their consequence is deselected', async () => {
    previewIntegration.mockImplementation(async (input: { memoryEventIds: string[] }) => preview({ requiredAdoptions: input.memoryEventIds.length ? ['B'] : [] }));
    renderModal(); await flushAll();
    checkboxFor('A and B planned the garden.').click(); await flushAll();
    expect(checkboxFor('Ben').checked).toBe(true);
    checkboxFor('A and B planned the garden.').click(); await flushAll();
    expect(checkboxFor('Ben').checked).toBe(false);
    expect(buttonWithText('mlearn.ConversationAgent.Integration.Confirm').disabled).toBe(true);
  });

  it('offers retry for a durable pending operation after reopening', async () => {
    previewIntegration.mockResolvedValue(preview({ operations: [{ integrationId: 'durable-operation', sourceThreadId: 'thr_1', destinationRoomId: 'room-1', memoryEventIds: ['evt_1'], adoptParticipantIds: ['B'], includeScenario: false, selectionHash: 'hash', createdAt: 1, status: 'pending' }] }));
    integrateThread.mockResolvedValue({ appended: [], alreadyApplied: false });
    renderModal(); await flushAll();
    buttonWithText('mlearn.ConversationAgent.Integration.Retry').click(); await flushAll();
    expect(integrateThread).toHaveBeenCalledWith(expect.objectContaining({ integrationId: 'durable-operation', destinationRoomId: 'room-1' }));
  });

  it('blocks the commit and requires consent while Living World is disabled', async () => {
    setSettingsStore({ livingWorldEnabled: false });
    previewIntegration.mockResolvedValue(preview());
    renderModal(); await flushAll();

    checkboxFor('A and B planned the garden.').click();
    await flushAll();

    expect(container.textContent).toContain('mlearn.ConversationAgent.LivingWorld.ConsentHint');
    const confirm = buttonWithText('mlearn.ConversationAgent.Integration.Confirm');
    expect(confirm.disabled).toBe(true);

    buttonWithText('mlearn.ConversationAgent.LivingWorld.EnableAndContinue').click();
    expect(updateSettingsMock).toHaveBeenCalledWith({ livingWorldEnabled: true });
    await flushAll();

    // Consent re-enables the commit; nothing was admitted meanwhile.
    expect(buttonWithText('mlearn.ConversationAgent.Integration.Confirm').disabled).toBe(false);
    expect(integrateThread).not.toHaveBeenCalled();
  });

});

