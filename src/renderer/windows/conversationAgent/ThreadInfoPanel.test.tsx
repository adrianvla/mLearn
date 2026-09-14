// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { Participant, Thread } from '../../../shared/world';

vi.mock('../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onRenameThread.mockClear();
    onUpdateParticipant.mockClear();
    onDeleteThread.mockClear();
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

  it('renders the thread and its participants', () => {
    renderPanel();
    expect(container.textContent).toContain('Coffee practice');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.ParticipantsLabel');
    expect(container.textContent).toContain('Rin');
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.Kind.Persistent');
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

  it('opens a dedicated editor modal and saves participant fields through it', async () => {
    renderPanel();
    buttonWithText('mlearn.ConversationAgent.Details.Edit').click();
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
});
