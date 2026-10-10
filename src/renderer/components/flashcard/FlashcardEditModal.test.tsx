// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { FlashcardContent } from '../../../shared/types';
import { FlashcardEditModal } from './FlashcardEditModal';

vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));

vi.mock('../common', () => ({
  Button: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  Modal: (props: { isOpen: boolean; children?: JSX.Element }) => props.isOpen
    ? <section role="dialog">{props.children}</section>
    : null,
  TabContainer: () => null,
  TabPanel: (props: { tabId: string; activeTab: string; children?: JSX.Element }) => (
    props.tabId === props.activeTab ? <div>{props.children}</div> : null
  ),
  ToggleSwitch: () => null,
}));

vi.mock('./FlashcardEditor', () => ({
  FlashcardEditor: (props: { onSave: (content: FlashcardContent) => void }) => (
    <button type="button" data-testid="editor-save" onClick={() => props.onSave({
      type: 'word', front: '婚約者', back: 'fiancé(e)',
    })}>Save draft</button>
  ),
}));

const card = {
  id: 'card-1', language: 'ja', state: 'new' as const, ease: 1.3, interval: 0,
  dueDate: 0, reviews: 0, lapses: 0, learningStep: 0, createdAt: 1,
  lastReviewed: 0, lastUpdated: 1,
  content: { type: 'word' as const, front: '婚約者', back: 'fiance; fiancee' },
};

describe('FlashcardEditModal', () => {
  afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); });

  it('waits for the durable edit acknowledgement before closing', async () => {
    let acknowledge!: (saved: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>(resolve => { acknowledge = resolve; }));
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <FlashcardEditModal isOpen flashcard={card as never} onClose={onClose} onSave={onSave} />, container);

    (container.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();

    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    acknowledge(true);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());

    dispose();
  });

  it('keeps the draft open and offers a retry after a refused durable write', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onClose = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <FlashcardEditModal isOpen flashcard={card as never} onClose={onClose} onSave={onSave} />, container);

    (container.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('SaveFailed'));

    expect(onClose).not.toHaveBeenCalled();
    (container.querySelector('[data-testid="editor-save"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledTimes(2);

    dispose();
  });
});
