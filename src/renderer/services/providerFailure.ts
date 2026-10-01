/**
 * One answer to "the AI provider operation failed", for every surface.
 *
 * A provider-backed action - generating an explanation, running a conversation
 * turn, building a card, synthesising speech - can fail in ways the learner can
 * act on, and each failure has exactly one useful response: sign in again,
 * check the connection, fix the API key, wait for quota, or repair the model.
 * Classifying the failure and choosing that response is one domain decision,
 * and it had six owners:
 *
 *   - `cloudSessionManager` invented two error *types* and the only transport
 *     classifier that inspects `code` and `name`, plus an auth classifier.
 *   - `conversationAgent/errorUtils` kept a **stale clone** of the auth
 *     classifier - it had lost `invalid_refresh_token`, so a refresh-token
 *     rejection stopped being recognised as an auth failure - and added a
 *     regex classifier over error *text*.
 *   - `FlashcardContext` and `flashcards/App` each declared their own
 *     `isCloudSessionCancelled` / `isCloudUnreachable` pair, byte-identical to
 *     each other, plus a `handleCloudOperationFallback` that was also
 *     byte-identical between them.
 *   - `conversationAgent/App` repeated that pair and then inlined a five-arm
 *     ternary ladder of copy keys three separate times.
 *   - `ExplainerPopup` declared the pair a third time - adding a `name` check
 *     the others lacked - and carried its own quota regex and its own
 *     JSON-error extractor.
 *
 * Six answers to one question, and they had already drifted apart in ways a
 * user can see. The same unreachable service is described as "Cloud service is
 * unreachable" on one surface and "Could not reach the AI service" on another.
 * Two of the three conversation-agent ladders order their checks differently, so
 * the identical failure is reported differently depending on which `catch`
 * caught it. `openai-compatible` has an authentication branch in two of those
 * three and not in the third. And a refresh-token rejection is reported as a
 * generic failure with the advice to check your settings, because the
 * classifier that ran had lost the code.
 *
 * What is *not* wrong is that surfaces present a failure differently. A toast,
 * an inline field error and a bubble in a transcript are three presentations of
 * the same fact, and the transcript one belongs to the conversation rather than
 * interrupting it. So this module owns the decision, the copy and the
 * recovery, and each surface keeps its own presentation:
 *
 *   - `classifyProviderFailure` turns a thrown value into exactly one record.
 *   - `describeProviderFailure` renders it inline, beside the thing that
 *     failed.
 *   - `notifyProviderFailure` renders it as a toast and returns the record, so
 *     a caller that needs the classification for a control-flow decision gets
 *     it from here instead of re-testing the error.
 *
 * It also owns the *effect* of a dead session. Clearing the stored session and
 * offering re-authentication used to be something each surface had to remember
 * to do, guarded by its own `llmProvider === 'cloud'` check, which is why it
 * happened on some paths and not others. A record that knows its failure is
 * unrecoverable without a new sign-in now performs that step wherever the
 * failure is reported, so a stale token is not reused by the next request.
 *
 * Classification inspects structured fields - the error's `code`, its `name`,
 * its HTTP `status`, and the two marker types the transport layer raises -
 * before it looks at message text, and it is the *same* text matching for every
 * caller. Message text is the last resort because it is the part that varies
 * between providers, and a classifier that depends on it is one that drifts.
 *
 * It is deliberately separate from `capabilityUnavailable`, which answers a
 * different question: whether a capability is *set up* before the user tries.
 * A capability that is not configured refuses the action; a provider operation
 * that fails reports what happened. The two meet in exactly one case - a
 * provider telling us the model is missing - and that case resolves to the same
 * "model is not ready" copy the capability gate uses, so the two cannot
 * disagree about what that state means.
 */
import type { LLMProvider, Settings } from '../../shared/types';
import { getLogger } from '../../shared/utils/logger';
import { getBridge } from '../../shared/bridges';
import { CloudLLMAdapter, OpenAICompatibleLLMAdapter } from '../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../shared/backends';
import { showToast } from '../components/common/Feedback/Toast';
import {
  CloudSessionCancelledError,
  CloudUnreachableError,
  ensureCloudAccessToken,
  handleCloudSessionError,
  isCloudSessionError,
} from './cloudSessionManager';

