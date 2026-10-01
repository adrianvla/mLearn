// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import type { ConversationMessage, VoiceTtsAudio, VoiceTtsRequestIdentity } from '../../../shared/types';

const cleanup = () => undefined;

it('loads the packaged microphone worklet from dist before using a blob fallback', async () => {
  const { loadAudioWorkletModule } = await import('./VoiceTab');
  const addModule = vi.fn().mockRejectedValueOnce(new Error('file worklet blocked')).mockResolvedValue(undefined);
  const fetchModule = vi.fn().mockResolvedValue({ text: async () => 'registerProcessor("audio-processor", class {});' });
  vi.stubGlobal('fetch', fetchModule);
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:worklet');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  await loadAudioWorkletModule({ audioWorklet: { addModule } } as unknown as AudioContext,
    'file:///QA/mLearn.app/Contents/Resources/app.asar/dist/src/html/conversation-agent.html');
  const packagedUrl = 'file:///QA/mLearn.app/Contents/Resources/app.asar/dist/audio-processor.js';
  expect(addModule).toHaveBeenNthCalledWith(1, packagedUrl);
  expect(fetchModule).toHaveBeenCalledWith(packagedUrl);
  expect(addModule).toHaveBeenNthCalledWith(2, 'blob:worklet');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:worklet');
  createObjectURL.mockRestore();
  revokeObjectURL.mockRestore();
  vi.unstubAllGlobals();
}, 20000);

const CPU_WARNING_TEXT = 'Realtime voice may lag because speech is running on the CPU. Voice quality is unaffected.';

const translations: Record<string, string> = {
  'mlearn.ConversationAgent.Voice.CheckingModels': 'Checking local voice models…',
  'mlearn.ConversationAgent.Voice.DownloadModels': 'Download Voice Models',
  'mlearn.ConversationAgent.Voice.ModelsRequired': 'Voice models are required for this feature.',
  'mlearn.ConversationAgent.Voice.DownloadFailed': 'Failed to download voice models.',
  'mlearn.ConversationAgent.Voice.StartCall': 'Start voice call',
  'mlearn.ConversationAgent.Voice.CpuWarning': CPU_WARNING_TEXT,
  'mlearn.ConversationAgent.Voice.Advanced': 'Advanced',
  'mlearn.ConversationAgent.Voice.CallView': 'Call view',
  'mlearn.ConversationAgent.Voice.HandsFree': 'Hands-Free',
  'mlearn.ConversationAgent.Voice.PushToTalk': 'Push to Talk',
  'mlearn.ConversationAgent.Voice.EndCall': 'End call',
  'mlearn.ConversationAgent.Voice.TtsProvider': 'Voice',
  'mlearn.ConversationAgent.Voice.Microphone': 'Microphone',
  'mlearn.ConversationAgent.Voice.DefaultMicrophone': 'Default microphone',
  'mlearn.ConversationAgent.Voice.MicPermission': 'Microphone access was denied. Allow microphone access in system settings.',
};

/** Compute hints the voice status IPC payloads carry (contract: device/cpuWarning). */
type VoiceDeviceStatus = {
  device?: 'cuda' | 'mps' | 'cpu';
  cpuWarning?: boolean;
};
type TestTtsStatus = VoiceDeviceStatus & Partial<VoiceTtsRequestIdentity> & { generating?: boolean; playing?: boolean; error?: string };
type TestModelStatus = VoiceDeviceStatus & {
  sttDownloaded: boolean;
  ttsDownloaded: boolean;
  vadDownloaded: boolean;
  downloading: boolean;
  progress: number;
};

let modelProgressHandler: ((status: TestModelStatus) => void) | undefined;
let ttsStatusHandler: ((status: TestTtsStatus) => void) | undefined;
let sessionReadyHandler: (() => void) | undefined;
let sessionErrorHandler: ((data: { error: string }) => void) | undefined;
let ttsAudioHandler: ((audio: VoiceTtsAudio) => void) | undefined;

const testSettings = {
  ttsProvider: 'kokoro' as const,
  voiceMode: 'vad' as 'vad' | 'push-to-talk',
  voiceTtsSpeed: 1.0,
  voiceSilenceThreshold: 0.8,
};

