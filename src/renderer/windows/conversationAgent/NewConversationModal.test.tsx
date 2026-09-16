// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/types';
import type { WorldSnapshot } from '../../../shared/world';

const createSandbox = vi.fn();
const prepareScenario = vi.fn();
const activateScenario = vi.fn();
const cancelScenario = vi.fn(async () => {});
const createParticipant = vi.fn();
const createRoom = vi.fn();
const applyMembership = vi.fn();
const createPersistentRoom = vi.fn();
const updateThread = vi.fn(async (thread) => thread);

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({ world: { prepareScenario, activateScenario, cancelScenario, createSandbox, createParticipant, createRoom, applyMembership, createPersistentRoom, updateThread } }),
}));

// Reactive settings store mirrors SettingsContext so consent flips re-render.
const [settingsStore, setSettingsStore] = createStore<Settings>({ ...DEFAULT_SETTINGS });
const updateSettingsMock = vi.fn((partial: Partial<Settings>) => setSettingsStore(partial));

vi.mock('../../context', () => ({
  // t(key, params) — interpolates {name} so per-person aria-labels are distinguishable.
  useLocalization: () => ({
    t: (key: string, params?: { name?: string }) => (params?.name !== undefined ? `${key}-${params.name}` : key),
    locale: () => 'en',
  }),
  useSettings: () => ({ settings: settingsStore, updateSettings: updateSettingsMock }),
}));

vi.mock('../../components/common', () => ({
  ModalForm: (props: { children?: JSX.Element; footer?: JSX.Element; title?: JSX.Element | string }) => (
    <div><span>{props.title}</span>{props.children}{props.footer}</div>
  ),
  FormField: (props: { children?: JSX.Element; label?: string }) => <div>{props.label}{props.children}</div>,
  Textarea: (props: { value?: string; onInput?: (event: InputEvent) => void; placeholder?: string; rows?: number }) => (
    <textarea value={props.value} placeholder={props.placeholder} rows={props.rows} onInput={(event) => props.onInput?.(event)} />
  ),
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; 'aria-label'?: string; 'aria-pressed'?: boolean; 'aria-checked'?: boolean; role?: 'radio'; class?: string }) => (
    <button type="button" role={props.role} aria-label={props['aria-label']} aria-pressed={props['aria-pressed']} aria-checked={props['aria-checked']} class={props.class} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  HintText: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
}));

import { NewConversationModal } from './NewConversationModal';
import { RoomSidebar } from './RoomSidebar';

const rin = {
  id: 'participant-1',
  displayName: 'Rin',
  kind: 'persistent' as const,
  personaText: 'A helpful partner',
  setupComplete: true,
};
const alex = {
  id: 'participant-2',
  displayName: 'Alex',
  kind: 'persistent' as const,
  personaText: 'Another partner',
  setupComplete: true,
};

const world = (participants = [rin, alex]): WorldSnapshot => ({ rooms: [], threads: [], participants });

