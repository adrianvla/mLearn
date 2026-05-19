// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { ConversationSession } from '../../../shared/types';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
    locale: () => 'en',
  }),
}));

vi.mock('../../components/common', () => ({
  Btn: (props: Record<string, unknown>) => (
    <button
      type="button"
      disabled={props.disabled as boolean | undefined}
      onClick={props.onClick as ((event: MouseEvent) => void) | undefined}
    >
      {props.children as any}
    </button>
  ),
  IconBtn: (props: Record<string, unknown>) => (
    <button
      type="button"
      aria-label={
        (props['aria-label'] as string | undefined)
        ?? (props.ariaLabel as string | undefined)
      }
      onClick={props.onClick as ((event: MouseEvent) => void) | undefined}
    >
      {props.children as any}
    </button>
  ),
  Modal: (props: Record<string, unknown>) => (
    <Show when={props.isOpen}>
      <div data-testid="modal">
        <div data-testid="modal-title">{props.title as string}</div>
        <div data-testid="modal-body">{props.children as any}</div>
        <div data-testid="modal-footer">{props.footer as any}</div>
      </div>
    </Show>
  ),
  Input: (props: Record<string, unknown>) => (
    <input
      value={props.value as string | undefined}
      onInput={props.onInput as ((event: InputEvent) => void) | undefined}
      placeholder={props.placeholder as string | undefined}
    />
  ),
  EmptyState: (props: Record<string, unknown>) => (
    <div class="empty-state">{props.description as string}</div>
  ),
  TrashIcon: () => <span>trash</span>,
  PlusIcon: () => <span>plus</span>,
  HistoryIcon: () => <span>history</span>,
  ClockIcon: () => <span>clock</span>,
}));

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    id: `session_${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Session',
    agentId: null,
    messages: [],
    llmHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    ...overrides,
  };
}

describe('ConversationHistoryPanel', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  async function renderPanel(props: {
    sessions?: ConversationSession[];
    activeSessionId?: string | null;
    onSelect?: (id: string) => void;
    onDelete?: (id: string) => void;
    onDeleteAll?: () => void;
    onNewSession?: () => void;
  } = {}) {
    const { ConversationHistoryPanel } = await import('./ConversationHistoryPanel');
    const {
      sessions = [],
      activeSessionId = null,
      onSelect = vi.fn(),
      onDelete = vi.fn(),
      onDeleteAll = vi.fn(),
      onNewSession = vi.fn(),
    } = props;

    const dispose = render(
      () => (
        <ConversationHistoryPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelect}
          onDelete={onDelete}
          onDeleteAll={onDeleteAll}
          onNewSession={onNewSession}
        />
      ),
      container,
    );

    return { dispose, onSelect, onDelete, onDeleteAll, onNewSession };
  }

  it('renders empty state when sessions is []', async () => {
    const { dispose } = await renderPanel({ sessions: [] });
    await flushPromises();

    expect(container.textContent).toContain('mlearn.ConversationAgent.History.Empty');

    const items = container.querySelectorAll('.history-item');
    expect(items.length).toBe(0);

    dispose();
  });

  it('renders list of sessions sorted by updatedAt descending', async () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Oldest', updatedAt: 1000 }),
      makeSession({ id: 's2', title: 'Newest', updatedAt: 3000 }),
      makeSession({ id: 's3', title: 'Middle', updatedAt: 2000 }),
    ];
    const { dispose } = await renderPanel({ sessions });

    const items = container.querySelectorAll('.history-item');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain('Newest');
    expect(items[1].textContent).toContain('Middle');
    expect(items[2].textContent).toContain('Oldest');

    dispose();
  });

  it('clicking a session calls onSelect with the session id', async () => {
    const sessions = [makeSession({ id: 'session_abc', title: 'My Session' })];
    const { dispose, onSelect } = await renderPanel({ sessions });

    const item = container.querySelector('.history-item') as HTMLElement;
    expect(item).toBeTruthy();
    item.click();
    expect(onSelect).toHaveBeenCalledWith('session_abc');

    dispose();
  });

  it('clicking New Session calls onNewSession', async () => {
    const { dispose, onNewSession } = await renderPanel();

    const newSessionBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('mlearn.ConversationAgent.History.NewSession'),
    );
    expect(newSessionBtn).toBeTruthy();
    newSessionBtn!.click();
    expect(onNewSession).toHaveBeenCalled();

    dispose();
  });

  it('delete confirmation modal appears when delete button is clicked', async () => {
    const sessions = [makeSession({ id: 'session_del', title: 'Delete Me' })];
    const { dispose } = await renderPanel({ sessions });

    const deleteBtn = container.querySelector(
      '[aria-label="mlearn.ConversationAgent.History.Delete"]',
    ) as HTMLElement;
    expect(deleteBtn).toBeTruthy();
    deleteBtn.click();
    await flushPromises();

    expect(container.textContent).toContain('mlearn.ConversationAgent.History.DeleteConfirm');
    expect(container.textContent).toContain('Delete Me');

    dispose();
  });

  it('typing wrong session title disables confirm delete button', async () => {
    const sessions = [makeSession({ id: 'session_confirm', title: 'My Session' })];
    const { dispose } = await renderPanel({ sessions });

    const deleteBtn = container.querySelector(
      '[aria-label="mlearn.ConversationAgent.History.Delete"]',
    ) as HTMLElement;
    deleteBtn.click();
    await flushPromises();

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'Wrong Name';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const confirmBtn = Array.from(container.querySelectorAll('button')).filter((btn) =>
      btn.textContent?.includes('mlearn.ConversationAgent.History.Delete'),
    ).find((btn) => !btn.textContent?.includes('mlearn.ConversationAgent.History.DeleteAll')
      && !btn.textContent?.includes('mlearn.ConversationAgent.Setup.Cancel'),
    ) as HTMLButtonElement | undefined;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.disabled).toBe(true);

    dispose();
  });

  it('typing correct session title enables confirm delete button', async () => {
    const sessions = [makeSession({ id: 'session_confirm', title: 'My Session' })];
    const { dispose, onDelete } = await renderPanel({ sessions });

    const deleteBtn = container.querySelector(
      '[aria-label="mlearn.ConversationAgent.History.Delete"]',
    ) as HTMLElement;
    deleteBtn.click();
    await flushPromises();

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'my session';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const confirmBtn = Array.from(container.querySelectorAll('button')).filter((btn) =>
      btn.textContent?.includes('mlearn.ConversationAgent.History.Delete'),
    ).find((btn) => !btn.textContent?.includes('mlearn.ConversationAgent.History.DeleteAll')
      && !btn.textContent?.includes('mlearn.ConversationAgent.Setup.Cancel'),
    ) as HTMLButtonElement | undefined;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.disabled).toBe(false);

    confirmBtn!.click();
    expect(onDelete).toHaveBeenCalledWith('session_confirm');

    dispose();
  });

  it('Delete All confirmation modal appears and requires typing confirmation word', async () => {
    const sessions = [makeSession({ id: 's1', title: 'Session 1' })];
    const { dispose, onDeleteAll } = await renderPanel({ sessions });

    const deleteAllBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('mlearn.ConversationAgent.History.DeleteAll'),
    );
    expect(deleteAllBtn).toBeTruthy();
    deleteAllBtn!.click();
    await flushPromises();

    expect(container.textContent).toContain('mlearn.ConversationAgent.History.DeleteAllConfirm');

    const allDeleteAllButtons = Array.from(container.querySelectorAll('button')).filter((btn) =>
      btn.textContent?.includes('mlearn.ConversationAgent.History.DeleteAll'),
    );
    expect(allDeleteAllButtons.length).toBeGreaterThanOrEqual(2);

    const modal = container.querySelector('[data-testid="modal"]');
    expect(modal).toBeTruthy();

    const confirmBtn = Array.from(modal!.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('mlearn.ConversationAgent.History.DeleteAll')
      && !btn.textContent?.includes('mlearn.ConversationAgent.Setup.Cancel'),
    ) as HTMLButtonElement | undefined;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.disabled).toBe(true);

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();

    const confirmWord = 'mlearn.conversationagent.history.deleteallconfirmword';
    input.value = confirmWord;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    expect(confirmBtn!.disabled).toBe(false);

    confirmBtn!.click();
    await flushPromises();
    expect(onDeleteAll).toHaveBeenCalled();

    dispose();
  });
});
