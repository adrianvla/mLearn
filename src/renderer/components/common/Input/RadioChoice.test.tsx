// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { RadioChoice } from './RadioChoice';

describe('RadioChoice', () => {
  it('keeps native radio semantics while the whole choice card selects it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    const dispose = render(() => <RadioChoice name="practice" label="Temporary practice" checked={false} onChange={onChange} />, host);

    const radio = host.querySelector<HTMLInputElement>('input[type="radio"]')!;
    expect(radio).not.toBeNull();
    expect(radio.getAttribute('aria-label')).toBe('Temporary practice');
    host.querySelector('label')!.click();
    expect(onChange).toHaveBeenCalledOnce();
    dispose();
    host.remove();
  });

  it('prevents selection while disabled', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    const dispose = render(() => <RadioChoice name="practice" label="Persistent room" checked={false} disabled onChange={onChange} />, host);

    host.querySelector('label')!.click();
    expect(host.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    dispose();
    host.remove();
  });
});