const log = getLogger('renderer.services.providerFailure');

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * What the learner can do about a failure.
 *
 * This, not the failure itself, is what a surface branches on: two failures
 * with different causes and the same answer are one state as far as the product
 * is concerned, and the recovery is what the user is actually offered.
 */
export type ProviderRecovery =
  /** Nothing is wrong - the learner chose to stop. Only retrying makes sense. */
  | 'retry'
  /** A setting has to change. The recovery is the route to that setting. */
  | 'settings'
  /** Only time helps. Offering settings here would send them somewhere useless. */
  | 'wait'
  /** Nothing the learner can configure will change this. */
  | 'none';

/**
 * One record per way a provider operation can fail.
 *
 * Every field is decided here so that a caller cannot pick a message that
 * contradicts the recovery it offers. The copy keys are existing keys moved
 * from the surfaces that owned them, not new strings, so no locale gains an
 * untranslated entry.
 */
export interface ProviderFailure {
  /** Stable id for tests and logs. Not shown to the learner. */
  readonly id: string;
  /** What the learner is told. */
  readonly key: string;
  /** What the learner can do about it. */
  readonly recovery: ProviderRecovery;
  /**
   * How loudly to report it. A cancelled sign-in is not a fault; a spent quota
   * outlives a normal toast because the answer is "later".
   */
  readonly toast: { variant: 'warning' | 'error'; duration: number } | null;
  /**
   * True when the provider never returned a result at all, as opposed to
   * returning an error *about* the request.
   *
   * This is the distinction that decides control flow at the call sites that
   * build content opportunistically: a flashcard example sentence that fails
   * because the account is out of quota is a card that exists but is missing an
   * example, whereas one that fails because the request never left the device
   * is not the same thing to swallow. It was previously implicit in which two
   * error types a local helper happened to recognise, which is why the two
   * copies of that helper could drift without anything failing.
   */
  readonly yieldsNoResult: boolean;
  /**
   * The cloud session has to be cleared and re-authentication offered. Only the
   * cloud provider has a session to recover; an openai-compatible endpoint has
   * a key to correct instead, which is why this is per-record and not per-kind.
   */
  readonly requiresSignIn?: boolean;
}

const FAILURES: Record<string, ProviderFailure> = {
  signInCancelled: {
    id: 'signInCancelled',
    key: 'mlearn.CloudReLogin.SignInCanceled',
    recovery: 'retry',
    toast: { variant: 'warning', duration: 5000 },
    yieldsNoResult: true,
  },
  signInRequired: {
    id: 'signInRequired',
    key: 'mlearn.CloudReLogin.SessionExpired',
    recovery: 'settings',
    toast: { variant: 'warning', duration: 0 },
    yieldsNoResult: true,
    requiresSignIn: true,
  },
  unreachable: {
    id: 'unreachable',
    key: 'mlearn.ConversationAgent.Recovery.Connection',
    recovery: 'none',
    toast: { variant: 'error', duration: 6000 },
    yieldsNoResult: true,
  },
  credentialsRejected: {
    id: 'credentialsRejected',
    key: 'mlearn.AI.Settings.CompatibleConfig.AuthenticationFailed',
    recovery: 'settings',
    toast: { variant: 'error', duration: 0 },
    yieldsNoResult: true,
  },
  quotaExceeded: {
    id: 'quotaExceeded',
    key: 'mlearn.AI.QuotaExceeded',
    recovery: 'wait',
    toast: { variant: 'error', duration: 8000 },
    yieldsNoResult: false,
  },
  notConfigured: {
    id: 'notConfigured',
    key: 'mlearn.ConversationAgent.Recovery.Model',
    recovery: 'settings',
    toast: { variant: 'warning', duration: 0 },
    yieldsNoResult: true,
  },
  unknown: {
    id: 'unknown',
    key: 'mlearn.ConversationAgent.Recovery.Generic',
    recovery: 'none',
    toast: { variant: 'error', duration: 6000 },
    yieldsNoResult: false,
  },
};

