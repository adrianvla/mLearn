// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { ReadinessGate } from './ReadinessGate';
import { deriveReadiness, isSettledReadiness } from './readiness';
import type { Readiness } from './readiness';

describe('readiness contract helpers', () => {
  it('derives failure over absence over pending', () => {
    const pending = vi.fn(() => true);
    const unavailable = vi.fn(() => true);
    const failed = vi.fn(() => true);
    const readiness = deriveReadiness({ pending, unavailable, failed });

    expect(readiness()).toBe('failed');

    failed.mockReturnValue(false);
    expect(readiness()).toBe('unavailable');

    unavailable.mockReturnValue(false);
    expect(readiness()).toBe('pending');

    pending.mockReturnValue(false);
    expect(readiness()).toBe('ready');
  });

  it('treats refreshing as settled so valid content stays visible', () => {
    expect(isSettledReadiness('ready')).toBe(true);
    expect(isSettledReadiness('refreshing')).toBe(true);
    expect(isSettledReadiness('pending')).toBe(false);
    expect(isSettledReadiness('unavailable')).toBe(false);
    expect(isSettledReadiness('failed')).toBe(false);
  });
});

describe('ReadinessGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children once readiness settles', () => {
    const container = document.createElement('div');
    const [readiness, setReadiness] = createSignal<Readiness>('pending');
    const dispose = render(
      () => (
        <ReadinessGate when={readiness} fallback={<div data-testid="pending" />}>
          <div data-testid="content">ready</div>
        </ReadinessGate>
      ),
      container,
    );

    expect(container.querySelector('[data-testid="content"]')).toBeNull();
    // A brief pending window must not flash the placeholder.
    setReadiness('ready');
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pending"]')).toBeNull();

    dispose();
  });

  it('shows the fallback for a sustained pending and holds it past the reveal', () => {
    const container = document.createElement('div');
    const [readiness, setReadiness] = createSignal<Readiness>('pending');
    const dispose = render(
      () => (
        <ReadinessGate when={readiness} fallback={<div data-testid="pending" />}>
          <div data-testid="content">ready</div>
        </ReadinessGate>
      ),
      container,
    );

    vi.advanceTimersByTime(100);
    // Still inside the anti-flicker delay window: no placeholder, no content.
    expect(container.querySelector('[data-testid="pending"]')).toBeNull();
    expect(container.querySelector('[data-testid="content"]')).toBeNull();

    vi.advanceTimersByTime(50);
    expect(container.querySelector('[data-testid="pending"]')).not.toBeNull();

    // Settle: the already-visible placeholder stays for its minimum display
    // window before the content replaces it, then never comes back.
    setReadiness('ready');
    expect(container.querySelector('[data-testid="pending"]')).not.toBeNull();
    vi.advanceTimersByTime(400);
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pending"]')).toBeNull();

    dispose();
  });

  it('renders the fallback for the whole pending window with instant', () => {
    const container = document.createElement('div');
    const [readiness, setReadiness] = createSignal<Readiness>('pending');
    const dispose = render(
      () => (
        <ReadinessGate when={readiness} instant fallback={<div data-testid="pending" />}>
          <div data-testid="content">ready</div>
        </ReadinessGate>
      ),
      container,
    );

    expect(container.querySelector('[data-testid="pending"]')).not.toBeNull();
    setReadiness('ready');
    // instant gates never delay genuinely ready content.
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();

    dispose();
  });

  it('keeps children visible while refreshing', () => {
    const container = document.createElement('div');
    const [readiness, setReadiness] = createSignal<Readiness>('ready');
    const dispose = render(
      () => (
        <ReadinessGate when={readiness} fallback={<div data-testid="pending" />}>
          <div data-testid="content">content</div>
        </ReadinessGate>
      ),
      container,
    );

    setReadiness('refreshing');
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pending"]')).toBeNull();

    dispose();
  });

  it('resolves terminal states to their explicit slots instead of a skeleton', () => {
    const container = document.createElement('div');
    const [readiness, setReadiness] = createSignal<Readiness>('pending');
    const dispose = render(
      () => (
        <ReadinessGate
          when={readiness}
          fallback={<div data-testid="pending" />}
          unavailable={<div data-testid="unavailable">not installed</div>}
          failed={<div data-testid="failed">error</div>}
        >
          <div data-testid="content" />
        </ReadinessGate>
      ),
      container,
    );

    // Sustained pending shows the placeholder…
    vi.advanceTimersByTime(150);
    expect(container.querySelector('[data-testid="pending"]')).not.toBeNull();

    // …but a terminal state must surface its slot immediately, without
    // waiting out the already-visible placeholder's minimum display window.
    setReadiness('unavailable');
    expect(container.querySelector('[data-testid="unavailable"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pending"]')).toBeNull();

    setReadiness('failed');
    expect(container.querySelector('[data-testid="failed"]')).not.toBeNull();

    setReadiness('ready');
    // Returning to ready from a terminal state starts a fresh reveal; the
    // placeholder's minimum display window applies before content shows.
    vi.advanceTimersByTime(400);
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();

    dispose();
  });

  it('renders nothing for a terminal state without a slot — never a permanent skeleton', () => {
    const container = document.createElement('div');
    const dispose = render(
      () => (
        <ReadinessGate when={'unavailable' as Readiness} instant fallback={<div data-testid="pending" />}>
          <div data-testid="content" />
        </ReadinessGate>
      ),
      container,
    );

    expect(container.querySelector('[data-testid="pending"]')).toBeNull();
    expect(container.querySelector('[data-testid="content"]')).toBeNull();

    dispose();
  });
});
