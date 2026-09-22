import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStartupFailure } from './startupFailure';

const mocks = vi.hoisted(() => ({
  showErrorBox: vi.fn(),
  quit: vi.fn(),
  error: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { quit: mocks.quit },
  dialog: { showErrorBox: mocks.showErrorBox },
}));
vi.mock('../utils/platform', () => ({ getUserDataPath: () => '/profiles/current' }));
vi.mock('../../shared/utils/logger', () => ({ getLogger: () => ({ error: mocks.error }) }));

beforeEach(() => vi.clearAllMocks());

describe('startup failure boundary', () => {
  it('makes failed startup actionable and quits only after presenting the error', async () => {
    const failure = new Error('world.json rooms must be an array');
    mocks.showErrorBox.mockImplementationOnce(() => expect(mocks.quit).not.toHaveBeenCalled());
    await Promise.reject(failure).catch(handleStartupFailure);
    expect(mocks.error).toHaveBeenCalledWith('Application initialization failed', failure);
    expect(mocks.showErrorBox).toHaveBeenCalledWith(
      'mLearn could not start',
      expect.stringContaining('/profiles/current'),
    );
    const message = mocks.showErrorBox.mock.calls[0][1] as string;
    expect(message).toContain(failure.message);
    expect(message).toMatch(/back up/i);
    expect(message).toMatch(/not.*reset/i);
    expect(mocks.quit).toHaveBeenCalledOnce();
  });

  it('still quits if the error dialog cannot be displayed', () => {
    const displayFailure = new Error('Display unavailable');
    mocks.showErrorBox.mockImplementationOnce(() => { throw displayFailure; });
    expect(() => handleStartupFailure(new Error('Read failed'))).not.toThrow();
    expect(mocks.error).toHaveBeenCalledWith('Failed to display startup error', displayFailure);
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
});