/** The failure reported when nothing more specific is known. */
export const UNKNOWN_PROVIDER_FAILURE: ProviderFailure = FAILURES.unknown;

function failure(id: keyof typeof FAILURES): ProviderFailure {
  return FAILURES[id];
}

function getErrorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === 'object' ? error as Record<string, unknown> : null;
}

function getErrorString(error: unknown, ...keys: string[]): string {
  const record = getErrorRecord(error);
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.toLowerCase();
  }
  return '';
}

function getErrorStatus(error: unknown): number | undefined {
  const record = getErrorRecord(error);
  const status = record?.status ?? record?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

function getErrorName(error: unknown): string {
  if (error instanceof Error) return error.name.toLowerCase();
  return getErrorString(error, 'name');
}

/**
 * Reduce any thrown value to something a human can read.
 *
 * Providers report failures as a message with a JSON payload welded onto the
 * end ("Cloud LLM error: 429 {"error":"You have run out of quota"}"). Two
 * modules used to carry their own extractor for that shape and they disagreed
 * about what to keep. This one prefers the structured field that actually says
 * something and otherwise leaves the text alone rather than guessing: an
 * unparseable payload is still better evidence than a rewrite of it.
 */
export function readProviderFailureMessage(error: unknown): string {
  let raw = '';
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === 'string') {
    raw = error;
  } else {
    raw = getErrorRecord(error)?.message as string ?? '';
  }

  const trimmed = raw.trim();
  if (!trimmed) return '';

  const jsonStart = trimmed.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
      const nestedError = getErrorRecord(parsed.error);
      const message = typeof nestedError?.message === 'string' ? nestedError.message
        : typeof parsed.error === 'string' ? parsed.error
        : typeof parsed.message === 'string' ? parsed.message
        : typeof parsed.detail === 'string' ? parsed.detail
        : null;
      if (message?.trim()) return message.trim();
    } catch {
      // Not JSON after all; the raw text stands.
    }
  }

  return trimmed;
}

const QUOTA_PATTERN = /quota|rate limit|insufficient|billing|credit|usage limit/;

/**
 * Did the provider tell us the model itself is the problem?
 *
 * This is the one text match that survives, because no provider has a
 * structured field for it: the local runtime reports a missing binary, hosted
 * providers report an unknown model, and there is no shared vocabulary. It is
 * checked last so a structured signal always wins, and it resolves to the same
 * "model is not ready" copy the capability gate uses rather than inventing a
 * conversation-specific version of that state.
 */
const MODEL_UNAVAILABLE_PATTERN = /nobinaryfound|no model|model.*(not found|not loaded|missing|unavailable)|(?:invalid|not a valid|unknown) model(?: id)?|llama.*binary/;

/**
 * Clear a session that can no longer be used, and offer re-authentication.
 *
 * This is the effect half of a failure, and it belongs next to the decision
 * rather than beside each call site. Doing it only where someone remembered to
 * meant the next request could be made with a token the server had already
 * rejected, producing a second failure the user has to be told about again.
 */
function recoverDeadSession(classified: ProviderFailure, error: unknown): void {
  if (classified.requiresSignIn) {
    handleCloudSessionError(error, true);
  }
}

/**
 * Decide what a thrown value means.
 *
 * The provider matters for one case only. A rejected session is a sign-in
 * problem for the cloud provider, whose session we can recover, and a rejected
 * key is a settings problem for an openai-compatible endpoint, whose session
 * does not exist. The old ladders encoded that by checking `llmProvider` at
 * each call site, and two of the three forgot the branch entirely.
 */
