/**
 * Tests for the canonical owner of "the AI provider operation failed".
 *
 * These protect the classification contract itself. The bugs this replaced
 * were not one wrong branch: they were six modules each deciding what a thrown
 * value meant, which had already produced a classifier that had silently lost
 * a code, three copies of the same predicate pair, and two ladders that
 * disagreed about the same error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const showToast = vi.fn();

vi.mock('../components/common/Feedback/Toast', () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));

// The probe reaches the same three boundaries the surfaces reached separately:
// the bridge for local runtimes, the adapters for hosted ones, and the session
// manager for cloud tokens. They are mocked here so the tests can state what
// each provider *answered*; what the probe does with the answer is the
// behaviour under test.
const bridge = {
  llm: {
    llmCheckModel: vi.fn(async () => ({ downloaded: true, ready: true })),
    ollamaCheck: vi.fn(async () => true),
  },
};

vi.mock('../../shared/bridges', () => ({
  getBridge: () => bridge,
}));

const adapterCheck = vi.fn(async () => true);

vi.mock('../../shared/backends/cloudLLMAdapter', () => ({
  CloudLLMAdapter: class {
    checkAvailability = adapterCheck;
  },
  OpenAICompatibleLLMAdapter: class {
    checkAvailability = adapterCheck;
  },
}));

vi.mock('../../shared/backends', () => ({
  resolveCloudApiUrl: () => 'https://api.example.com',
}));

const ensureToken = vi.fn(async () => 'token');

const clearCloudSession = vi.fn();

vi.mock('./cloudSessionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cloudSessionManager')>();
  return {
    ...actual,
    handleCloudSessionError: (error: unknown, openModal = true) => {
      clearCloudSession(error, openModal);
      return actual.isCloudSessionError(error);
    },
    ensureCloudAccessToken: (...args: unknown[]) => ensureToken(...(args as [])) as Promise<string | null>,
  };
});

const {
  absorbProviderFailure,
  classifyProviderFailure,
  describeProviderFailure,
  probeProvider,
  providerTestLabel,
  providerTestVariant,
  readProviderFailureMessage,
} = await import('./providerFailure');

const identity = (key: string) => key;

const settings = (overrides: Record<string, unknown> = {}) => ({
  llmProvider: 'builtin',
  llmEnabled: true,
  builtinModel: 'model.gguf',
  cloudAuthStatus: 'signed-in',
  compatibleApiBaseUrl: 'https://example.com/v1',
  compatibleApiKey: 'sk-test',
  compatibleModel: 'a-model',
  ...overrides,
}) as Parameters<typeof probeProvider>[0];

beforeEach(() => {
  showToast.mockClear();
  clearCloudSession.mockClear();
  adapterCheck.mockReset();
  adapterCheck.mockResolvedValue(true);
  ensureToken.mockReset();
  ensureToken.mockResolvedValue('token');
  bridge.llm.ollamaCheck.mockReset();
  bridge.llm.ollamaCheck.mockResolvedValue(true);
  bridge.llm.llmCheckModel.mockReset();
  bridge.llm.llmCheckModel.mockResolvedValue({ downloaded: true, ready: true });
});

it('reports a compatible endpoint network failure as unreachable', async () => {
  const { OpenAICompatibleLLMAdapter } = await vi.importActual<typeof import('../../shared/backends/cloudLLMAdapter')>('../../shared/backends/cloudLLMAdapter');
  const fetchStub = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  try {
    const adapter = new OpenAICompatibleLLMAdapter('https://example.com/v1', 'key', 'model');
    adapterCheck.mockResolvedValue(await adapter.checkAvailability());
    expect((await probeProvider(settings({ llmProvider: 'openai-compatible' })))?.id).toBe('unreachable');
  } finally {
    fetchStub.mockRestore();
  }
});

describe('classifyProviderFailure', () => {
  it('reports a cancelled sign-in as the learner stopping, not as a failure', () => {
    expect(classifyProviderFailure({ code: 'cloud_session_cancelled' }).id).toBe('signInCancelled');
    expect(classifyProviderFailure(new Error('x'), 'cloud').recovery).toBeDefined();
  });

  it('prefers the structured unreachable marker over any message text', () => {
    // The message mentions a model, which would otherwise read as a missing
    // model. A marker the transport layer raised outranks text matching.
    const error = Object.assign(new Error('model not found'), { code: 'cloud_unreachable' });
    expect(classifyProviderFailure(error).id).toBe('unreachable');
  });

  it('recognises the refresh-token code the stale classifier had lost', () => {
    // This is the regression that motivated the consolidation: the old
    // conversation-agent copy of the auth classifier had dropped
    // `invalid_refresh_token`, so this reported a generic failure.
    expect(classifyProviderFailure({ code: 'invalid_refresh_token' }, 'cloud').id).toBe('signInRequired');
    expect(classifyProviderFailure({ code: 'invalid_refresh_token' }, 'openai-compatible').id).toBe('credentialsRejected');
  });

  it('treats a spent allowance as quota even when it arrives as a 401', () => {
    // A provider reusing 401 for rate limiting must not be read as an auth
    // failure, which would send the learner to sign in again.
    expect(classifyProviderFailure({ status: 401, message: 'Rate limit exceeded' }).id).toBe('quotaExceeded');
    expect(classifyProviderFailure({ status: 429 }).id).toBe('quotaExceeded');
  });

  it('separates a recoverable cloud session from a rejected api key', () => {
    // Same error, different fix: only the cloud provider has a session to
    // recover. The old ladders encoded this per call site and one of the
    // three forgot the branch entirely.
    expect(classifyProviderFailure({ status: 403 }, 'cloud').id).toBe('signInRequired');
    expect(classifyProviderFailure({ status: 403 }, 'openai-compatible').id).toBe('credentialsRejected');
    expect(classifyProviderFailure({ status: 403 }, 'builtin').id).toBe('credentialsRejected');
  });

  it('reads a missing local model as a setup problem, not an unknown one', () => {
    expect(classifyProviderFailure(new Error('NoBinaryFoundError /private/runtime/lib')).id).toBe('notConfigured');
  });

  it('falls back to unknown without inventing a cause', () => {
    expect(classifyProviderFailure(new Error('something odd')).id).toBe('unknown');
  });
});

describe('readProviderFailureMessage', () => {
  it('prefers the readable field from a payload welded onto the message', () => {
    expect(readProviderFailureMessage('Cloud LLM error: 429 {"error":"You have run out of quota"}'))
      .toBe('You have run out of quota');
    expect(readProviderFailureMessage('{"detail":"Not found"}')).toBe('Not found');
  });

  it('leaves text alone when the payload says nothing or is malformed', () => {
    expect(readProviderFailureMessage('Cloud LLM error: 500 {"code":"unknown"}'))
      .toBe('Cloud LLM error: 500 {"code":"unknown"}');
    expect(readProviderFailureMessage('Cloud LLM error: 500 {broken')).toBe('Cloud LLM error: 500 {broken');
  });
});

describe('recovery', () => {
  const recoveryOf = (error: unknown, provider: 'builtin' | 'cloud' | 'openai-compatible' = 'cloud') =>
    classifyProviderFailure(error, provider).recovery;

  it('offers settings only when a setting can actually change the outcome', () => {
    // A connection that is down and a spent quota are not repaired by a
    // setting; sending the learner there to find nothing is worse than not
    // offering it.
    expect(recoveryOf({ code: 'cloud_unreachable' })).toBe('none');
    expect(recoveryOf({ status: 429 })).toBe('wait');
    expect(recoveryOf({ status: 401 })).toBe('settings');
    expect(recoveryOf({ status: 401 }, 'openai-compatible')).toBe('settings');
    expect(recoveryOf({ code: 'cloud_session_cancelled' })).toBe('retry');
  });

  it('gives every failure its own copy', () => {
    // One record per distinct failure the learner must act on differently, and
    // no two may share a message. A 401 and a rejected refresh token are
    // deliberately not listed as two: they are the same failure by two routes,
    // and collapsing them is the point.
    const records = [
      classifyProviderFailure({ code: 'cloud_session_cancelled' }, 'cloud'),
      classifyProviderFailure({ code: 'invalid_refresh_token' }, 'cloud'),
      classifyProviderFailure({ code: 'cloud_unreachable' }, 'cloud'),
      classifyProviderFailure({ status: 401 }, 'openai-compatible'),
      classifyProviderFailure({ status: 429 }, 'cloud'),
      classifyProviderFailure(new Error('NoBinaryFoundError'), 'cloud'),
      classifyProviderFailure(new Error('something odd'), 'cloud'),
    ];

    const byKey = new Map<string, string[]>();
    for (const classified of records) {
      byKey.set(classified.key, [...(byKey.get(classified.key) ?? []), classified.id]);
    }
    const shared = [...byKey.entries()].filter(([, ids]) => ids.length > 1);
    expect(shared).toEqual([]);
  });
});

describe('provider error envelopes', () => {
  it('extracts a nested error without exposing provider account metadata', () => {
    const error = new Error('Cloud LLM error: 400 {"error":{"message":"upstream said no","code":400},"user_id":"private-account"}');
    expect(describeProviderFailure(error, identity)).toBe('upstream said no');
  });

  it('offers model recovery for a rejected hosted model ID', () => {
    const error = new Error('Cloud LLM error: 400 {"error":{"message":"example/model is not a valid model ID","code":400},"user_id":"private-account"}');
    expect(classifyProviderFailure(error, 'openai-compatible').recovery).toBe('settings');
    expect(describeProviderFailure(error, identity, 'openai-compatible')).toBe('mlearn.ConversationAgent.Recovery.Model');
  });
});

describe('presentations', () => {
  it('clears a dead cloud session wherever the failure is reported', () => {
    // Doing this only where a surface remembered to meant the next request
    // could reuse a token the server had already rejected.
    describeProviderFailure({ code: 'invalid_refresh_token' }, identity, 'cloud');
    expect(clearCloudSession).toHaveBeenCalledTimes(1);
  });

  it('does not clear a session for a rejected api key', () => {
    describeProviderFailure({ status: 401 }, identity, 'openai-compatible');
    expect(clearCloudSession).not.toHaveBeenCalled();
  });

  it('passes an unrecognised provider message through rather than discarding it', () => {
    expect(describeProviderFailure(new Error('upstream said no'), identity)).toBe('upstream said no');
  });

  it('uses the classified copy for a recognised failure', () => {
    expect(describeProviderFailure({ status: 429 }, identity)).toBe('mlearn.AI.QuotaExceeded');
  });

  it('absorbs only failures that left the operation empty-handed', () => {
    // A card whose example sentence failed on quota is a card that exists but
    // is missing an example; one that failed because the request never left
    // the device is not the same thing to swallow.
    expect(absorbProviderFailure({ status: 401 }, identity, 'cloud')).not.toBeNull();
    expect(absorbProviderFailure({ status: 429 }, identity, 'cloud')).toBeNull();
    expect(absorbProviderFailure(new Error('unknown'), identity, 'cloud')).toBeNull();
  });

  it('does not toast a failure it does not absorb', () => {
    absorbProviderFailure({ status: 429 }, identity, 'cloud');
    expect(showToast).not.toHaveBeenCalled();
    absorbProviderFailure({ status: 401 }, identity, 'cloud');
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});

/**
 * The probe: "can this provider be used right now".
 *
 * This is the behaviour the conversation agent's connection effect, the two
 * test buttons in AI settings, and `llmProvider.checkAvailability` each used
 * to implement for themselves. The bug that motivated moving it here was not
 * that a probe was wrong - it was that a probe's *reason* was thrown away, so
 * the window could only render "Disconnected" and the openai-compatible test
 * button could only turn red while still reading "Test connection".
 */
