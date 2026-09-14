// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { WorldSnapshot } from '../../../shared/world';

const createParticipant = vi.fn();
const createRoom = vi.fn();
const applyMembership = vi.fn();
const createThread = vi.fn();
const updateThread = vi.fn(async (thread) => thread);

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({ world: { createParticipant, createRoom, applyMembership, createThread, updateThread } }),
}));

vi.mock('../../context', () => ({
  // t(key, params) — interpolates {name} so per-person aria-labels are distinguishable.
  useLocalization: () => ({
    t: (key: string, params?: { name?: string }) => (params?.name !== undefined ? `${key}-${params.name}` : key),
    locale: () => 'en',
  }),
}));

vi.mock('../../components/common', () => ({
  ModalForm: (props: { children?: JSX.Element; footer?: JSX.Element; title?: JSX.Element | string }) => (
    <div><span>{props.title}</span>{props.children}{props.footer}</div>
  ),
  FormField: (props: { children?: JSX.Element; label?: string }) => <div>{props.label}{props.children}</div>,
  Textarea: (props: { value?: string; onInput?: (event: InputEvent) => void; placeholder?: string; rows?: number }) => (
    <textarea value={props.value} placeholder={props.placeholder} rows={props.rows} onInput={(event) => props.onInput?.(event)} />
  ),
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; 'aria-label'?: string; 'aria-pressed'?: boolean; class?: string }) => (
    <button type="button" aria-label={props['aria-label']} aria-pressed={props['aria-pressed']} class={props.class} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
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
    createParticipant.mockReset();
    createRoom.mockReset();
    applyMembership.mockReset();
    createThread.mockReset();
    createParticipant.mockResolvedValue({ id: 'temporary-1', displayName: 'Partner', kind: 'temporary', personaText: '', setupComplete: true });
    createRoom.mockImplementation(async (title: string) => ({ id: 'room-1', title, participantIds: [], createdAt: 1 }));
    applyMembership.mockImplementation(async (roomId: string, participantId: string) => ({ room: { id: roomId, title: '', participantIds: [participantId], createdAt: 1 }, event: null }));
    createThread.mockResolvedValue({ id: 'thread-1', roomId: 'room-1', state: 'active', createdAt: 1 });
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  const startButton = (): HTMLButtonElement => container.querySelector('button[aria-label="mlearn.ConversationAgent.NewConversation.StartAria"]') as HTMLButtonElement;
  const personButton = (name: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === `mlearn.ConversationAgent.NewConversation.ToggleParticipant-${name}`)!;
  const typeIntent = (text: string): void => {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('keeps selection structured: each selected person joins the room roster by id', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    const rinButton = personButton('Rin');
    const alexButton = personButton('Alex');
    rinButton.click();
    alexButton.click();
    expect(rinButton.getAttribute('aria-pressed')).toBe('true');
    expect(alexButton.getAttribute('aria-pressed')).toBe('true');
    startButton().click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'room-1', threadId: 'thread-1' }));
    expect(createRoom).toHaveBeenCalledWith('Rin, Alex');
    expect(applyMembership).toHaveBeenCalledWith('room-1', 'participant-1', 'add');
    expect(applyMembership).toHaveBeenCalledWith('room-1', 'participant-2', 'add');
    expect(createThread).toHaveBeenCalledWith('room-1');
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

    await vi.waitFor(() => expect(applyMembership).toHaveBeenCalledTimes(1));
    expect(applyMembership).toHaveBeenCalledWith('room-1', 'participant-1', 'add');
  });

  it('passes the intent separately instead of turning the selection into text', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    personButton('Rin').click();
    typeIntent('practice ordering coffee at a busy café');
    startButton().click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({
      roomId: 'room-1',
      threadId: 'thread-1',
      intent: 'practice ordering coffee at a busy café',
    }));
    // Selection must not leak into the intent field, and the intent must not
    // become a participant persona.
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('practice ordering coffee at a busy café');
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('keeps the first unresolved free-text partner temporary until explicit promotion', async () => {
    const onCreated = vi.fn();
    const text = 'practice ordering coffee at a busy café';
    dispose = render(() => <NewConversationModal world={world([])} onClose={vi.fn()} onCreated={onCreated} />, container);

    typeIntent(text);
    startButton().click();

    await vi.waitFor(() => expect(createParticipant).toHaveBeenCalledWith({ displayName: 'Partner', kind: 'temporary', personaText: text }));
    // The created participant names the room even though props.world is a stale snapshot.
    await vi.waitFor(() => expect(createRoom).toHaveBeenCalledWith('Partner'));
    await vi.waitFor(() => expect(applyMembership).toHaveBeenCalledWith('room-1', 'temporary-1', 'add'));
  });

  it('resolves free text to an existing identity without re-creating it', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    typeIntent('Alex');
    startButton().click();

    await vi.waitFor(() => expect(applyMembership).toHaveBeenCalledWith('room-1', 'participant-2', 'add'));
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

    await vi.waitFor(() => expect(applyMembership).toHaveBeenCalledWith('room-1', 'alex-2', 'add'));
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
    createRoom.mockImplementation(() => new Promise((resolve) => { resolveRoom = resolve; }));
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={vi.fn()} />, container);

    personButton('Rin').click();
    startButton().click();

    await vi.waitFor(() => expect(startButton().disabled).toBe(true));
    resolveRoom({ id: 'room-1', title: 'Rin', participantIds: [], createdAt: 1 });
  });
});

describe('RoomSidebar', () => {
  it('renders the New conversation button and fires onNewConversation', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onNewConversation = vi.fn();
    const dispose = render(() => (
      <RoomSidebar world={world([])} roomId={null} threadId={null} onSelectRoom={vi.fn()} onSelectThread={vi.fn()} onNewThread={vi.fn()} onNewConversation={onNewConversation} />
    ), container);

    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Sidebar.NewConversation')!.click();
    expect(onNewConversation).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });
});
