// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { Avatar } from './Avatar';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
it('shows a pictogram for a blank contact rather than an empty circle', () => {
  dispose = render(() => <Avatar name="   " />, document.body);
  expect(document.querySelector('.avatar svg')).not.toBeNull();
  expect(document.querySelector('.avatar')?.getAttribute('aria-hidden')).toBe('true');
});
it('keeps the fallback recognizable when an empty-name photo fails', () => {
  dispose = render(() => <Avatar name="" src="broken-local-photo" />, document.body);
  document.querySelector('img')!.dispatchEvent(new Event('error'));
  expect(document.querySelector('.avatar svg')).not.toBeNull();
});
