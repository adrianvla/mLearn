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
});
