// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';

describe('Tooltip', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.tooltip-content').forEach((el) => { el.remove(); });
  });

  async function renderTooltip(props: Record<string, unknown> = {}) {
    const { Tooltip } = await import('./Tooltip');
    const dispose = render(
      () =>
        Tooltip({
          content: (() => {
            const span = document.createElement('span');
            span.textContent = 'tooltip text';
            return span;
          })() as unknown as import('solid-js').JSX.Element,
          children: (() => {
            const span = document.createElement('span');
            span.textContent = 'trigger';
            span.className = 'child';
            return span;
          })() as unknown as import('solid-js').JSX.Element,
          ...props,
        }),
      container,
    );
    return { dispose };
  }

  it('renders trigger but not tooltip content initially', async () => {
    const { dispose } = await renderTooltip();
    const trigger = container.querySelector('.tooltip-trigger');
    expect(trigger).not.toBeNull();
    expect(document.body.querySelector('.tooltip-content')).toBeNull();
    dispose();
  });

  it('shows tooltip on mouseenter', async () => {
    const { dispose } = await renderTooltip();
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(document.body.querySelector('.tooltip-content')).not.toBeNull();
    dispose();
  });

  it('hides tooltip on mouseleave', async () => {
    const { dispose } = await renderTooltip();
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(document.body.querySelector('.tooltip-content')).not.toBeNull();
    trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(document.body.querySelector('.tooltip-content')).toBeNull();
    dispose();
  });

  it('applies position class top by default', async () => {
    const { dispose } = await renderTooltip();
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const content = document.body.querySelector('.tooltip-content');
    expect(content!.classList.contains('tooltip-content--top')).toBe(true);
    dispose();
  });

  it('applies position class bottom when specified', async () => {
    const { dispose } = await renderTooltip({ position: 'bottom' });
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const content = document.body.querySelector('.tooltip-content');
    expect(content!.classList.contains('tooltip-content--bottom')).toBe(true);
    dispose();
  });

  it('calls onShow when tooltip becomes visible', async () => {
    const onShow = vi.fn();
    const { dispose } = await renderTooltip({ onShow });
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(onShow).toHaveBeenCalledOnce();
    dispose();
  });

  it('calls onHide when tooltip is hidden', async () => {
    const onHide = vi.fn();
    const { dispose } = await renderTooltip({ onHide });
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(document.body.querySelector('.tooltip-content')).not.toBeNull();
    trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(onHide).toHaveBeenCalledOnce();
    dispose();
  });

  it('does not call onHide when tooltip was not visible', async () => {
    const onHide = vi.fn();
    const { dispose } = await renderTooltip({ onHide });
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(onHide).not.toHaveBeenCalled();
    dispose();
  });

  it('delays showing tooltip when delay is set', async () => {
    vi.useFakeTimers();
    const onShow = vi.fn();
    const { dispose } = await renderTooltip({ delay: 200, onShow });
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(document.body.querySelector('.tooltip-content')).toBeNull();
    expect(onShow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(document.body.querySelector('.tooltip-content')).not.toBeNull();
    expect(onShow).toHaveBeenCalledOnce();
    dispose();
    vi.useRealTimers();
  });

  it('cancels delayed show on mouseleave before delay expires', async () => {
    vi.useFakeTimers();
    const onShow = vi.fn();
    const { dispose } = await renderTooltip({ delay: 200, onShow });
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(100);
    trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(document.body.querySelector('.tooltip-content')).toBeNull();
    expect(onShow).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
  });

  it('passes custom class to trigger', async () => {
    const { dispose } = await renderTooltip({ class: 'my-custom' });
    const trigger = container.querySelector('.tooltip-trigger');
    expect(trigger!.classList.contains('my-custom')).toBe(true);
    dispose();
  });

  it('does not show tooltip after mouseleave even with delay', async () => {
    vi.useFakeTimers();
    const { dispose } = await renderTooltip({ delay: 100 });
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(document.body.querySelector('.tooltip-content')).toBeNull();
    dispose();
    vi.useRealTimers();
  });
});
