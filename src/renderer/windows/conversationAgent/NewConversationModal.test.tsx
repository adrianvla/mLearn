// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { WorldSnapshot } from '../../../shared/world';

const createParticipant = vi.fn();
const createRoom = vi.fn();
const applyMembership = vi.fn();
const createThread = vi.fn();

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({ world: { createParticipant, createRoom, applyMembership, createThread } }),
}));

vi.mock('../../components/common', () => ({
  ModalForm: (props: { children?: JSX.Element; footer?: JSX.Element; title?: JSX.Element | string }) => (
    <div><span>{props.title}</span>{props.children}{props.footer}</div>
  ),
  FormField: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Textarea: (props: { value?: string; onInput?: (event: InputEvent) => void; placeholder?: string; rows?: number }) => (
    <textarea value={props.value} placeholder={props.placeholder} rows={props.rows} onInput={(event) => props.onInput?.(event)} />
  ),
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label']} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  HintText: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
}));

import { NewConversationModal } from './NewConversationModal';
import { RoomSidebar } from './RoomSidebar';

const persistentParticipant = {
  id: 'participant-1',
  displayName: 'Rin',
  kind: 'persistent' as const,
  personaText: 'A helpful partner',
  setupComplete: true,
};

const world = (participants = [persistentParticipant]): WorldSnapshot => ({ rooms: [], threads: [], participants });

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
    createRoom.mockResolvedValue({ id: 'room-1', title: 'Rin', participantIds: [], createdAt: 1 });
    applyMembership.mockResolvedValue({ room: { id: 'room-1', title: 'Rin', participantIds: ['participant-1'], createdAt: 1 }, event: null });
    createThread.mockResolvedValue({ id: 'thread-1', roomId: 'room-1', state: 'active', createdAt: 1 });
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  const startButton = (): HTMLButtonElement => container.querySelector('button[aria-label="Start conversation"]') as HTMLButtonElement;

  it('creates a one-to-one room for a selected persistent participant without creating another participant', async () => {
    const onCreated = vi.fn();
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    (container.querySelector('button[aria-label="Talk to Rin"]') as HTMLButtonElement).click();
    startButton().click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'room-1', threadId: 'thread-1' }));
    expect(createRoom).toHaveBeenCalledWith('Rin');
    expect(applyMembership).toHaveBeenCalledWith('room-1', 'participant-1', 'add');
    expect(createThread).toHaveBeenCalledWith('room-1');
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('creates a temporary participant from unresolved free text', async () => {
    const onCreated = vi.fn();
    const text = 'practice ordering coffee at a busy café';
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={onCreated} />, container);

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    startButton().click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'room-1', threadId: 'thread-1' }));
    expect(createParticipant).toHaveBeenCalledWith({ displayName: 'Partner', kind: 'temporary', personaText: text });
    expect(createRoom).toHaveBeenCalledWith(text.slice(0, 40));
    expect(applyMembership).toHaveBeenCalledWith('room-1', 'temporary-1', 'add');
  });

  it('creates the first unresolved participant as persistent', async () => {
    const text = 'practice ordering coffee at a busy café';
    dispose = render(() => <NewConversationModal world={world([])} onClose={vi.fn()} onCreated={vi.fn()} />, container);

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    startButton().click();

    await vi.waitFor(() => expect(createParticipant).toHaveBeenCalledWith({ displayName: 'Partner', kind: 'persistent', personaText: text }));
  });

  it('offers ambiguous matches for selection before starting a one-to-one room', async () => {
    const firstAlex = { ...persistentParticipant, id: 'alex-1', displayName: 'Alex' };
    const secondAlex = { ...persistentParticipant, id: 'alex-2', displayName: 'Alex' };
    dispose = render(() => <NewConversationModal world={world([firstAlex, secondAlex])} onClose={vi.fn()} onCreated={vi.fn()} />, container);

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Alex';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    startButton().click();

    await vi.waitFor(() => expect(container.textContent).toContain('Did you mean:'));
    const alexButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent === 'Alex');
    alexButtons.at(-1)!.click();
    startButton().click();

    await vi.waitFor(() => expect(applyMembership).toHaveBeenCalledWith('room-1', 'alex-2', 'add'));
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('disables Start while bridge work is in progress', async () => {
    let resolveRoom: (value: { id: string; title: string; participantIds: string[]; createdAt: number }) => void = () => {};
    createRoom.mockImplementation(() => new Promise((resolve) => { resolveRoom = resolve; }));
    dispose = render(() => <NewConversationModal world={world()} onClose={vi.fn()} onCreated={vi.fn()} />, container);

    (container.querySelector('button[aria-label="Talk to Rin"]') as HTMLButtonElement).click();
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

    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'New conversation')!.click();
    expect(onNewConversation).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });
});
