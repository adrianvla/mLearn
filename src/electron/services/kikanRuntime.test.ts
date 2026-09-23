import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeKikanRuntime, recordOperationalEvent, runtimeUpdatePolicy } from './kikanRuntime';

const state = vi.hoisted(() => ({
  optIn: false,
  evaluation: {
    switches: {} as Record<string, boolean>, experiments: {} as Record<string, string>, patches: [], sequence: 1,
    telemetry: { endpoint: 'https://runtime.example/telemetry', samplePercent: 100 },
    update: undefined as undefined | { autoCheck: boolean; targetVersion: string; allowReleaseRollback: boolean; maxDataSchema: number; feedUrl: string },
  },
}));

vi.mock('electron', () => ({ app: { getVersion: () => '2.9.11' } }));
vi.mock('../utils/platform', () => ({ getUserDataPath: () => '/tmp/runtime-test' }));
vi.mock('./settings', () => ({ loadSettings: () => ({ operationalTelemetryEnabled: state.optIn }) }));
vi.mock('../kikanRuntime/client', () => ({
  RuntimeClient: class {
    context = { installationId: 'private-installation-id' };
    evaluation() { return state.evaluation; }
  },
}));

beforeEach(() => {
  state.optIn = false;
  state.evaluation.update = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  initializeKikanRuntime();
});
afterEach(() => vi.unstubAllGlobals());

describe('mLearn runtime adapter', () => {
  it('keeps diagnostics opt-in and sends only bounded operational fields', () => {
    recordOperationalEvent('process_crash', new Error('private learner sentence and token'));
    expect(fetch).not.toHaveBeenCalled();
    state.optIn = true;
    recordOperationalEvent('process_crash', new Error('private learner sentence and token'));
    expect(fetch).toHaveBeenCalledOnce();
    const [endpoint, request] = vi.mocked(fetch).mock.calls[0];
    expect(endpoint).toBe('https://runtime.example/telemetry');
    const body = JSON.parse(request!.body as string);
    expect(Object.keys(body).sort()).toEqual(['event', 'fingerprint', 'platform', 'version']);
    expect(JSON.stringify(body)).not.toMatch(/private learner|token|private-installation-id/);
  });

  it('maps a signed rollback decision to the native updater policy', () => {
    state.evaluation.update = { autoCheck: true, targetVersion: '2.8.0', allowReleaseRollback: true,
      maxDataSchema: 3, feedUrl: 'https://runtime.example/rollbacks/2.8.0/' };
    expect(runtimeUpdatePolicy()).toEqual({ autoCheck: true, targetVersion: '2.8.0', allowDowngrade: true,
      feedUrl: 'https://runtime.example/rollbacks/2.8.0/' });
  });
});