const readyModels: TestModelStatus = {
  sttDownloaded: true,
  ttsDownloaded: true,
  vadDownloaded: true,
  downloading: false,
  progress: 1,
};
const mockVoiceFlush = vi.fn();
const mockTtsGenerate = vi.fn();
const mockTtsStop = vi.fn();
const mockRequestAccess = vi.fn().mockResolvedValue(true);

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: testSettings, updateSettings: vi.fn() }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const translation = translations[key] ?? key;
      return translation.replace(/\{(\w+)\}/g, (_, name: string) => (
        params?.[name] === undefined ? `{${name}}` : String(params[name])
      ));
    },
  }),
  useLowPowerGate: () => ({ requestAccess: mockRequestAccess }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    voice: {
      voiceCheckModels: vi.fn().mockResolvedValue(readyModels),
      onVoiceModelProgress: vi.fn((callback: typeof modelProgressHandler) => {
        modelProgressHandler = callback;
        return cleanup;
      }),
      onVoiceSttResult: vi.fn(() => cleanup),
      onVoiceVadEvent: vi.fn(() => cleanup),
      onVoiceTtsAudio: vi.fn((callback: typeof ttsAudioHandler) => { ttsAudioHandler = callback; return cleanup; }),
      onVoiceTtsStatus: vi.fn((callback: typeof ttsStatusHandler) => {
        ttsStatusHandler = callback;
        return cleanup;
      }),
      onVoiceSessionReady: vi.fn((callback: typeof sessionReadyHandler) => {
        sessionReadyHandler = callback;
        return cleanup;
      }),
      onVoiceSessionStatus: vi.fn(() => cleanup),
      onVoiceSessionError: vi.fn((callback: typeof sessionErrorHandler) => { sessionErrorHandler = callback; return cleanup; }),
      voiceSendTtsState: vi.fn(),
      voiceStartSession: vi.fn(),
      voiceStopSession: vi.fn(),
      voiceTtsStop: mockTtsStop,
      voiceTtsGenerate: mockTtsGenerate,
      voiceFlush: mockVoiceFlush,
    },
  }),
}));

vi.mock('../../components/common/Feedback/Toast', () => ({ showToast: vi.fn() }));

