/**
 * The point of this owner is that every surface answers an unavailable
 * capability the same way, so these tests are about the shared decisions
 * rather than about any one caller's markup.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import {
  CAPABILITY_SETTINGS_SECTION,
  capabilityUnavailableKey,
  isCapabilityAvailable,
  notifyCapabilityUnavailable,
  openCapabilitySettings,
  requireCapability,
} from './capabilityUnavailable';
import { showToast } from '../components/common/Feedback/Toast';

const openWindow = vi.fn();
vi.mock('../../shared/bridges', () => ({
  getBridge: () => ({ window: { openWindow } }),
}));

const showToastMock = vi.fn();
vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

// The LLM's readiness is the one thing this module does not own, so it is
// stubbed to drive both branches. The real check has its own tests.
const llmReady = vi.fn<() => boolean>();
vi.mock('./llmProvider', () => ({
  isLLMReady: () => llmReady(),
}));

const t = (key: string) => key;

beforeEach(() => {
  openWindow.mockClear();
  showToastMock.mockClear();
  llmReady.mockReset();
  llmReady.mockReturnValue(false);
});

describe('capability availability', () => {
  it('reports the LLM capability from the LLM readiness check', () => {
    llmReady.mockReturnValue(true);
    expect(isCapabilityAvailable('llm', DEFAULT_SETTINGS)).toBe(true);
    llmReady.mockReturnValue(false);
    expect(isCapabilityAvailable('llm', DEFAULT_SETTINGS)).toBe(false);
  });

  it('does not let an action run while the capability is missing', () => {
    llmReady.mockReturnValue(false);
    expect(requireCapability('llm', DEFAULT_SETTINGS, t)).toBe(false);
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('does not report anything when the capability is available', () => {
    llmReady.mockReturnValue(true);
    expect(requireCapability('llm', DEFAULT_SETTINGS, t)).toBe(true);
    // A ready capability must be silent: a gate that nags when nothing is
    // wrong trains the user to dismiss the message that matters.
    expect(showToastMock).not.toHaveBeenCalled();
  });
});

describe('capability unavailable reporting', () => {
  it('uses one message per capability and reason, not per surface', () => {
    expect(capabilityUnavailableKey('llm', 'notConfigured')).toBe('mlearn.CapabilityUnavailable.Llm.NotConfigured');
    expect(capabilityUnavailableKey('llm', 'unreachable')).toBe('mlearn.CapabilityUnavailable.Llm.Unreachable');
    // The two reasons must not collapse onto one string: a setup problem and
    // a connection problem need different things from the user.
    expect(capabilityUnavailableKey('llm', 'notConfigured'))
      .not.toBe(capabilityUnavailableKey('llm', 'unreachable'));
  });

  it('translates the message through the caller locale', () => {
    notifyCapabilityUnavailable('llm', 'notConfigured', (key) => `translated:${key}`);
    expect(showToastMock.mock.calls[0][0].message)
      .toBe('translated:mlearn.CapabilityUnavailable.Llm.NotConfigured');
  });

  it('does not offer the settings route for a connection failure', () => {
    // Nothing the user can configure fixes a service that is down, so
    // sending them to settings would be a dead end.
    notifyCapabilityUnavailable('llm', 'unreachable', t);
    const options = showToastMock.mock.calls[0][0];
    expect(options.variant).toBe('warning');
    expect(options.duration).toBeUndefined();
  });

  it('keeps a setup refusal on screen until it is dealt with', () => {
    notifyCapabilityUnavailable('llm', 'notConfigured', t);
    const options = showToastMock.mock.calls[0][0];
    // A setup refusal is the user's to act on; auto-dismissing it puts the
    // explanation on screen only until they look away.
    expect(options.duration).toBe(0);
    expect(options.variant).toBe('warning');
  });
});

describe('capability recovery', () => {
  it('sends every capability to the settings section that configures it', () => {
    openCapabilitySettings('llm');
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow.mock.calls[0][0]).toMatchObject({
      type: 'settings',
      context: { section: CAPABILITY_SETTINGS_SECTION.llm },
    });
  });

  it('names the AI section for the LLM rather than a bare window', () => {
    // A Settings window opened with no section shows whatever tab was last
    // used, so the user lands somewhere unrelated to the refusal.
    expect(CAPABILITY_SETTINGS_SECTION.llm).toBe('ai');
  });
});
