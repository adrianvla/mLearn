// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { FlashcardCreateModal } from './FlashcardCreateModal';
vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../common', () => ({
  Modal: (props: { children?: JSX.Element; footer?: JSX.Element }) => <div>{props.children}{props.footer}</div>,
  Btn: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Input: (props: JSX.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => <input {...props} aria-label={props.label} />,
}));
it('requires content, prevents duplicate saves, and retains the draft after failure for retry', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let rejectSave: (error: Error) => void = () => {};
  const add = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
  const close = vi.fn();
  const dispose = render(() => <FlashcardCreateModal isOpen onAdd={add} onClose={close} />, host);
  const submit = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Flashcards.Modals.AddCard.Submit')!;
  expect(submit.disabled).toBe(true);
  const inputs = host.querySelectorAll('input');
  inputs[0].value = 'word'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  inputs[2].value = 'meaning'; inputs[2].dispatchEvent(new Event('input', { bubbles: true }));
  submit.click(); submit.click();
  expect(add).toHaveBeenCalledOnce();
  expect(submit.disabled).toBe(true);
  rejectSave(new Error('offline'));
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
  expect(inputs[0].value).toBe('word'); expect(close).not.toHaveBeenCalled();
  submit.click();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(add).toHaveBeenLastCalledWith({ type: 'word', front: 'word', back: 'meaning', reading: undefined });
  dispose(); host.remove();
});
