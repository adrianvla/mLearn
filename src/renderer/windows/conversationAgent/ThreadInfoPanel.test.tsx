// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { Participant, Thread } from '../../../shared/world';

vi.mock('../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  FormField: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  Input: (props: { value?: string; onInput?: (event: InputEvent) => void }) => (
    <input value={props.value} onInput={(event) => props.onInput?.(event)} />
  ),
  Textarea: (props: { value?: string; onInput?: (event: InputEvent) => void }) => (
    <textarea value={props.value} onInput={(event) => props.onInput?.(event)} />
  ),
}));

vi.mock('./MediaStatsTab', () => ({ MediaStatsTab: () => <div /> }));

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
  const onUpdateParticipant = vi.fn(async () => {});
  const onDeleteThread = vi.fn(async () => {});

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onUpdateParticipant.mockClear();
    onDeleteThread.mockClear();
    dispose = render(() => (
      <ThreadInfoPanel
        thread={thread}
        context={null}
        participants={[participant]}
        onUpdateParticipant={onUpdateParticipant}
        onDeleteThread={onDeleteThread}
      />
    ), container);
  });

  afterEach(() => {
    dispose();
    container.remove();
  });

  it('renders active-room participants', () => {
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.ParticipantsLabel');
    expect(container.textContent).toContain('Rin');
    expect(container.textContent).toContain('persistent');
    expect(container.textContent).toContain(participant.personaText);
  });

  it('saves edited participant fields', async () => {
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Details.Edit')!.click();
    const input = container.querySelector('input') as HTMLInputElement;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'Mina';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.value = 'A thoughtful conversation partner.';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Details.Save')!.click();

    await vi.waitFor(() => expect(onUpdateParticipant).toHaveBeenCalledWith({
      ...participant,
      displayName: 'Mina',
      personaText: 'A thoughtful conversation partner.',
    }));
  });

  it('confirms before deleting the thread', async () => {
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Details.DeleteThread')!.click();
    expect(container.textContent).toContain('mlearn.ConversationAgent.Details.DeleteThreadConfirm');
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.ConversationAgent.Details.ConfirmDelete')!.click();

    await vi.waitFor(() => expect(onDeleteThread).toHaveBeenCalledTimes(1));
  });
});