export function classifyProviderFailure(error: unknown, provider: LLMProvider = 'builtin'): ProviderFailure {
  const code = getErrorString(error, 'code', 'error');
  const name = getErrorName(error);
  const status = getErrorStatus(error);
  const message = readProviderFailureMessage(error);
  const lowered = message.toLowerCase();

  // The learner stopped the sign-in flow. Nothing was attempted, so this is
  // checked first: it must never be read as a refusal.
  if (error instanceof CloudSessionCancelledError
    || code.includes('cloud_session_cancelled')
    || name === 'cloudsessioncancellederror') {
    return failure('signInCancelled');
  }

  // The transport layer already decided this one, from fields the caller
  // cannot see: a wrapped cause chain, a network error it normalised.
  if (error instanceof CloudUnreachableError
    || code.includes('cloud_unreachable')
    || name === 'cloudunreachableerror') {
    return failure('unreachable');
  }

  // An exhausted allowance arrives as a 429 from some providers and as a bare
  // string from others. Checked before authentication because a rate limit can
  // arrive carrying a 401 from a provider reusing that status.
  if (status === 429 || QUOTA_PATTERN.test(lowered)) {
    return failure('quotaExceeded');
  }

  // The session is invalid.
  if (isCloudSessionError(error)) {
    return provider === 'cloud' ? failure('signInRequired') : failure('credentialsRejected');
  }

  if (MODEL_UNAVAILABLE_PATTERN.test(lowered)) {
    return failure('notConfigured');
  }

  return failure('unknown');
}

/**
 * The one-line explanation for a failed provider operation.
 *
 * Surfaces that present a failure inline - a field error, a bubble in a
 * transcript - use this. An unrecognised failure is the one case where the
 * raw provider text beats a generic sentence, and the surfaces that offer a
 * "technical details" disclosure depend on it, so it is passed through rather
 * than discarded. The diagnostics are logged first either way.
 */
export function describeProviderFailure(
  error: unknown,
  t: Translate,
  provider: LLMProvider = 'builtin',
): string {
  const classified = classifyProviderFailure(error, provider);
  recoverDeadSession(classified, error);
  if (classified.id === 'unknown') {
    const message = readProviderFailureMessage(error);
    log.error('Unclassified provider failure', error);
    if (message) return message;
  }
  return t(classified.key);
}

/**
 * Report a failed provider operation as a toast.
 *
 * Returns the classification so a caller that has to make a control-flow
 * decision takes it from here instead of re-testing the error against its own
 * predicates.
 */
export function notifyProviderFailure(
  error: unknown,
  t: Translate,
  provider: LLMProvider = 'builtin',
): ProviderFailure {
  const classified = classifyProviderFailure(error, provider);
  recoverDeadSession(classified, error);
  log.error('Provider operation failed', error);
  if (classified.toast) {
    showToast({ message: t(classified.key), ...classified.toast });
  }
  return classified;
}

/**
 * Report a failure only if this operation produced nothing, and say whether it
 * did.
 *
 * This replaces the `handleCloudOperationFallback` helper that two copies of
 * `FlashcardContext` declared identically. Its old contract was "return true if
 * you should give up on this result", decided by which two error types the
 * local copy happened to recognise. That is the same question with the answer
 * written into the record, so a new failure mode now has to state its answer
 * rather than inherit it by omission.
 *
 * It returns the classification rather than a boolean so a caller can also ask
 * what happened; `null` means this failure is not one that leaves the operation
 * empty-handed, so the caller should keep handling it as it did.
 */
export function absorbProviderFailure(
  error: unknown,
  t: Translate,
  provider: LLMProvider = 'builtin',
): ProviderFailure | null {
  const classified = classifyProviderFailure(error, provider);
  if (!classified.yieldsNoResult) return null;
  recoverDeadSession(classified, error);
  if (classified.toast) {
    log.error('Provider operation failed', error);
    showToast({ message: t(classified.key), ...classified.toast });
  }
  return classified;
}

