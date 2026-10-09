// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { Participant, WorldSnapshot } from '../../../shared/world';

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { uiLanguage: 'en' } }),
}));

import { RoomSidebar } from './RoomSidebar';

const person = (id: string, displayName: string): Participant => ({
  id, displayName, kind: 'persistent', personaText: '', setupComplete: true,
});
const emptyProps = (world: WorldSnapshot) => ({
  world,
  roomId: null,
  threadId: null,
  onSelectRoom: vi.fn(),
  onSelectThread: vi.fn(),
  onNewConversation: vi.fn(),
  onPractice: vi.fn(),
  onAddContact: vi.fn(),
  onSelectContact: vi.fn(),
});
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });

const mount = (props: ReturnType<typeof emptyProps>) => {
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <RoomSidebar {...props} />, root);
  return root;
};

describe('RoomSidebar action placement and roster identity', () => {
  it('keeps new conversation in Chats and Add contact in Contacts', () => {
    const props = emptyProps({ rooms: [], threads: [], participants: [] } as WorldSnapshot);
    const root = mount(props);
    const newConversation = root.querySelector<HTMLButtonElement>('.room-sidebar-header button[aria-label="mlearn.ConversationAgent.NewConversation.Title"]');
    expect(newConversation).not.toBeNull();
    expect(root.querySelector('.room-sidebar-header button')?.textContent).not.toContain('mlearn.ConversationAgent.Contacts.Add');
    newConversation!.click();
    expect(props.onNewConversation).toHaveBeenCalledOnce();

    root.querySelector<HTMLButtonElement>('[role="tab"][id$="-tab-contacts"]')!.click();
    expect(root.querySelector('.room-sidebar-story-action')).toBeNull();
    const addContact = Array.from(root.querySelectorAll<HTMLButtonElement>('.room-sidebar-header button'))
      .find(button => button.textContent?.includes('mlearn.ConversationAgent.Contacts.Add'));
    expect(addContact).not.toBeUndefined();
    expect(root.querySelector('.room-sidebar-header button[aria-label="mlearn.ConversationAgent.NewConversation.Title"]')).toBeNull();
    addContact!.click();
    expect(props.onAddContact).toHaveBeenCalledOnce();
  });

  it('derives multi-person row avatars from each stable roster in roster order', () => {
    const world = {
      rooms: [
        { id: 'room-first', title: 'Pair', participantIds: ['a', 'b'], createdAt: 1 },
        { id: 'room-second', title: 'Pair', participantIds: ['a', 'c'], createdAt: 2 },
      ],
      threads: [],
      participants: [person('a', 'Alex'), person('b', 'Alex'), person('c', 'Alex')],
    } as WorldSnapshot;
    const props = emptyProps(world);
    const root = mount(props);
    const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('.room-sidebar-room'));
    expect(rows).toHaveLength(2);
    expect(rows.map(row => Array.from(row.querySelectorAll('[data-participant-id]')).map(slot => slot.getAttribute('data-participant-id'))))
      .toEqual([['a', 'c'], ['a', 'b']]);
    rows[0].click();
    expect(props.onSelectRoom).toHaveBeenCalledWith('room-second');
    expect(rows[1].title).toBe('Pair');
  });

  it('keeps long contact names available on the Contacts row', () => {
    const longName = 'A Very Long Contact Name That Needs Truncation';
    const root = mount(emptyProps({ rooms: [], threads: [], participants: [person('long', longName)] } as WorldSnapshot));
    root.querySelector<HTMLButtonElement>('[role="tab"][id$="-tab-contacts"]')!.click();
    const contact = root.querySelector<HTMLButtonElement>('.room-sidebar-list .list-row')!;
    expect(contact.querySelector('.list-row__headline')?.textContent).toBe(longName);
    expect(contact.title).toBe(longName);
  });
});
