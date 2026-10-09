// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import type { Participant, Thread } from '../../../shared/world';

const mockSettings = vi.hoisted(() => ({ devMode: false }));

vi.mock('../../components/common', () => ({
  Button: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; 'aria-label'?: string }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick} aria-label={props['aria-label']}>{props.children}</button>
  ),
  Avatar: (props: { name: string }) => <span aria-hidden="true">{props.name.slice(0, 1)}</span>,
  Disclosure: (props: { title: JSX.Element; children?: JSX.Element }) => <details><summary>{props.title}</summary>{props.children}</details>,
  HintText: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  ToggleSwitch: (props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) => <button type="button" onClick={() => props.onChange(!props.checked)}>{props.label}</button>,
  Tag: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  FormField: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Input: (props: { value?: string; onInput?: (event: InputEvent) => void }) => (
    <input value={props.value} onInput={(event) => props.onInput?.(event)} />
  ),
  Textarea: (props: { value?: string; onInput?: (event: InputEvent) => void }) => (
    <textarea value={props.value} onInput={(event) => props.onInput?.(event)} />
  ),
  VoiceSamplePicker: (props: { value?: string; onChange?: (id: string) => void }) => (
    <input data-testid="voice-picker" value={props.value ?? ''} onInput={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).value)} />
  ),
  ModalForm: (props: { children?: JSX.Element; footer?: JSX.Element; title?: JSX.Element | string; onClose?: () => void }) => (
    <div data-testid="participant-editor-modal">{props.title}{props.children}{props.footer}</div>
  ),
}));


vi.mock('../../context', () => ({
  useSettings: () => ({ settings: mockSettings, updateSettings: vi.fn() }),
  useLocalization: () => ({ t: (key: string) => key, locale: () => 'en' }),
}));

import { ThreadInfoPanel } from './ThreadInfoPanel';

const participant: Participant = {
  id: 'participant-1',
  displayName: 'Rin',
  kind: 'persistent',
  personaText: 'A helpful partner who enjoys practicing conversation.',
  setupComplete: true,
};
const thread: Thread = { id: 'thread-1', roomId: 'room-1', title: 'Coffee practice', state: 'active', createdAt: 1 };

