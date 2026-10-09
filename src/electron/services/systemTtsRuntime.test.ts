import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('child_process', () => ({ execFile: calls.exec }));
import { ensureSystemTtsRuntimeReady, systemVoiceForRuntime } from './systemTtsRuntime';

describe('candidate package native speech readiness', () => {
  beforeEach(() => { calls.exec.mockReset(); });
  it('enumerates the exact declared macOS voice without speaking', async () => {
    calls.exec.mockImplementation((_command, _args, _options, done) => done(null, 'Package Voice       xx_YY    # diagnostic\nOther Voice          zz_ZZ    # unrelated'));
    await ensureSystemTtsRuntimeReady({ macosVoice: 'Package Voice' }, 'darwin');
    expect(calls.exec).toHaveBeenCalledWith('say', ['-v', '?'], { encoding: 'utf8' }, expect.any(Function));
  });
  it('does not infer desktop support from a browser language declaration', async () => {
    await expect(ensureSystemTtsRuntimeReady({ webSpeechLang: 'xx-YY' }, 'darwin')).rejects.toThrow('System TTS voice');
    expect(calls.exec).not.toHaveBeenCalled();
  });
  it('rejects a declared voice absent from the native enumeration', async () => {
    calls.exec.mockImplementation((_command, _args, _options, done) => done(null, 'Other Voice          xx_YY    # unrelated'));
    await expect(ensureSystemTtsRuntimeReady({ macosVoice: 'Package Voice' }, 'darwin')).rejects.toThrow('unavailable');
  });
  it('propagates unavailable native executable instead of admitting readiness', async () => {
    calls.exec.mockImplementation((_command, _args, _options, done) => done(Object.assign(new Error('missing'), { code: 'ENOENT' }), ''));
    await expect(ensureSystemTtsRuntimeReady({ macosVoice: 'Package Voice' }, 'darwin')).rejects.toThrow('missing');
  });
  it('uses a declared Linux voice with the existing executable fallback', async () => {
    calls.exec.mockImplementationOnce((_command, _args, _options, done) => done(Object.assign(new Error('missing'), { code: 'ENOENT' }), ''))
      .mockImplementationOnce((_command, _args, _options, done) => done(null, ' 5 xx M packagevoice xx\n'));
    await ensureSystemTtsRuntimeReady({ espeakVoice: 'packagevoice' }, 'linux');
    expect(calls.exec.mock.calls.map(call => call[0])).toEqual(['espeak-ng', 'espeak']);
  });
  it('preserves a declared platform voice independently of the package language ID', () => {
    expect(systemVoiceForRuntime({ windowsVoice: 'Package Native Voice' }, 'win32')).toBe('Package Native Voice');
  });
});
