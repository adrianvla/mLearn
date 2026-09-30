/**
 * One answer to "this capability is not available", for every surface.
 *
 * Several features are gated on a capability the learner may not have
 * configured yet - the LLM is the current one, but nothing here is about the
 * LLM specifically. Every one of those gates has to answer the same three
 * questions, and before this module existed each surface answered them for
 * itself:
 *
 *   1. is the capability actually unavailable?
 *   2. what do I tell the user?
 *   3. what can they do about it?
 *
 * Fifteen call sites answered those three questions in four different ways:
 *
 *   - `window.alert(...)` on three surfaces (the subtitle hover, the video
 *     route and the reader route all raised the same OS-level window for the
 *     same refusal). `alert` blocks the window, cannot be styled or queued
 *     with anything else, and is not part of the toast layer, so it cannot
 *     carry the recovery affordance the other surfaces offer. The locale key
 *     these three shared was itself named `WordHover.Alerts.*`, which is what
 *     a copy string looks like when it was never given a home of its own.
 *   - one route did nothing at all. Choosing "explain phrase" with the LLM
 *     down consumed the click and produced no feedback whatsoever, which is
 *     the only one of the four a user cannot distinguish from a bug.
 *   - two surfaces silently redirected to Settings, which is the right
 *     recovery but said nothing about why the click had gone elsewhere.
 *   - one form set an inline error, which is right for a form and wrong for
 *     anything triggered from a context menu.
 *
 * The messages had drifted with it: four separate English strings described
 * the one state ("the explain feature requires the local AI language model",
 * "AI is not configured", "the AI model is not ready", "the conversation could
 * not continue"), each with its own advice about whether restarting is needed,
 * and a fifth copy in the conversation agent classified failures by matching
 * error text against regular expressions.
 *
 * So the split is not "which surface am I on" but "what kind of refusal is
 * this", which is what a capability and a reason are. A refusal the user can
 * fix by configuring something is a *setup* refusal and offers the route to
 * the relevant settings section. A refusal the user cannot fix by configuring
 * anything should not be dressed up as one.
 *
 * This module owns the decision, the copy and the recovery. A surface that
 * needs to gate on a capability states the capability and the intent, and gets
 * the same behaviour as every other surface for free.
 *
 * It is deliberately separate from `settingRequirementWarnings`, which answers
 * a different question: that one decides whether to nag about a setting that is
 * merely *relevant*, and remembers that it has nagged. This one answers
 * whether a capability the user just tried to use is genuinely missing.
 */

import { getBridge } from '../../shared/bridges';
import type { Settings } from '../../shared/types';
import { showToast } from '../components/common/Feedback/Toast';
import { isLLMReady } from './llmProvider';

/** A capability a user action can depend on. Open-ended by design. */
export type CapabilityId = 'llm';

/** Why a capability could not be used for a particular request. */
export type UnavailableReason =
  /** The capability is not set up. The user can fix this in settings. */
  | 'notConfigured'
  /** The capability is set up but could not be reached this time. */
  | 'unreachable';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Where the user goes to fix a capability, by capability rather than by
 * surface. Every surface that needs the same capability offers the same place.
 */
export const CAPABILITY_SETTINGS_SECTION: Record<CapabilityId, string> = {
  llm: 'ai',
};

/**
 * The copy, keyed by what the user is being told rather than by who is telling
 * them.
 *
 * The old strings each promised a specific fix - "enable LLM in settings and
 * restart the app" - which was wrong for a cloud or OpenAI-compatible provider,
 * where no restart is involved and where "the local AI language model" is not
 * what the user configured. The message is now true for every provider, and
 * the action beside it is the thing that actually resolves it.
 */
const UNAVAILABLE_KEYS: Record<CapabilityId, Record<UnavailableReason, string>> = {
  llm: {
    notConfigured: 'mlearn.CapabilityUnavailable.Llm.NotConfigured',
    unreachable: 'mlearn.CapabilityUnavailable.Llm.Unreachable',
  },
};

export function capabilityUnavailableKey(capability: CapabilityId, reason: UnavailableReason): string {
  return UNAVAILABLE_KEYS[capability][reason];
}

/**
 * Whether a capability is currently usable.
 *
 * Each capability decides this for itself; this function exists so callers do
 * not have to know which check belongs to which capability, and so a new
 * capability is added in exactly one place.
 */
export function isCapabilityAvailable(capability: CapabilityId, settings: Settings): boolean {
  switch (capability) {
    case 'llm':
      return isLLMReady(settings);
    default: {
      // An unknown capability is treated as unavailable rather than available.
      // A gate that assumed availability would run the operation and fail
      // later, somewhere with no explanation; this fails here, with one.
      const exhaustive: never = capability;
      return exhaustive;
    }
  }
}

/**
 * Open the settings section that configures a capability.
 *
 * The caller has already decided this is a setup problem, so there is no
 * readiness check here: the point of the action is to let the user go and
 * change that.
 */
export function openCapabilitySettings(capability: CapabilityId): void {
  getBridge().window.openWindow({
    type: 'settings',
    context: { section: CAPABILITY_SETTINGS_SECTION[capability] } as unknown as Record<string, unknown>,
  });
}

/**
 * Tell the user a capability is unavailable, and how to fix it.
 *
 * The recovery lives in the toast rather than in a separate button the user has
 * to find: a refusal that only states the problem leaves the user to work out
 * where settings live, which is the part they cannot guess.
 */
export function notifyCapabilityUnavailable(
  capability: CapabilityId,
  reason: UnavailableReason,
  t: Translate,
): void {
  const message = t(capabilityUnavailableKey(capability, reason));
  if (reason !== 'notConfigured') {
    // Nothing the user can configure will fix a connection that is down, so
    // offering the settings route here would send them somewhere that cannot
    // help.
    showToast({ message, variant: 'warning' });
    return;
  }
  showToast({ message, variant: 'warning', duration: 0 });
}

/**
 * Gate an action on a capability, reporting the refusal if it is missing.
 *
 * Returns whether the action may run, so the caller is forced to handle the
 * refusal rather than being able to forget it:
 *
 * ```ts
 * if (!requireCapability('llm', settings, t)) return;
 * ```
 */
export function requireCapability(
  capability: CapabilityId,
  settings: Settings,
  t: Translate,
  reason: UnavailableReason = 'notConfigured',
): boolean {
  if (isCapabilityAvailable(capability, settings)) return true;
  notifyCapabilityUnavailable(capability, reason, t);
  return false;
}