describe('NewConversationModal', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setSettingsStore({ livingWorldEnabled: true });
    updateSettingsMock.mockClear();
    prepareScenario.mockReset(); activateScenario.mockReset(); cancelScenario.mockClear();
    prepareScenario.mockImplementation(async (request) => ({ operationId: request.operationId, status: 'ready', origin: 'generated', request,
      bindings: [], scenario: { scene: { sharedFacts: ['A busy café'], socialConstraints: [] }, participants: [], relationships: [], adaptations: [] } }));
    activateScenario.mockResolvedValue({ id: 'sandbox-1', state: 'active', createdAt: 1, sandbox: { bindings: [], baselineHeads: {} } });
    createSandbox.mockReset();
    createSandbox.mockResolvedValue({ id: 'sandbox-1', state: 'active', createdAt: 1, sandbox: {
      operationId: 'test', bindings: [], baselineHeads: {},
    } });
    createParticipant.mockReset();
    createRoom.mockReset();
    applyMembership.mockReset();
    createPersistentRoom.mockReset();
    createParticipant.mockResolvedValue({ id: 'temporary-1', displayName: 'Partner', kind: 'temporary', personaText: '', setupComplete: true });
    createRoom.mockImplementation(async (title: string) => ({ id: 'room-1', title, participantIds: [], createdAt: 1 }));
    applyMembership.mockImplementation(async (roomId: string, participantId: string) => ({ room: { id: roomId, title: '', participantIds: [participantId], createdAt: 1 }, event: null }));
    createPersistentRoom.mockResolvedValue({ id: 'room-9', title: 'Rin, Alex', participantIds: ['participant-1', 'participant-2'], createdByOperation: 'op', createdAt: 1 });
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  const startButton = (): HTMLButtonElement => container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.StartAria"], button[aria-label="mlearn.ConversationAgent.NewConversation.UseScenario"]') as HTMLButtonElement;
  const personButton = (name: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === `mlearn.ConversationAgent.NewConversation.ToggleParticipant-${name}`)!;
  const typeIntent = (text: string): void => {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('keeps selected people in an independent sandbox by exact id', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    const rinButton = personButton('Rin');
    const alexButton = personButton('Alex');
    rinButton.click();
    alexButton.click();
    expect(rinButton.getAttribute('aria-pressed')).toBe('true');
    expect(alexButton.getAttribute('aria-pressed')).toBe('true');
    startButton().click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'sandbox-1', threadId: 'sandbox-1' }));
    expect(createSandbox).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: ['participant-1', 'participant-2'] });
    expect(createRoom).not.toHaveBeenCalled();
    expect(applyMembership).not.toHaveBeenCalled();
    expect(createPersistentRoom).not.toHaveBeenCalled();
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('deselecting a person removes them before the roster is written', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    personButton('Rin').click();
    personButton('Alex').click();
    personButton('Alex').click();
    expect(personButton('Alex').getAttribute('aria-pressed')).toBe('false');
    startButton().click();

    await vi.waitFor(() => expect(createSandbox).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: ['participant-1'] }));
  });

  it('passes the intent separately instead of turning the selection into text', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    personButton('Rin').click();
    typeIntent('practice ordering coffee at a busy café');
    startButton().click();

    await vi.waitFor(() => expect(container.textContent).toContain('A busy café'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(startButton().getAttribute('aria-label')).toBe('mlearn.ConversationAgent.NewConversation.UseScenario');
    startButton().click();
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({
      roomId: 'sandbox-1',
      threadId: 'sandbox-1',
      intent: 'practice ordering coffee at a busy café',
    }));
    // Selection must not leak into the intent field, and the intent must not
    // become a participant persona.
    expect(prepareScenario.mock.calls[0][0].intent).toBe('practice ordering coffee at a busy café');
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('reviews an intent-only generated situation without creating permanent scaffolding', async () => {
    const onCreated = vi.fn();
    const text = 'practice ordering coffee at a busy café';
    dispose = render(() => <NewConversationModal world={world([])} onClose={vi.fn()} onCreated={onCreated} />, container);

    typeIntent(text);
    startButton().click();

    await vi.waitFor(() => expect(prepareScenario).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: [], intent: text }));
    await vi.waitFor(() => expect(container.textContent).toContain('A busy café'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(createParticipant).not.toHaveBeenCalled();
    expect(createRoom).not.toHaveBeenCalled();
    expect(applyMembership).not.toHaveBeenCalled();
    startButton().click();
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'sandbox-1', threadId: 'sandbox-1', intent: text }));
  });

  it('opens persistent generated intent as a Room Sea conversation', async () => {
    activateScenario.mockResolvedValue({ id: 'room-intent', title: 'Garden', participantIds: [rin.id], createdAt: 1 });
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);
    (container.querySelectorAll('[role="radio"]')[1] as HTMLButtonElement).click();
    personButton('Rin').click();
    typeIntent('Plan a garden');
    startButton().click();
    await vi.waitFor(() => expect(container.textContent).toContain('A busy café'));
    expect(prepareScenario).toHaveBeenCalledWith(expect.objectContaining({ scope: 'persistent', participantIds: [rin.id] }));
    startButton().click();
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'room-intent', threadId: null }));
  });

  it('resolves free text to an existing identity without re-creating it', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    typeIntent('Alex');
    startButton().click();

    await vi.waitFor(() => expect(prepareScenario).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: ['participant-2'], intent: 'Alex' }));
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('offers ambiguous matches and turns the pick into structured selection', async () => {
    const onCreated = vi.fn();
    const firstAlex = { ...rin, id: 'alex-1', displayName: 'Alex' };
    const secondAlex = { ...rin, id: 'alex-2', displayName: 'Alex' };
    dispose = render(() => <NewConversationModal world={world([firstAlex, secondAlex])} onClose={vi.fn()} onCreated={onCreated} />, container);

    typeIntent('Alex');
    startButton().click();

    await vi.waitFor(() => expect(container.textContent).toContain('mlearn.ConversationAgent.NewConversation.DidYouMean'));
    const alexButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Alex') as HTMLButtonElement[];
    alexButtons.at(-1)!.click();
    // Re-query after the candidates section unmounts: the clicked node is detached.
    const pressed = Array.from(container.querySelectorAll('button[aria-pressed="true"]'));
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toContain('Alex');
    startButton().click();

    await vi.waitFor(() => expect(prepareScenario).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: ['alex-2'], intent: 'Alex' }));
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('disables Start until a person is selected or an intent is entered', () => {
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={vi.fn()} />, container);
    expect(startButton().disabled).toBe(true);
    personButton('Rin').click();
    expect(startButton().disabled).toBe(false);
  });

  it('disables Start while bridge work is in progress', async () => {
    let resolveRoom: (value: { id: string; title: string; participantIds: string[]; createdAt: number }) => void = () => {};
    createSandbox.mockImplementation(() => new Promise((resolve) => { resolveRoom = resolve; }));
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={vi.fn()} />, container);

    personButton('Rin').click();
    startButton().click();

    await vi.waitFor(() => expect(startButton().disabled).toBe(true));
    resolveRoom({ id: 'room-1', title: 'Rin', participantIds: [], createdAt: 1 });
  });
});

