/**
 * LiveWordTranslator Tests
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { LiveWordTranslator } from './LiveWordTranslator';

const { mockSettings, updateSettingMock, onOpenAsideCallbacks, onOpenAsideMock } = vi.hoisted(() => {
  const settings: Record<string, unknown> = {
    showLiveTranslator: true,
    openAside: true,
  };
  const callbacks: Array<() => void> = [];
  const updateSetting = vi.fn();
  const onOpenAside = vi.fn((cb: () => void) => {
    callbacks.push(cb);
    return () => {
      const idx = callbacks.indexOf(cb);
      if (idx !== -1) callbacks.splice(idx, 1);
    };
  });
  return {
    mockSettings: settings,
    updateSettingMock: updateSetting,
    onOpenAsideCallbacks: callbacks,
    onOpenAsideMock: onOpenAside,
  };
});

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSetting: updateSettingMock,
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: {
      onOpenAside: onOpenAsideMock,
    },
  }),
}));

describe('LiveWordTranslator', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockSettings.showLiveTranslator = true;
    mockSettings.openAside = true;
    updateSettingMock.mockClear();
    onOpenAsideMock.mockClear();
    onOpenAsideCallbacks.length = 0;
    delete (window as unknown as Record<string, unknown>).mLearnLiveTranslator;
  });

  afterEach(() => {
    container.remove();
  });

  it('does not render when showLiveTranslator is false', () => {
    mockSettings.showLiveTranslator = false;
    const dispose = render(() => <LiveWordTranslator />, container);
    expect(container.querySelector('.live-word-translator')).toBeNull();
    dispose();
  });

  it('renders with hidden class when openAside is false', () => {
    mockSettings.openAside = false;
    const dispose = render(() => <LiveWordTranslator />, container);
    const el = container.querySelector('.live-word-translator');
    expect(el).not.toBeNull();
    expect(el?.classList.contains('hidden')).toBe(true);
    dispose();
  });

  it('renders without hidden class when openAside is true', () => {
    mockSettings.openAside = true;
    const dispose = render(() => <LiveWordTranslator />, container);
    const el = container.querySelector('.live-word-translator');
    expect(el).not.toBeNull();
    expect(el?.classList.contains('hidden')).toBe(false);
    dispose();
  });

  it('calls updateSetting with openAside false when close button is clicked', () => {
    mockSettings.openAside = true;
    const dispose = render(() => <LiveWordTranslator />, container);
    const closeBtn = container.querySelector('.panel-header .close');
    expect(closeBtn).not.toBeNull();
    (closeBtn as HTMLElement).click();
    expect(updateSettingMock).toHaveBeenCalledWith('openAside', false);
    dispose();
  });

  it('exposes global API that sets openAside to true on show()', () => {
    mockSettings.openAside = false;
    const dispose = render(() => <LiveWordTranslator />, container);
    expect(window.mLearnLiveTranslator).toBeDefined();
    window.mLearnLiveTranslator?.show();
    expect(updateSettingMock).toHaveBeenCalledWith('openAside', true);
    dispose();
  });

  it('exposes global API that sets openAside to false on hide()', () => {
    mockSettings.openAside = true;
    const dispose = render(() => <LiveWordTranslator />, container);
    expect(window.mLearnLiveTranslator).toBeDefined();
    window.mLearnLiveTranslator?.hide();
    expect(updateSettingMock).toHaveBeenCalledWith('openAside', false);
    dispose();
  });

  it('sets openAside to true when IPC onOpenAside fires', () => {
    mockSettings.openAside = false;
    const dispose = render(() => <LiveWordTranslator />, container);
    expect(onOpenAsideCallbacks.length).toBeGreaterThan(0);
    onOpenAsideCallbacks[0]();
    expect(updateSettingMock).toHaveBeenCalledWith('openAside', true);
    dispose();
  });

  it('remains hidden when cards are added while openAside is false', () => {
    mockSettings.openAside = false;
    const dispose = render(() => <LiveWordTranslator />, container);
    expect(window.mLearnLiveTranslator).toBeDefined();
    window.mLearnLiveTranslator?.addCard('test', 'test', 'translation');
    const el = container.querySelector('.live-word-translator');
    expect(el?.classList.contains('hidden')).toBe(true);
    // Cards should still be accumulated even while hidden
    const card = container.querySelector('.translator-card');
    expect(card).not.toBeNull();
    dispose();
  });

  it('removes a card from the DOM after its lifetime plus the fade duration', () => {
    vi.useFakeTimers();
    const dispose = render(() => <LiveWordTranslator />, container);
    window.mLearnLiveTranslator?.addCard('word', 'word', 'definition');
    expect(container.querySelector('.translator-card')).not.toBeNull();

    // Lifetime elapses: card starts fading
    vi.advanceTimersByTime(30000);
    expect(container.querySelector('.translator-card')?.classList.contains('fading')).toBe(true);

    // Fade completes: card removed from the DOM
    vi.advanceTimersByTime(300);
    expect(container.querySelector('.translator-card')).toBeNull();

    dispose();
    vi.useRealTimers();
  });

  it('re-adding a word during the fade keeps the card and restarts its lifetime', () => {
    vi.useFakeTimers();
    const dispose = render(() => <LiveWordTranslator />, container);
    window.mLearnLiveTranslator?.addCard('word', 'word', 'definition');

    // Lifetime elapses and the fade starts, but removal has not happened yet
    vi.advanceTimersByTime(30000);
    vi.advanceTimersByTime(299);
    expect(container.querySelector('.translator-card')).not.toBeNull();

    // Subtitle re-adds the same word: the pending removal must be cancelled
    window.mLearnLiveTranslator?.addCard('word', 'word', 'definition');
    vi.advanceTimersByTime(300);
    const card = container.querySelector('.translator-card');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('fading')).toBe(false);

    // Lifetime restarted from the re-add: advance to the fade start (30000 - 300)
    vi.advanceTimersByTime(29700);
    expect(container.querySelector('.translator-card')?.classList.contains('fading')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(container.querySelector('.translator-card')).toBeNull();

    dispose();
    vi.useRealTimers();
  });
});