/**
 * Ask the configured provider whether it can be used right now.
 *
 * "Is the provider reachable" looked like a private detail of each surface that
 * needed it, and so four of them each wrote their own probe: the conversation
 * agent's connection effect, the two test buttons in AI settings, and
 * `llmProvider.checkAvailability`, which answered with a private vocabulary of
 * reason strings (`compatible_unreachable`, `auth_required`, `cloud_unreachable`,
 * `ollama_unreachable`, `model_not_downloaded`, `runtime_unavailable`,
 * `model_check_failed`) that nothing outside the file could interpret. Five
 * sites, one question, and no way for a caller to say *what* was wrong - so the
 * conversation agent could only render the word "Disconnected" and leave the
 * learner to guess, while the openai-compatible test button turned red and kept
 * its "Test connection" label, telling the user nothing at all.
 *
 * The answer is already owned: this module classifies provider failures. So the
 * probe returns a classification rather than a reason string, `null` when the
 * provider answered and is usable, and every surface presents that record in
 * its own idiom - a status chip, a button label, a toast.
 *
 * A probe that returns `false` rather than throwing is a reachable provider
 * declining, not a transport failure, so the two are told apart here: a false
 * from an openai-compatible endpoint means it answered and the key or model was
 * refused, whereas a `false` from a local runtime means it is simply not
 * running. The throw cases are classified by the same rules as any other
 * operation.
 */
export async function probeProvider(settings: Settings): Promise<ProviderFailure | null> {
  const provider = settings.llmProvider;
  try {
    switch (provider) {
      case 'openai-compatible': {
        const adapter = new OpenAICompatibleLLMAdapter(
          settings.compatibleApiBaseUrl,
          settings.compatibleApiKey,
          settings.compatibleModel,
        );
        // Reached the endpoint and it accepted us.
        if (await adapter.checkAvailability()) return null;
        // The adapter returns false for network failures and non-401 HTTP
        // errors. Only its thrown status error establishes rejected credentials.
        return failure('unreachable');
      }
      case 'cloud': {
        const accessToken = await ensureCloudAccessToken({
          interactive: false,
          openModalOnExpiry: false,
        });
        // No token without an exception: the user is not signed in, or the
        // refresh was declined non-interactively. Either way it is a sign-in
        // problem and the session has to be recovered.
        if (!accessToken) {
          // No token without an exception means the learner is not signed in
          // or a refresh was declined silently. Either way the stored session
          // is not usable and has to be cleared before the next request tries
          // it again.
          const classified = failure('signInRequired');
          recoverDeadSession(classified, new CloudSessionCancelledError());
          return classified;
        }
        const adapter = new CloudLLMAdapter(resolveCloudApiUrl(settings), accessToken);
        if (await adapter.checkAvailability()) return null;
        return failure('unreachable');
      }
      case 'ollama': {
        const connected = await getBridge().llm.ollamaCheck();
        return connected ? null : failure('unreachable');
      }
      case 'builtin': {
        // The built-in provider is not a network service: it is "is the model
        // file and the native runtime both there". Both halves resolve to the
        // same "the model is not ready" answer, because that is the one thing
        // the learner can act on, and it is the same state the capability gate
        // reports before the user ever tries.
        const status = await getBridge().llm.llmCheckModel(settings.builtinModel);
        if (status?.ready) return null;
        return failure('notConfigured');
      }
      default: {
        const exhaustive: never = provider;
        return exhaustive;
      }
    }
  } catch (error) {
    const classified = classifyProviderFailure(error, provider);
    recoverDeadSession(classified, error);
    return classified;
  }
}

/**
 * How a connection-test control should look for an outcome.
 *
 * Three provider sections in AI settings each had a test button whose colour
 * encoded the result, and each decided that independently. Only the *colour*
 * is shared, so that is all this expresses; the wording is the caller's, since
 * a chip and a button have different jobs.
 */
export function providerTestVariant(
  tested: boolean,
  classified: ProviderFailure | null,
): 'default' | 'success' | 'danger' {
  if (!tested) return 'default';
  return classified ? 'danger' : 'success';
}

/**
 * What a connection-test control should say for an outcome.
 *
 * `tested` is passed separately from the classification because "no failure"
 * is ambiguous on its own: before the first run it means *not yet known*, and
 * after a successful run it means *known good*. Collapsing the two is what let
 * a failed test keep reading "Test connection" - the failure existed, but the
 * label had no way to express it.
 */
export function providerTestLabel(
  tested: boolean,
  classified: ProviderFailure | null,
  t: Translate,
  successKey: string,
  idleKey: string,
): string {
  if (!tested) return t(idleKey);
  if (!classified) return t(successKey);
  return t(classified.key);
}
