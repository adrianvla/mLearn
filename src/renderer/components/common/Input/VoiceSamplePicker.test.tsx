// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { VoiceTtsAudio, VoiceTtsStatus } from '../../../../shared/types';
import { VoiceSamplePicker } from './VoiceSamplePicker';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), stop: vi.fn(), auth: vi.fn() }));
let audioHandler: ((audio: VoiceTtsAudio) => void) | undefined;
let statusHandler: ((status: VoiceTtsStatus) => void) | undefined;
vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { language: 'test-language' } }),
}));
vi.mock('../../../services/cloudSessionManager', () => ({ withCloudAuth: mocks.auth }));
vi.mock('../../../../shared/bridges', () => ({ getBridge: () => ({ voice: {
  voiceSampleList: vi.fn(async () => []), voiceTtsGenerate: mocks.generate, voiceTtsStop: mocks.stop,
  onVoiceTtsAudio: (handler: typeof audioHandler) => { audioHandler = handler; return () => undefined; },
  onVoiceTtsStatus: (handler: typeof statusHandler) => { statusHandler = handler; return () => undefined; },
} }) }));

describe('VoiceSamplePicker request ownership', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;
  const button = () => container.querySelector<HTMLButtonElement>('button[aria-label$="TestTts"]')!;
  const input = () => container.querySelector<HTMLInputElement>('.voice-sample-picker-tts-test input')!;
  const mount = async (provider = 'kokoro') => {
    dispose = render(() => <VoiceSamplePicker value="" onChange={() => undefined} ttsProvider={provider} />, container);
    await vi.waitFor(() => expect(statusHandler).toBeDefined());
    input().value = 'A fresh preview.';
    input().dispatchEvent(new Event('input', { bubbles: true }));
  };
  beforeEach(() => {
    vi.clearAllMocks(); audioHandler = undefined; statusHandler = undefined;
    container = document.createElement('div'); document.body.appendChild(container);
  });
  afterEach(() => { dispose?.(); dispose = undefined; container.remove(); vi.unstubAllGlobals(); });

  it('does not stop an unrelated call when an unused picker unmounts', async () => {
    await mount(); dispose!(); dispose = undefined;
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('allows cancellation during generation and rejects stale preview events after retry', async () => {
    const audioContext = vi.fn(); vi.stubGlobal('AudioContext', audioContext);
    await mount(); button().click();
    const first = mocks.generate.mock.calls[0][6];
    expect(button().disabled).toBe(false);
    button().click();
    expect(mocks.stop).toHaveBeenCalledWith(first);
    button().click();
    const second = mocks.generate.mock.calls[1][6];
    expect(second.requestId).not.toBe(first.requestId);
    statusHandler!({ ...first, generating: false, error: 'obsolete failure' });
    audioHandler!({ ...first, samples: [1], sampleRate: 16000 });
    statusHandler!({ generating: false, playing: false });
    expect(input().disabled).toBe(true);
    expect(audioContext).not.toHaveBeenCalled();
    statusHandler!({ ...second, generating: false });
    expect(input().disabled).toBe(false);
  });

  it('cannot resurrect a cancelled cloud preview after authentication resolves', async () => {
    let authorize: (() => Promise<void>) | undefined;
    mocks.auth.mockImplementation((callback: (token: string) => Promise<void>) => new Promise<void>(resolve => {
      authorize = async () => { await callback('synthetic-token'); resolve(); };
    }));
    await mount('cloud'); button().click(); button().click();
    await authorize!();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(input().disabled).toBe(false);
  });

  it('shows an owned synthesis error and releases the preview controls', async () => {
    await mount(); button().click();
    statusHandler!({ ...mocks.generate.mock.calls[0][6], generating: false, error: 'Voice model unavailable' });
    expect(container.textContent).toContain('Voice model unavailable');
    expect(input().disabled).toBe(false);
  });

  it('does not let a queued old playback callback drain a successor preview', async () => {
    const sources: Array<{ onended: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('AudioContext', class {
      destination = {};
      close = vi.fn();
      createBuffer = () => ({ getChannelData: () => new Float32Array(1) });
      createBufferSource = () => {
        const source = { onended: null, start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn() };
        sources.push(source); return source;
      };
    });
    await mount(); button().click();
    const first = mocks.generate.mock.calls[0][6];
    audioHandler!({ ...first, samples: [1], sampleRate: 16000 });
    const oldEnded = sources[0].onended!;
    button().click(); button().click();
    const second = mocks.generate.mock.calls[1][6];
    audioHandler!({ ...second, samples: [1], sampleRate: 16000 });
    audioHandler!({ ...second, samples: [1], sampleRate: 16000 });
    oldEnded();
    expect(sources).toHaveLength(2);
    sources[1].onended!();
    expect(sources).toHaveLength(3);
    expect(sources[2].start).toHaveBeenCalledTimes(1);
  });
});