describe('VoiceTab CPU warning banner', () => {
  let container: HTMLDivElement;

  const mountVoiceTab = async (): Promise<() => void> => {
    const { VoiceTab } = await import('./VoiceTab');
    const dispose = render(() => (
      <VoiceTab
        messages={[]}
        isStreaming={false}
        onSendMessage={vi.fn()}
        onAbort={vi.fn()}
        isConnected={true}
        language="ja"
        onRequestGreeting={vi.fn()}
      />
    ), container);
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Start voice call');
    });
    return dispose;
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    modelProgressHandler = undefined;
    ttsStatusHandler = undefined;
    sessionReadyHandler = undefined;
    sessionErrorHandler = undefined;
    testSettings.voiceMode = 'vad';
    mockVoiceFlush.mockClear();
    mockTtsGenerate.mockClear(); mockTtsStop.mockClear(); mockRequestAccess.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    container.remove();
  });

  it('passes a session failure to the parent before it can remove the error banner', async () => {
    const { VoiceTab } = await import('./VoiceTab');
    const onCallStateChange = vi.fn();
    const dispose = render(() => <VoiceTab messages={[]} isStreaming={false} onSendMessage={vi.fn()}
      onAbort={vi.fn()} isConnected language="ja" onRequestGreeting={vi.fn()} onCallStateChange={onCallStateChange} />, container);
    await vi.waitFor(() => expect(sessionErrorHandler).toBeDefined());
    sessionErrorHandler!({ error: 'No module named kokoro' });
    expect(onCallStateChange).toHaveBeenCalledWith(false, 'failed', 'No module named kokoro');
    dispose();
  }, 20000);

  it('does not acquire a microphone or request a greeting when initialization fails', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      enumerateDevices: vi.fn(async () => []), getUserMedia,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } });
    const { VoiceTab } = await import('./VoiceTab');
    const greeting = vi.fn();
    const dispose = render(() => <VoiceTab autoStartCall messages={[]} isStreaming={false} onSendMessage={vi.fn()}
      onAbort={vi.fn()} isConnected language="ja" onRequestGreeting={greeting} />, container);
    await vi.waitFor(() => expect(sessionErrorHandler).toBeDefined());
    sessionErrorHandler!({ error: 'No module named kokoro' });
    expect(greeting).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    dispose();
  }, 20000);

  it('aborts the active response when the user ends the call', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      enumerateDevices: vi.fn(async () => []),
      getUserMedia: vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError'); }),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } });
    const { VoiceTab } = await import('./VoiceTab');
    const onAbort = vi.fn();
    const onCallStateChange = vi.fn();
    const dispose = render(() => <VoiceTab autoStartCall messages={[]} isStreaming
      onSendMessage={vi.fn()} onAbort={onAbort} isConnected language="ja"
      onRequestGreeting={vi.fn()} onCallStateChange={onCallStateChange} />, container);
    await vi.waitFor(() => expect(onCallStateChange).toHaveBeenCalledWith(true));
    sessionReadyHandler?.();
    const end = container.querySelector<HTMLButtonElement>('button[aria-label="End call"], button[title="End call"]');
    expect(end).toBeDefined();
    end!.click();
    expect(onAbort).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('hides the CPU warning while voice statuses carry no compute hints', async () => {
    const dispose = await mountVoiceTab();

    ttsStatusHandler?.({ generating: false, playing: false });
    modelProgressHandler?.(readyModels);

    expect(container.textContent).not.toContain('Realtime voice may lag');

    dispose();
  });

  it('ignores CPU warnings from unrelated TTS requests', async () => {
    const dispose = await mountVoiceTab();

    ttsStatusHandler?.({ generating: false, playing: false, cpuWarning: true });

    expect(container.textContent).not.toContain('Realtime voice may lag');

    dispose();
  });

  it('rejects a retired phrase completion and audio while its successor owns generation', async () => {
    const { VoiceTab } = await import('./VoiceTab');
    const [messages, setMessages] = createSignal<ConversationMessage[]>([]);
    const audioContext = vi.fn(); vi.stubGlobal('AudioContext', audioContext);
    const dispose = render(() => <VoiceTab autoStartCall messages={messages()} isStreaming={false}
      onSendMessage={vi.fn()} onAbort={vi.fn()} isConnected language="test-language" onRequestGreeting={vi.fn()} />, container);
    await vi.waitFor(() => expect(sessionReadyHandler).toBeDefined());
    setMessages([{ role: 'assistant', content: 'First phrase. Second phrase. Third phrase.', timestamp: 1 }]);
    await vi.waitFor(() => expect(mockTtsGenerate).toHaveBeenCalledTimes(1));
    const first = mockTtsGenerate.mock.calls[0][6];
    expect(first).toEqual(expect.objectContaining({ sessionId: expect.any(String), requestId: expect.any(String) }));
    ttsStatusHandler!({ ...first, generating: false });
    await vi.waitFor(() => expect(mockTtsGenerate).toHaveBeenCalledTimes(2));
    const second = mockTtsGenerate.mock.calls[1][6];
    ttsStatusHandler!({ ...first, generating: false });
    ttsAudioHandler!({ ...first, samples: [1], sampleRate: 16000 });
    ttsStatusHandler!({ generating: false, cpuWarning: true });
    await Promise.resolve();
    expect(mockTtsGenerate).toHaveBeenCalledTimes(2);
    expect(audioContext).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Realtime voice may lag');
    ttsStatusHandler!({ ...second, generating: true, cpuWarning: true });
    expect(container.textContent).toContain('Realtime voice may lag');
    ttsStatusHandler!({ ...second, generating: false });
    await vi.waitFor(() => expect(mockTtsGenerate).toHaveBeenCalledTimes(3));
    dispose(); vi.unstubAllGlobals();
  });

  it('does not let a stale access denial release a newer phrase request', async () => {
    let denyFirst: ((allowed: boolean) => void) | undefined;
    mockRequestAccess.mockImplementationOnce(() => new Promise<boolean>(resolve => { denyFirst = resolve; }));
    const { VoiceTab } = await import('./VoiceTab');
    const [messages, setMessages] = createSignal<ConversationMessage[]>([]);
    const dispose = render(() => <VoiceTab autoStartCall messages={messages()} isStreaming={false}
      onSendMessage={vi.fn()} onAbort={vi.fn()} isConnected language="test-language" onRequestGreeting={vi.fn()} />, container);
    await vi.waitFor(() => expect(sessionReadyHandler).toBeDefined());
    setMessages([{ role: 'assistant', content: 'Obsolete phrase.', timestamp: 1 }]);
    await vi.waitFor(() => expect(denyFirst).toBeDefined());
    setMessages(previous => [...previous, { role: 'assistant', content: 'Successor phrase. Following phrase.', timestamp: 2 }]);
    await vi.waitFor(() => expect(mockTtsGenerate).toHaveBeenCalledTimes(1));
    const successor = mockTtsGenerate.mock.calls[0][6];
    denyFirst!(false); await Promise.resolve();
    setMessages(previous => previous.map((message, i) => i === 1 ? { ...message, content: message.content + ' Another phrase.' } : message));
    await Promise.resolve();
    expect(mockTtsGenerate).toHaveBeenCalledTimes(1);
    dispose();
    expect(mockTtsStop).toHaveBeenLastCalledWith(successor);
  });

  it('does not retry into another consumer when its owned phrase is replaced', async () => {
    const { VoiceTab } = await import('./VoiceTab');
    const [messages, setMessages] = createSignal<ConversationMessage[]>([]);
    const dispose = render(() => <VoiceTab autoStartCall messages={messages()} isStreaming={false}
      onSendMessage={vi.fn()} onAbort={vi.fn()} isConnected language="test-language" onRequestGreeting={vi.fn()} />, container);
    await vi.waitFor(() => expect(sessionReadyHandler).toBeDefined());
    setMessages([{ role: 'assistant', content: 'First phrase. Following phrase.', timestamp: 1 }]);
    await vi.waitFor(() => expect(mockTtsGenerate).toHaveBeenCalledTimes(1));
    const request = mockTtsGenerate.mock.calls[0][6];
    ttsStatusHandler!({ ...request, generating: false, error: 'Speech stopped because another speech request started.' });
    await Promise.resolve();
    expect(mockTtsGenerate).toHaveBeenCalledTimes(1);
    expect(mockTtsStop).toHaveBeenCalledWith(request);
    dispose();
  });

  it('shows the CPU warning for device cpu and clears it on mps', async () => {
    const dispose = await mountVoiceTab();

    modelProgressHandler?.({ ...readyModels, device: 'cpu' });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Realtime voice may lag');
    });

    // Statuses without compute hints never clear the warning
    ttsStatusHandler?.({ generating: false, playing: false });
    expect(container.textContent).toContain('Realtime voice may lag');

    modelProgressHandler?.({ ...readyModels, device: 'mps' });
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain('Realtime voice may lag');
    });

    dispose();
  });

  it('releases acquired tracks and context when worklet initialization fails', async () => {
    const stop = vi.fn();
    const close = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      enumerateDevices: vi.fn(async () => []),
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } });
    vi.stubGlobal('AudioContext', class {
      close = close;
      audioWorklet = { addModule: vi.fn().mockRejectedValue(new Error('worklet unavailable')) };
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('asset unavailable')));
    const { VoiceTab } = await import('./VoiceTab');
    const onCallStateChange = vi.fn();
    const dispose = render(() => <VoiceTab autoStartCall messages={[]} isStreaming={false}
      onSendMessage={vi.fn()} onAbort={vi.fn()} isConnected language="ja"
      onRequestGreeting={vi.fn()} onCallStateChange={onCallStateChange} />, container);
    await vi.waitFor(() => expect(onCallStateChange).toHaveBeenCalledWith(true));
    sessionReadyHandler?.();
    await vi.waitFor(() => expect(container.textContent).toContain('Microphone access was denied'));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    dispose();
    vi.unstubAllGlobals();
  });

  it('shows a recoverable error when microphone permission is denied after explicit call start', async () => {
    const mediaDevices = {
      enumerateDevices: vi.fn(async () => []),
      getUserMedia: vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError'); }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    const { VoiceTab } = await import('./VoiceTab');
    const onCallStateChange = vi.fn();
    const dispose = render(() => (
      <VoiceTab
        autoStartCall
        messages={[]}
        isStreaming={false}
        onSendMessage={vi.fn()}
        onAbort={vi.fn()}
        isConnected={true}
        language="ja"
        onRequestGreeting={vi.fn()}
        onCallStateChange={onCallStateChange}
      />
    ), container);
    await vi.waitFor(() => expect(onCallStateChange).toHaveBeenCalledWith(true));
    sessionReadyHandler?.();
    await vi.waitFor(() => expect(container.textContent).toContain('Microphone access was denied'));
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(onCallStateChange).not.toHaveBeenCalledWith(false, expect.anything());
    dispose();
  });

  it('releases keyboard PTT after focus moves into text and when the window blurs', async () => {
    testSettings.voiceMode = 'push-to-talk';
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      enumerateDevices: vi.fn(async () => []),
      getUserMedia: vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError'); }),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } });
    const { VoiceTab } = await import('./VoiceTab');
    const dispose = render(() => (
      <VoiceTab autoStartCall messages={[]} isStreaming={false} onSendMessage={vi.fn()}
        onAbort={vi.fn()} isConnected language="ja" onRequestGreeting={vi.fn()} />
    ), container);
    await vi.waitFor(() => expect(sessionReadyHandler).toBeDefined());
    sessionReadyHandler?.();
    await vi.waitFor(() => expect(container.querySelector('.voice-ptt-btn, .voice-call-ptt')).not.toBeNull());
    const isPressed = () => !!container.querySelector('.voice-ptt-btn.active, .voice-call-ptt.active');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    expect(isPressed()).toBe(true);
    const input = document.createElement('input');
    container.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
    expect(isPressed()).toBe(false);
    expect(mockVoiceFlush).toHaveBeenCalledTimes(1);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    expect(isPressed()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
    expect(isPressed()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(isPressed()).toBe(false);
    expect(mockVoiceFlush).toHaveBeenCalledTimes(2);
    dispose();
  });
});
