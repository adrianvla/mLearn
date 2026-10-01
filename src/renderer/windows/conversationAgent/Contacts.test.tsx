// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { Participant } from '../../../shared/world';
import type { WorldBridge } from '../../../shared/bridges/types';

const researchCharacter = vi.fn();
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ world: { researchCharacter, cancelCharacterResearch: vi.fn() } }) }));

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key, locale: () => 'en' }),
  useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, livingWorldEnabled: false }, updateSettings: vi.fn() }),
}));
vi.mock('../../components/common', async (original) => ({
  ...await original<typeof import('../../components/common')>(),
  ModalForm: (props: { title?: JSX.Element; children?: JSX.Element; footer?: JSX.Element }) => <div>{props.title}{props.children}{props.footer}</div>,
  VoiceSamplePicker: () => <div />,
}));
import { ParticipantEditorModal } from './ParticipantEditorModal';
import { RoomSidebar } from './RoomSidebar';
const cleanups: Array<() => void> = [];
function mount(view: () => JSX.Element): HTMLDivElement {
  const el = document.createElement('div'); document.body.append(el);
  const dispose = render(view, el); cleanups.push(() => { dispose(); el.remove(); });
  return el;
}
afterEach(() => cleanups.splice(0).forEach(fn => fn()));
const click = (el: HTMLElement, label: string): void => {
  const btn = Array.from(el.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  expect(btn, label).toBeDefined(); btn!.click();
};

describe('Contacts are independent from conversations', () => {
  it('groups by requested activity rather than temporary retention', () => {
    const el = mount(() => <RoomSidebar world={{ participants: [], rooms: [
      { id: 'social', title: 'Ordinary chat', participantIds: [], createdAt: 1 },
      { id: 'practice', title: 'Agreed feedback', participantIds: [], interactionMode: 'practice', createdAt: 2 }],
      threads: [{ id: 'scenario', title: 'Deadline negotiation', state: 'active', interactionMode: 'scenario', createdAt: 3,
        sandbox: { operationId: 'scenario', requestHash: 'hash', bindings: [], baselineHeads: {} } }] }}
      roomId={null} threadId={null} onSelectRoom={vi.fn()} onSelectThread={vi.fn()} onNewConversation={vi.fn()} onPractice={vi.fn()}
      onAddContact={vi.fn()} onStoryProgress={vi.fn()} onSelectContact={vi.fn()} />);
    expect(el.querySelector('.room-sidebar-list')?.textContent).toContain('Deadline negotiation');
    expect(el.querySelector('.room-sidebar-list')?.textContent).not.toContain('Agreed feedback');
    click(el, 'mlearn.ConversationAgent.Contacts.Practice');
    expect(el.querySelector('.room-sidebar-list')?.textContent).toContain('Agreed feedback');
    expect(el.querySelector('.room-sidebar-list')?.textContent).not.toContain('Deadline negotiation');
  });

  it('opens the Sea when its latest message is newer than an earlier thread', () => {
    const selectRoom = vi.fn();
    const selectThread = vi.fn();
    const el = mount(() => <RoomSidebar
      world={{ rooms: [{ id: 'room-a', title: 'Mara', participantIds: [], createdAt: 1, unreadCount: 2 }],
        threads: [{ id: 'thread-a', roomId: 'room-a', state: 'active', createdAt: 2 }], participants: [] }}
      roomId={null} threadId={null}
      previews={{ 'room-a': { text: 'Latest Sea message', timestamp: 10, actorId: 'user', eventId: 'sea-1' },
        'room-a/thread-a': { text: 'Earlier thread message', timestamp: 5, actorId: 'user', eventId: 'thread-1', threadId: 'thread-a' } }}
      onSelectRoom={selectRoom} onSelectThread={selectThread} onNewConversation={vi.fn()} onPractice={vi.fn()}
      onAddContact={vi.fn()} onStoryProgress={vi.fn()} onSelectContact={vi.fn()} />);
    const row = el.querySelector('.room-sidebar-room') as HTMLButtonElement;
    expect(row.textContent).toContain('Latest Sea message');
    expect(row.textContent).toContain('2');
    row.click();
    expect(selectRoom).toHaveBeenCalledWith('room-a');
    expect(selectThread).not.toHaveBeenCalled();
  });

  it('groups old and new direct rooms by contact identity while retaining both histories', () => {
    const selectRoom = vi.fn(); const selectThread = vi.fn();
    const person: Participant = { id: 'p1', displayName: 'Katsuki Bakugo', kind: 'persistent', personaText: '', setupComplete: true };
    const el = mount(() => <RoomSidebar world={{ participants: [person], rooms: [
      { id: 'legacy', title: person.displayName, participantIds: [person.id], createdAt: 1 },
      { id: 'current', title: person.displayName, participantIds: [person.id], createdAt: 10 }],
      threads: [{ id: 'old-session', roomId: 'legacy', title: 'Old conversation', state: 'archived', createdAt: 2 }] }}
      roomId="current" threadId={null} previews={{ current: { text: 'Latest reply', timestamp: 20, actorId: person.id, eventId: 'latest' } }}
      onSelectRoom={selectRoom} onSelectThread={selectThread} onNewConversation={vi.fn()} onPractice={vi.fn()}
      onAddContact={vi.fn()} onStoryProgress={vi.fn()} onSelectContact={vi.fn()} />);
    expect(el.querySelectorAll('.room-sidebar-room')).toHaveLength(1);
    expect(el.querySelector('.room-sidebar-room')?.textContent).toContain('Latest reply');
    (el.querySelector('.room-sidebar-room') as HTMLButtonElement).click();
    expect(selectRoom).toHaveBeenCalledWith('current');
    (el.querySelector('.room-sidebar-sessions summary') as HTMLElement).click();
    const oldSession = Array.from(el.querySelectorAll('.room-sidebar-sessions button')).find(button => button.textContent?.includes('Old conversation'));
    expect(oldSession).toBeDefined();
    (oldSession as HTMLButtonElement).click();
    expect(selectThread).toHaveBeenCalledWith('old-session');
  });

  it('keeps separate contacts with identical display names separate', () => {
    const people: Participant[] = ['p1', 'p2'].map(id => ({ id, displayName: 'Same name', kind: 'persistent', personaText: '', setupComplete: true }));
    const el = mount(() => <RoomSidebar world={{ participants: people, rooms: people.map(person => ({ id: person.id, title: person.displayName, participantIds: [person.id], createdAt: 1 })), threads: [] }}
      roomId={null} threadId={null} onSelectRoom={vi.fn()} onSelectThread={vi.fn()} onNewConversation={vi.fn()} onPractice={vi.fn()}
      onAddContact={vi.fn()} onStoryProgress={vi.fn()} onSelectContact={vi.fn()} />);
    expect(el.querySelectorAll('.room-sidebar-room')).toHaveLength(2);
  });

  it('offers Add contact from an empty messenger and a Contacts tab', () => {
    const add = vi.fn();
    const el = mount(() => <RoomSidebar world={{ rooms: [], threads: [], participants: [] }} roomId={null} threadId={null}
      onSelectRoom={vi.fn()} onSelectThread={vi.fn()} onNewConversation={vi.fn()} onPractice={vi.fn()} onAddContact={add} onStoryProgress={vi.fn()} onSelectContact={vi.fn()} />);
    click(el, 'mlearn.ConversationAgent.Contacts.Tab');
    click(el, 'mlearn.ConversationAgent.Contacts.Add');
    expect(add).toHaveBeenCalledOnce();
  });
  it('lists practice-only contact profiles even without any rooms, and selects the exact identity', () => {
    const person: Participant = { id: 'person-a', displayName: 'Mara', kind: 'temporary', personaText: 'Loves films.', setupComplete: true };
    const selected = vi.fn();
    const el = mount(() => <RoomSidebar world={{ rooms: [], threads: [], participants: [person] }} roomId={null} threadId={null}
      onSelectRoom={vi.fn()} onSelectThread={vi.fn()} onNewConversation={vi.fn()} onPractice={vi.fn()} onAddContact={vi.fn()} onStoryProgress={vi.fn()} onSelectContact={selected} />);
    click(el, 'mlearn.ConversationAgent.Contacts.Tab');
    const row = Array.from(el.querySelectorAll('button')).find(node => node.textContent?.includes('Mara'))!;
    expect(row).toBeDefined(); row.click(); expect(selected).toHaveBeenCalledWith(person);
  });
  it('defaults to a persistent person and can explicitly create a practice-only profile', async () => {
    const create = vi.fn(async () => {});
    const el = mount(() => <ParticipantEditorModal onCreate={create} onClose={vi.fn()} />);
    const name = el.querySelector('input[type="text"]') as HTMLInputElement;
    expect(name).not.toBeNull(); name.value = '  Mara  '; name.dispatchEvent(new Event('input', { bubbles: true }));
    const persona = el.querySelector('textarea')!; persona.value = 'A film student.'; persona.dispatchEvent(new Event('input', { bubbles: true }));
    const continuity = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(continuity.checked).toBe(true);
    continuity.click();
    click(el, 'mlearn.ConversationAgent.Contacts.Add');
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Mara', personaText: 'A film student.', kind: 'temporary' }));
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ id: expect.anything() }));
  });
  it('keeps a failed save editable and prevents duplicate in-flight creation', async () => {
    let reject!: (err: Error) => void;
    const create = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const el = mount(() => <ParticipantEditorModal onCreate={create} onClose={vi.fn()} />);
    const name = el.querySelector('input[type="text"]') as HTMLInputElement;
    name.value = 'Mara'; name.dispatchEvent(new Event('input', { bubbles: true }));
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    click(el, 'mlearn.ConversationAgent.Contacts.Add'); click(el, 'mlearn.ConversationAgent.Contacts.Add');
    expect(create).toHaveBeenCalledOnce(); reject(new Error('Disk is full'));
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toContain('Disk is full'));
    expect(name.value).toBe('Mara');
  });
  it('keeps source research as a draft until the owner accepts and creates the contact', async () => {
    researchCharacter.mockResolvedValue({ name: 'Mara', trackId: undefined, trackRevision: undefined,
      evidence: { name: 'Mara', wikiUrl: 'https://example.org', pageTitle: 'Mara', pageUrl: 'https://example.org/wiki/Mara',
        coverage: [], sources: [], text: 'Source text', quotes: [], storyText: '', excerpted: false },
      baseline: { lore: 'A patient film student.', context: '', quotes: [], notYetHappened: [], provenance: [], generatedFill: [] },
      generatedExamples: [], unknowns: ['Story progress not declared.'] });
    const create = vi.fn(async () => {});
    const el = mount(() => <ParticipantEditorModal onCreate={create} onClose={vi.fn()} />);
    const name = el.querySelector('input[type="text"]') as HTMLInputElement;
    name.value = 'Mara'; name.dispatchEvent(new Event('input', { bubbles: true }));
    const source = el.querySelector('input[type="url"]') as HTMLInputElement;
    source.value = 'https://example.org/wiki/Mara'; source.dispatchEvent(new Event('input', { bubbles: true }));
    click(el, 'mlearn.ConversationAgent.Story.Research');
    await vi.waitFor(() => expect(el.textContent).toContain('A patient film student.'));
    expect(create).not.toHaveBeenCalled();
    click(el, 'mlearn.ConversationAgent.Story.UseDraft');
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    click(el, 'mlearn.ConversationAgent.Contacts.Add');
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Mara', personaText: 'A patient film student.',
      canon: expect.objectContaining({ characterPageTitle: 'Mara', baseline: expect.objectContaining({ lore: 'A patient film student.' }) }) }));
  });

  it('does not attach an accepted source identity after the contact name changes', async () => {
    researchCharacter.mockResolvedValue({ name: 'Mara', trackId: undefined, trackRevision: undefined,
      evidence: { name: 'Mara', wikiUrl: 'https://example.org', pageTitle: 'Mara', pageUrl: 'https://example.org/wiki/Mara',
        coverage: [], sources: [], text: 'Source text', quotes: [], storyText: '', excerpted: false },
      baseline: { lore: 'A patient film student.', context: '', quotes: [], notYetHappened: [], provenance: [], generatedFill: [] },
      generatedExamples: [], unknowns: [] });
    const create = vi.fn(async (_input: Parameters<WorldBridge['createParticipant']>[0]) => {});
    const el = mount(() => <ParticipantEditorModal onCreate={create} onClose={vi.fn()} />);
    const name = el.querySelector('input[type="text"]') as HTMLInputElement;
    name.value = 'Mara'; name.dispatchEvent(new Event('input', { bubbles: true }));
    const source = el.querySelector('input[type="url"]') as HTMLInputElement;
    source.value = 'https://example.org/wiki/Mara'; source.dispatchEvent(new Event('input', { bubbles: true }));
    click(el, 'mlearn.ConversationAgent.Story.Research');
    await vi.waitFor(() => expect(el.textContent).toContain('A patient film student.'));
    click(el, 'mlearn.ConversationAgent.Story.UseDraft');
    name.value = 'Nora'; name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.textContent).not.toContain('mlearn.ConversationAgent.Story.ResearchAccepted');
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    click(el, 'mlearn.ConversationAgent.Contacts.Add');
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Nora', personaText: '' }));
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('canon');
  });

  it('keeps the researched identity fixed while the source request is in flight', async () => {
    let resolve!: (value: unknown) => void;
    researchCharacter.mockReturnValue(new Promise(value => { resolve = value; }));
    const el = mount(() => <ParticipantEditorModal onCreate={vi.fn()} onClose={vi.fn()} />);
    const name = el.querySelector('input[type="text"]') as HTMLInputElement;
    name.value = 'Mara'; name.dispatchEvent(new Event('input', { bubbles: true }));
    const source = el.querySelector('input[type="url"]') as HTMLInputElement;
    source.value = 'https://example.org/wiki/Mara'; source.dispatchEvent(new Event('input', { bubbles: true }));
    click(el, 'mlearn.ConversationAgent.Story.Research');
    expect(name.disabled).toBe(true);
    resolve({ name: 'Mara', trackId: undefined, trackRevision: undefined,
      evidence: { name: 'Mara', wikiUrl: 'https://example.org', pageTitle: 'Mara', pageUrl: 'https://example.org/wiki/Mara',
        coverage: [], sources: [], text: 'Source text', quotes: [], storyText: '', excerpted: false },
      baseline: { lore: 'A patient film student.', context: '', quotes: [], notYetHappened: [], provenance: [], generatedFill: [] },
      generatedExamples: [], unknowns: [] });
    await vi.waitFor(() => expect(name.disabled).toBe(false));
  });

  it('does not label excerpt-only research as reaching the declared story position', async () => {
    researchCharacter.mockResolvedValue({ name: 'Mara', trackId: 'story-1', trackRevision: 2,
      evidence: { name: 'Mara', wikiUrl: 'https://example.org', pageTitle: 'Mara', pageUrl: 'https://example.org/wiki/Mara',
        coverage: [], sources: [], text: 'Excerpt', quotes: [], storyText: 'An opening scene.', excerpted: true },
      baseline: { lore: 'A patient film student.', context: 'An opening scene.', quotes: [], notYetHappened: [], provenance: [], generatedFill: [] },
      generatedExamples: [], unknowns: ['Source passages were excerpted.'] });
    const create = vi.fn(async () => {});
    const el = mount(() => <ParticipantEditorModal onCreate={create} onClose={vi.fn()} storyTracks={[{
      id: 'story-1', title: 'Voyage', edition: 'First', unitLabel: 'chapter', completed: [{ from: 1, to: 3 }],
      sources: [], relations: [], autoAdvance: false, revision: 2, updatedAt: 2,
    }]} />);
    const name = el.querySelector('input[type="text"]') as HTMLInputElement;
    name.value = 'Mara'; name.dispatchEvent(new Event('input', { bubbles: true }));
    const source = el.querySelector('input[type="url"]') as HTMLInputElement;
    source.value = 'https://example.org/wiki/Mara'; source.dispatchEvent(new Event('input', { bubbles: true }));
    const track = el.querySelector('select') as HTMLSelectElement;
    track.value = 'story-1'; track.dispatchEvent(new Event('change', { bubbles: true }));
    click(el, 'mlearn.ConversationAgent.Story.Research');
    await vi.waitFor(() => expect(el.textContent).toContain('Source passages were excerpted.'));
    click(el, 'mlearn.ConversationAgent.Story.UseDraft');
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    click(el, 'mlearn.ConversationAgent.Contacts.Add');
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ canon: expect.objectContaining({
      coverage: [], coordinate: { kind: 'point', value: '' },
    }) }));
  });
});
