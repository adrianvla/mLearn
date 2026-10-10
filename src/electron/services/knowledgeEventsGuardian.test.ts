import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir } from '../../../test/helpers/tempDir';
import type { TempDir } from '../../../test/helpers/tempDir';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';

let tempDir: TempDir;
const ipcHandle = vi.fn();
const getAllWindows = vi.fn();
let mod: typeof import('./knowledgeEvents');

vi.mock('electron', () => ({
  ipcMain: { handle: ipcHandle, on: vi.fn() },
  BrowserWindow: { getAllWindows },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir ?? '/tmp/test'),
}));

vi.mock('../../shared/utils/logger', () => ({
  getLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const now = Date.UTC(2026, 7, 15, 12);

function event(t: number): KnowledgeEvent {
  return {
    t,
    kind: 'rollup',
    source: 'passiveTracking',
    aspect: 'meaning',
    timesSeenDelta: 1,
    eventId: 'same-observation',
  };
}

beforeEach(async () => {
  tempDir = createTempDir();
  ipcHandle.mockReset();
  getAllWindows.mockReset().mockReturnValue([]);
  vi.resetModules();
  mod = await import('./knowledgeEvents');
});

afterEach(() => {
  tempDir.cleanup();
});

describe('knowledge events with Guardian', () => {
  it('counts only inserted evidence and does not notify windows for an idempotent retry', async () => {
    const { Guardian, activateGuardian, inspectGuardianData } = await import('./guardian');
    const guardian = new Guardian(tempDir.tmpDir);
    await guardian.preflight();
    activateGuardian(guardian);
    await mod.loadKnowledgeEvents(now);

    const send = vi.fn();
    getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send } }]);
    const batch: KnowledgeEventLog = { 'pkg:one': [event(now)] };
    await mod.appendKnowledgeEvents(batch);
    await mod.appendKnowledgeEvents(batch);

    expect(guardian.status.metrics?.knowledgeEvidenceCount).toBe(inspectGuardianData(tempDir.tmpDir).knowledgeEvidenceCount);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(new Guardian(tempDir.tmpDir).preflight()).resolves.toBeUndefined();
  });
});