describe('ThreadInfoPanel', () => {
  let container: HTMLDivElement;
  let dispose: () => void;
  const onRenameThread = vi.fn(async () => {});
  const onUpdateParticipant = vi.fn(async () => {});
  const onDeleteThread = vi.fn(async () => {});
  const onRetryMaintenance = vi.fn(async () => {});

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onRenameThread.mockClear();
    onUpdateParticipant.mockClear();
    onDeleteThread.mockClear();
    onRetryMaintenance.mockClear();
    mockSettings.devMode = false;
  });

  afterEach(() => {
    dispose?.();
    container.remove();
  });

  const renderPanel = (overrides: Partial<Parameters<typeof ThreadInfoPanel>[0]> = {}): void => {
    dispose = render(() => (
      <ThreadInfoPanel
        thread={thread}
        context={null}
        participants={[participant]}
        onRenameThread={onRenameThread}
        onUpdateParticipant={onUpdateParticipant}
        onDeleteThread={onDeleteThread}
        {...overrides}
      />
    ), container);
  };

  const buttonWithText = (text: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text)!;

  it('opens work progress from conversation details using the participant’s stable track identity', () => {
    const onStoryProgress = vi.fn();
    renderPanel({ participants: [{ ...participant, canon: { trackId: 'edition-track', workTitle: 'Voyage', fandomBaseUrl: 'https://example.org', characterPageTitle: 'Rin', coordinate: { kind: 'chapter', value: '1' }, baseline: { lore: '', quotes: [], context: '', notYetHappened: [], provenance: [], generatedFill: [] } } }], onStoryProgress });
    const story = buttonWithText('mlearn.ConversationAgent.Story.Title');
    expect(story).toBeDefined();
    story.click();
    expect(onStoryProgress).toHaveBeenCalledWith('edition-track');
    expect(onUpdateParticipant).not.toHaveBeenCalled();
  });

  it('renders the thread and its participants', () => {
    renderPanel();
    expect(container.textContent).toContain('Coffee practice');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.ParticipantsLabel');
    expect(container.textContent).toContain('Rin');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.Kind.Persistent');
    expect(container.textContent).not.toContain(participant.personaText);
    mockSettings.devMode = true;
    dispose();
    container.textContent = '';
    renderPanel();
    expect(container.textContent).toContain(participant.personaText);
  });

  it('renames the thread through the thread update path', async () => {
    renderPanel();
    buttonWithText('mlearn.ConversationAgent.Details.Rename').click();
    const input = container.querySelector('input') as HTMLInputElement;
    input.value = 'Café ordering';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    buttonWithText('mlearn.ConversationAgent.Details.Save').click();

    await vi.waitFor(() => expect(onRenameThread).toHaveBeenCalledWith('Café ordering'));
  });

  it('offers an explicit retry for a failed maintenance window', async () => {
    mockSettings.devMode = true;
    renderPanel({
      roomId: 'room-1',
      thread: null,
      onRetryMaintenance,
      reflectionRuns: [{
        reflectionId: 'refl-failed', kind: 'reflection', contextId: 'room-1', scopeKind: 'sea',
        windowStart: 1, windowEnd: 1, sourceEventIds: ['event-1'], status: 'failed', createdAt: 1,
        error: 'Invalid model output needs review.',
      }],
    });
    buttonWithText('mlearn.ConversationAgent.Details.RetryWorldActivity').click();
    await vi.waitFor(() => expect(onRetryMaintenance).toHaveBeenCalledWith('refl-failed'));
  });

  it('shows durable autonomy state and exposes the production pause control', async () => {
    mockSettings.devMode = true;
    const onSetAutonomyEnabled = vi.fn(async () => {});
    renderPanel({
      roomId: 'room-1',
      thread: null,
      autonomyEnabled: true,
      onSetAutonomyEnabled,
      autonomyJobs: [{
        jobId: 'job-1', roomId: 'room-1', candidateKind: 'agent-interest',
        leadParticipantId: participant.id, participantIds: [participant.id], sourceEventIds: ['event-1'],
        candidateHash: 'hash', status: 'blocked', attempts: 1, createdAt: 1, eligibleAt: 1,
        reason: 'Autonomy is waiting for permitted inference resources.',
      }],
    });
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.AutonomyWaiting');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.AutonomyBlocked');
    expect(container.textContent).toContain('Autonomy is waiting for permitted inference resources.');
    buttonWithText('mlearn.ConversationAgent.Details.PauseAutonomy').click();
    await vi.waitFor(() => expect(onSetAutonomyEnabled).toHaveBeenCalledWith(false));
  });

  it('opens a dedicated editor modal and saves participant fields through it', async () => {
    renderPanel();
    buttonWithText('mlearn.ConversationAgent.Details.EditContact').click();
    const modal = container.querySelector('[data-testid="participant-editor-modal"]')!;
    expect(modal).not.toBeNull();

    const modalInput = modal.querySelector('input:not([type])') as HTMLInputElement;
    modalInput.value = 'Mina';
    modalInput.dispatchEvent(new Event('input', { bubbles: true }));
    const textarea = modal.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'A thoughtful conversation partner.';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    buttonWithText('mlearn.ConversationAgent.Details.Save').click();

    await vi.waitFor(() => expect(onUpdateParticipant).toHaveBeenCalledWith({
      ...participant,
      displayName: 'Mina',
      personaText: 'A thoughtful conversation partner.',
    }));
  });

  it('shows the media situation without a parallel learner analytics panel', () => {
    renderPanel({
      thread: { ...thread, mediaRef: { mediaHash: 'video-1', mediaName: 'Episode One', mediaType: 'video' } },
      context: { mediaHash: 'video-1', mediaName: 'Episode One', mediaType: 'video', assessedLevel: null, assessedLevelName: 'N3', language: 'ja', failedWords: [], failedGrammar: [], wordLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 }, grammarLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 } },
    });
    const details = container.querySelector('details.ca-thread-media-analysis') as HTMLDetailsElement | null;
    expect(details).toBeNull();
    expect(container.textContent).toContain('Episode One');
    expect(container.textContent).not.toContain('N3');
  });

  it('omits the media analysis section when the thread has no media context', () => {
    renderPanel();
    expect(container.querySelector('details.ca-thread-media-analysis')).toBeNull();
  });

  it('confirms before deleting the thread', async () => {
    renderPanel();
    buttonWithText('mlearn.ConversationAgent.Details.DeleteThread').click();
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.DeleteThreadConfirm');
    buttonWithText('mlearn.ConversationAgent.Details.ConfirmDelete').click();

    await vi.waitFor(() => expect(onDeleteThread).toHaveBeenCalledTimes(1));
  });

  it('offers the integration review only for sandbox threads and dispatches it', async () => {
    const onIntegrate = vi.fn(async () => {});
    renderPanel();
    expect(buttonWithText('mlearn.ConversationAgent.Integration.Open')).toBeUndefined();

    renderPanel({ thread: { ...thread, sandbox: { operationId: 'op-1', requestHash: 'hash', bindings: [], baselineHeads: {} } }, onIntegrate });
    buttonWithText('mlearn.ConversationAgent.Integration.Open').click();
    await vi.waitFor(() => expect(onIntegrate).toHaveBeenCalledTimes(1));
  });

  it('adds a contact directly in details and keeps failure recoverable', async () => {
    const other = { ...participant, id: 'other', displayName: 'Mina' };
    const onChangeMembership = vi.fn().mockRejectedValueOnce(new Error('Unable to add now')).mockResolvedValue(undefined);
    renderPanel({ availableParticipants: [participant, other, { ...other, id: 'archived', archivedAt: 1 },
      { ...other, id: 'practice', kind: 'temporary' }], onChangeMembership });
    buttonWithText('mlearn.ConversationAgent.Details.AddPerson').click();
    expect(container.querySelectorAll('.ca-thread-people-picker button')).toHaveLength(1);
    const add = container.querySelector('.ca-thread-people-picker button') as HTMLButtonElement;
    add.click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe('Unable to add now'));
    expect(container.querySelector('.ca-thread-people-picker')).not.toBeNull();
    add.click();
    await vi.waitFor(() => expect(container.querySelector('.ca-thread-people-picker')).toBeNull());
    expect(onChangeMembership).toHaveBeenLastCalledWith(other.id, 'add');
  });

  it('offers reusable practice profiles only in separate conversations and explains local edits', () => {
    renderPanel({ thread: { ...thread, sandbox: { operationId: 'op', requestHash: 'hash', baselineHeads: {}, bindings: [{ baseline: participant }] } },
      availableParticipants: [{ ...participant, id: 'practice', kind: 'temporary' }], onChangeMembership: vi.fn() });
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.SeparatePeopleHint');
    expect(buttonWithText('mlearn.ConversationAgent.Details.EditHere')).not.toBeUndefined();
    buttonWithText('mlearn.ConversationAgent.Details.AddPerson').click();
    expect(container.querySelectorAll('.ca-thread-people-picker button')).toHaveLength(1);
  });

  it('removes a person only after explaining the consequence and keeps the last participant', async () => {
    const onChangeMembership = vi.fn(async () => {});
    renderPanel({ participants: [participant, { ...participant, id: 'other', displayName: 'Mina' }], onChangeMembership });
    (container.querySelector('.ca-thread-participant-card button[aria-label]') as HTMLButtonElement).click();
    expect(onChangeMembership).not.toHaveBeenCalled();
    expect(container.querySelector('.ca-thread-people-confirm')?.textContent).toContain('mlearn.ConversationAgent.Details.RemovePersonHint');
    (container.querySelector('.ca-thread-people-confirm button:last-child') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onChangeMembership).toHaveBeenCalledWith(participant.id, 'remove'));
    dispose(); container.textContent = ''; renderPanel({ onChangeMembership });
    expect((container.querySelector('.ca-thread-participant-card button[aria-label]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('prevents roster edits during a response or call', () => {
    renderPanel({ membershipDisabled: true, onChangeMembership: vi.fn() });
    expect(buttonWithText('mlearn.ConversationAgent.Details.AddPerson').disabled).toBe(true);
    expect(buttonWithText('mlearn.ConversationAgent.Details.EditContact').disabled).toBe(true);
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.PeopleBusyHint');
  });

  it('keeps an open editor draft when a call starts before save', async () => {
    const [busy, setBusy] = createSignal(false);
    dispose = render(() => <ThreadInfoPanel thread={thread} context={null} participants={[participant]}
      membershipDisabled={busy()} onRenameThread={onRenameThread} onUpdateParticipant={onUpdateParticipant} onDeleteThread={onDeleteThread} />, container);
    buttonWithText('mlearn.ConversationAgent.Details.EditContact').click();
    setBusy(true);
    buttonWithText('mlearn.ConversationAgent.Details.Save').click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe('mlearn.ConversationAgent.Details.PeopleBusyHint'));
    expect(onUpdateParticipant).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="participant-editor-modal"]')).not.toBeNull();
  });

  it('disables an open removal confirmation if the other person leaves first', () => {
    const [people, setPeople] = createSignal([participant, { ...participant, id: 'other' }]);
    const onChangeMembership = vi.fn();
    dispose = render(() => <ThreadInfoPanel thread={thread} context={null} participants={people()}
      onChangeMembership={onChangeMembership} onRenameThread={onRenameThread} onUpdateParticipant={onUpdateParticipant} onDeleteThread={onDeleteThread} />, container);
    (container.querySelector('.ca-thread-participant-card button[aria-label]') as HTMLButtonElement).click();
    setPeople([participant]);
    const confirm = container.querySelector('.ca-thread-people-confirm button:last-child') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); confirm.click();
    expect(onChangeMembership).not.toHaveBeenCalled();
  });
});
