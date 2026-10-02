import { describe, expect, it, vi } from 'vitest';
import { excludeWordFromStudy } from './excludeWordFromStudy';
import { showToast } from '../../components/common/Feedback/Toast';
vi.mock('../../components/common/Feedback/Toast', () => ({ showToast: vi.fn() }));
const makeDeps = () => ({
  getCardCount: vi.fn(() => 2),
  showConfirm: vi.fn(async () => true),
  ignoreWordForLanguage: vi.fn(async (_word: string, _reading?: string, _language?: string) => {}),
  t: (key: string) => key,
});
describe('shared reversible study exclusion', () => {
  it('saves the requested package preference without a deletion warning', async () => {
    const deps = makeDeps();
    expect(await excludeWordFromStudy({ word: 'target', reading: 'form', language: 'package-x' }, deps)).toBe(true);
    expect(deps.ignoreWordForLanguage).toHaveBeenCalledWith('target', 'form', 'package-x');
    expect(deps.showConfirm).not.toHaveBeenCalled();
    expect(deps.getCardCount).not.toHaveBeenCalled();
  });
  it('does not report completion before the save acknowledgement', async () => {
    let accept!: () => void;
    const deps = makeDeps();
    deps.ignoreWordForLanguage.mockImplementation(() => new Promise<void>(resolve => { accept = resolve; }));
    const completed = vi.fn();
    const pending = excludeWordFromStudy({ word: 'target', language: 'package-x' }, deps).then(completed);
    await Promise.resolve(); await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    accept(); await pending;
    expect(completed).toHaveBeenCalledWith(true);
  });
  it('reports a refused preference save and leaves the caller able to retry', async () => {
    const deps = makeDeps();
    deps.ignoreWordForLanguage.mockRejectedValueOnce(new Error('disk full'));
    expect(await excludeWordFromStudy({ word: 'target', language: 'package-x' }, deps)).toBe(false);
    expect(showToast).toHaveBeenCalledWith({ message: 'mlearn.Knowledge.StudyPreferenceSaveFailed', variant: 'error' });
    expect(await excludeWordFromStudy({ word: 'target', language: 'package-x' }, deps)).toBe(true);
  });
});
