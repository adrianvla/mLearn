// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

const cleanup = () => undefined;

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
};

/** Compute hints the voice status IPC payloads carry (contract: device/cpuWarning). */
type VoiceDeviceStatus = {
  device?: 'cuda' | 'mps' | 'cpu';
  cpuWarning?: boolean;
};
type TestTtsStatus = VoiceDeviceStatus & { generating?: boolean; playing?: boolean };
type TestModelStatus = VoiceDeviceStatus & {
  sttDownloaded: boolean;
  ttsDownloaded: boolean;
  vadDownloaded: boolean;
  downloading: boolean;
  progress: number;
};

let modelProgressHandler: ((status: TestModelStatus) => void) | undefined;
let ttsStatusHandler: ((status: TestTtsStatus) => void) | undefined;

const testSettings = {
  ttsProvider: 'kokoro' as const,
  voiceMode: 'vad' as const,
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
  useLowPowerGate: () => ({ requestAccess: vi.fn().mockResolvedValue(true) }),
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
      onVoiceTtsAudio: vi.fn(() => cleanup),
      onVoiceTtsStatus: vi.fn((callback: typeof ttsStatusHandler) => {
        ttsStatusHandler = callback;
        return cleanup;
      }),
      onVoiceSessionReady: vi.fn(() => cleanup),
      onVoiceSessionStatus: vi.fn(() => cleanup),
      onVoiceSessionError: vi.fn(() => cleanup),
      voiceSendTtsState: vi.fn(),
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
  });

  afterEach(() => {
    container.remove();
  });

  it('hides the CPU warning while voice statuses carry no compute hints', async () => {
    const dispose = await mountVoiceTab();

    ttsStatusHandler?.({ generating: false, playing: false });
    modelProgressHandler?.(readyModels);

    expect(container.textContent).not.toContain('Realtime voice may lag');

    dispose();
  });

  it('shows the CPU warning when the TTS status reports cpuWarning', async () => {
    const dispose = await mountVoiceTab();

    ttsStatusHandler?.({ generating: false, playing: false, cpuWarning: true });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Realtime voice may lag');
    });

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
});
