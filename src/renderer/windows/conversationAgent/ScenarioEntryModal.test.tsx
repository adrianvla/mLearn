// @vitest-environment happy-dom

/**
 * ScenarioEntryModal + RoomSidebar "New scenario" flow.
 * Verifies the free-form scenario entry: createParticipant (temporary) →
 * createRoom → applyMembership (add) → createThread → onCreated → modal closes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const createParticipant = vi.fn();
const createRoom = vi.fn();
const applyMembership = vi.fn();
const createThread = vi.fn();

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    world: { createParticipant, createRoom, applyMembership, createThread },
  }),
}));

vi.mock('../../components/common', () => ({
  ModalForm: (props: {
    isOpen?: boolean;
    onClose?: () => void;
    title?: JSX.Element | string;
    footer?: JSX.Element;
    children?: JSX.Element;
    onSubmit?: () => void;
  }) => (
    props.isOpen ? (
      <div>
        <span>{props.title}</span>
        {props.children}
        {props.footer}
      </div>
    ) : null
  ),
  FormField: (props: { label?: string; children?: JSX.Element }) => (
    <div><span>{props.label}</span>{props.children}</div>
  ),
  Textarea: (props: { value?: string; onInput?: (e: InputEvent) => void; placeholder?: string; rows?: number }) => (
    <textarea value={props.value} placeholder={props.placeholder} rows={props.rows} onInput={(e) => props.onInput?.(e)} />
  ),
  Input: (props: { value?: string; onInput?: (e: InputEvent) => void; placeholder?: string }) => (
    <input value={props.value} placeholder={props.placeholder} onInput={(e) => props.onInput?.(e)} />
  ),
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; variant?: string }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  HintText: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
}));

import { ScenarioEntryModal } from './ScenarioEntryModal';
import { RoomSidebar } from './RoomSidebar';

describe('ScenarioEntryModal', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    createParticipant.mockReset();
    createRoom.mockReset();
    applyMembership.mockReset();
    createThread.mockReset();
    createParticipant.mockResolvedValue({ id: 'participant-1', displayName: 'Partner', kind: 'temporary', personaText: 'desc', setupComplete: true });
    createRoom.mockResolvedValue({ id: 'room-1', title: 'desc', participantIds: [], createdAt: 1 });
    applyMembership.mockResolvedValue({ room: { id: 'room-1', title: 'desc', participantIds: ['participant-1'], createdAt: 1 }, event: null });
    createThread.mockResolvedValue({ id: 'thread-1', roomId: 'room-1', state: 'active', createdAt: 1 });
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it('creates a temporary participant, room, membership, and thread, then calls onCreated and closes', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    dispose = render(() => (
      <ScenarioEntryModal isOpen={true} onClose={onClose} onCreated={onCreated} />
    ), container);

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'A quiet café in Kyoto. I am a traveler ordering coffee.';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const startButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Start scenario') as HTMLButtonElement | null;
    await vi.waitFor(() => expect(startButton()?.disabled).toBe(false));
    startButton()!.click();

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ roomId: 'room-1', threadId: 'thread-1' }));

    expect(createParticipant).toHaveBeenCalledWith({
      displayName: 'Partner',
      kind: 'temporary',
      personaText: 'A quiet café in Kyoto. I am a traveler ordering coffee.',
    });
    expect(createRoom).toHaveBeenCalledWith('A quiet café in Kyoto. I am a traveler ordering coffee.'.slice(0, 50));
    expect(applyMembership).toHaveBeenCalledWith('room-1', 'participant-1', 'add');
    expect(createThread).toHaveBeenCalledWith('room-1');
  });

  it('uses the provided participant name when non-blank', async () => {
    const onCreated = vi.fn();
    dispose = render(() => (
      <ScenarioEntryModal isOpen={true} onClose={vi.fn()} onCreated={onCreated} />
    ), container);

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'A busy market.';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const nameInput = container.querySelector('input') as HTMLInputElement;
    nameInput.value = 'Rin';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    const startButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Start scenario') as HTMLButtonElement | null;
    await vi.waitFor(() => expect(startButton()?.disabled).toBe(false));
    startButton()!.click();

    await vi.waitFor(() => expect(createParticipant).toHaveBeenCalledWith({
      displayName: 'Rin',
      kind: 'temporary',
      personaText: 'A busy market.',
    }));
  });
});

describe('RoomSidebar', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  it('renders the New scenario button and fires onNewScenario', () => {
    const onNewScenario = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(() => (
      <RoomSidebar
        world={{ rooms: [], threads: [], participants: [] }}
        roomId={null}
        threadId={null}
        onSelectRoom={vi.fn()}
        onSelectThread={vi.fn()}
        onNewThread={vi.fn()}
        onNewScenario={onNewScenario}
      />
    ), container);

    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'New scenario');
    expect(button).not.toBeNull();
    button!.click();
    expect(onNewScenario).toHaveBeenCalledTimes(1);
  });
});