describe('probeProvider', () => {
  it('reports a reachable provider as usable', async () => {
    adapterCheck.mockResolvedValue(true);
    await expect(probeProvider(settings({ llmProvider: 'openai-compatible' }))).resolves.toBeNull();
  });

  it('tells a refused endpoint apart from one that could not be reached', async () => {
    adapterCheck.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));
    const credentials = await probeProvider(settings({ llmProvider: 'openai-compatible' }));
    expect(credentials?.id).toBe('credentialsRejected');
    expect(credentials?.recovery).toBe('settings');
    adapterCheck.mockResolvedValue(false);
    const refused = await probeProvider(settings({ llmProvider: 'openai-compatible' }));
    expect(refused?.id).toBe('unreachable');
    expect(refused?.recovery).toBe('none');

    bridge.llm.ollamaCheck.mockResolvedValue(false);
    const dead = await probeProvider(settings({ llmProvider: 'ollama' }));
    expect(dead?.id).toBe('unreachable');
  });

  it('classifies a thrown probe failure rather than reporting it as unknown', async () => {
    adapterCheck.mockRejectedValue(Object.assign(new Error('nope'), { status: 429 }));
    const classified = await probeProvider(settings({ llmProvider: 'openai-compatible' }));
    expect(classified?.id).toBe('quotaExceeded');
  });

  it('treats a missing sign-in as a recoverable session, not a dead endpoint', async () => {
    ensureToken.mockResolvedValueOnce(null);
    const classified = await probeProvider(settings({ llmProvider: 'cloud' }));
    expect(classified?.id).toBe('signInRequired');
    expect(classified?.requiresSignIn).toBe(true);
  });

  it('reports an unready local model as a setup problem, matching the capability gate', async () => {
    bridge.llm.llmCheckModel.mockResolvedValue({ downloaded: false, ready: false });
    const classified = await probeProvider(settings({ llmProvider: 'builtin' }));
    expect(classified?.id).toBe('notConfigured');
  });

  it('never throws, because every caller treats this as a question not an operation', async () => {
    bridge.llm.ollamaCheck.mockRejectedValue(new Error('ipc died'));
    await expect(probeProvider(settings({ llmProvider: 'ollama' }))).resolves.not.toThrow();
  });
});

describe('connection-test presentation', () => {
  it('distinguishes "not yet tested" from "tested and fine"', () => {
    // The exact confusion that let a failed test keep its idle label: a null
    // classification on its own cannot tell those apart.
    expect(providerTestVariant(false, null)).toBe('default');
    expect(providerTestVariant(true, null)).toBe('success');
    expect(providerTestLabel(false, null, identity, 'ok', 'idle')).toBe('idle');
    expect(providerTestLabel(true, null, identity, 'ok', 'idle')).toBe('ok');
  });

  it('labels a failed test with the reason it failed', () => {
    const failed = classifyProviderFailure({ status: 401 }, 'openai-compatible');
    expect(providerTestVariant(true, failed)).toBe('danger');
    expect(providerTestLabel(true, failed, identity, 'ok', 'idle')).toBe(failed.key);
    expect(providerTestLabel(true, failed, identity, 'ok', 'idle'))
      .not.toBe('idle');
  });
});