describe('persistent scope creation', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setSettingsStore({ livingWorldEnabled: true });
    updateSettingsMock.mockClear();
    prepareScenario.mockReset(); activateScenario.mockReset(); cancelScenario.mockClear();
    prepareScenario.mockImplementation(async (request) => ({ operationId: request.operationId, status: 'ready', origin: 'generated', request,
      bindings: [], scenario: { scene: { sharedFacts: ['A busy café'], socialConstraints: [] }, participants: [], relationships: [], adaptations: [] } }));
    createSandbox.mockReset();
    createPersistentRoom.mockReset();
    createPersistentRoom.mockResolvedValue({ id: 'room-9', title: 'Rin', participantIds: ['participant-1'], createdByOperation: 'op', createdAt: 1 });
  });
  afterEach(() => { dispose?.(); container.remove(); });

  const startButton = (): HTMLButtonElement => container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.StartAria"], button[aria-label="mlearn.ConversationAgent.NewConversation.UseScenario"]') as HTMLButtonElement;
  const personButton = (name: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === `mlearn.ConversationAgent.NewConversation.ToggleParticipant-${name}`)!;
  const scopeOption = (key: string): HTMLButtonElement =>
    (Array.from(container.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[]).find((button) => button.textContent === key)!;
  const typeIntent = (text: string): void => {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('creates a persistent room through the main-owned command instead of a sandbox', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    scopeOption('mlearn.ConversationAgent.NewConversation.ScopePersistent').click();
    personButton('Rin').click();
    startButton().click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'room-9', threadId: null }));
    expect(createPersistentRoom).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: ['participant-1'], scope: 'persistent' });
    expect(createSandbox).not.toHaveBeenCalled();
  });
  it('routes a persistent intent through Director staging with the scope attached', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    scopeOption('mlearn.ConversationAgent.NewConversation.ScopePersistent').click();
    typeIntent('plan the garden');
    personButton('Rin').click();
    startButton().click();

    await vi.waitFor(() => expect(prepareScenario).toHaveBeenCalledWith(
      { operationId: expect.any(String), participantIds: ['participant-1'], scope: 'persistent', intent: 'plan the garden' }));
    expect(createPersistentRoom).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('living world consent', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setSettingsStore({ livingWorldEnabled: false });
    updateSettingsMock.mockClear();
    prepareScenario.mockReset(); activateScenario.mockReset(); cancelScenario.mockClear();
    createSandbox.mockReset();
    createSandbox.mockResolvedValue({ id: 'sandbox-1', state: 'active', createdAt: 1, sandbox: {
      operationId: 'test', bindings: [], baselineHeads: {},
    } });
    createPersistentRoom.mockReset();
    createPersistentRoom.mockResolvedValue({ id: 'room-9', title: 'Rin', participantIds: ['participant-1'], createdByOperation: 'op', createdAt: 1 });
  });
  afterEach(() => { dispose?.(); container.remove(); });

  const startButton = (): HTMLButtonElement => container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.StartAria"], button[aria-label="mlearn.ConversationAgent.NewConversation.UseScenario"]') as HTMLButtonElement;
  const personButton = (name: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === `mlearn.ConversationAgent.NewConversation.ToggleParticipant-${name}`)!;
  const scopeOption = (key: string): HTMLButtonElement =>
    (Array.from(container.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[]).find((button) => button.textContent === key)!;
  const enableButton = (): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.LivingWorld.EnableAndContinue')!;

  it('shows the consent heads-up and blocks persistent start while Living World is off', () => {
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={vi.fn()} />, container);

    scopeOption('mlearn.ConversationAgent.NewConversation.ScopePersistent').click();
    personButton('Rin').click();

    expect(container.textContent).toContain('mlearn.ConversationAgent.LivingWorld.ConsentHint');
    expect(enableButton()).toBeDefined();
    expect(startButton().disabled).toBe(true);
    expect(createPersistentRoom).not.toHaveBeenCalled();
  });

  it('persists consent through the settings bridge and proceeds', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    scopeOption('mlearn.ConversationAgent.NewConversation.ScopePersistent').click();
    personButton('Rin').click();
    enableButton().click();

    expect(updateSettingsMock).toHaveBeenCalledWith({ livingWorldEnabled: true });
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'room-9', threadId: null }));
    expect(createPersistentRoom).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: ['participant-1'], scope: 'persistent' });
    expect(createSandbox).not.toHaveBeenCalled();
  });

  it('leaves the disposable sandbox flow usable without consent', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    personButton('Rin').click();
    expect(container.textContent).not.toContain('mlearn.ConversationAgent.LivingWorld.ConsentHint');
    expect(startButton().disabled).toBe(false);
    startButton().click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'sandbox-1', threadId: 'sandbox-1' }));
    expect(createSandbox).toHaveBeenCalledWith({ operationId: expect.any(String), participantIds: ['participant-1'] });
    expect(createPersistentRoom).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });
});

describe('RoomSidebar', () => {
  it('renders the New conversation button and fires onNewConversation', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onNewConversation = vi.fn();
    const dispose = render(() => (
      <RoomSidebar world={world([])} roomId={null} threadId={null} onSelectRoom={vi.fn()} onSelectThread={vi.fn()} onNewConversation={onNewConversation} />
    ), container);

    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Sidebar.NewConversation')!.click();
    expect(onNewConversation).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });
});
