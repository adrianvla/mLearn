import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { TtsGenerateModal } from './TtsGenerateModal';

const mocks = vi.hoisted(() => ({
  generate: vi.fn().mockResolvedValue('flashcard-audio://card-word.ogg'),
  access: vi.fn().mockResolvedValue(true),
  updateSettings: vi.fn(),
  cloudAuth: vi.fn(async (operation: (token: string) => Promise<unknown>) => operation('cloud-token')),
}));
vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { ...DEFAULT_SETTINGS, flashcardTtsProvider: 'cloud', flashcardVoiceSampleId: 'sample', cloudAuthAccessToken: 'token' }, updateSettings: mocks.updateSettings }),
  useLanguage: () => ({ langData: {}, currentLangData: () => null }),
  useFlashcards: () => ({ generateExampleSentenceWithLLM: vi.fn(), updateFlashcardContent: vi.fn(), translateExampleSentence: vi.fn() }),
  useLowPowerGate: () => ({ requestAccess: mocks.access }),
}));
vi.mock('../../../shared/bridges', () => ({ getBridge: () => ({ flashcards: { generateFlashcardTts: mocks.generate } }) }));
vi.mock('../../../shared/backends', () => ({ resolveCloudApiUrl: () => 'https://example.test' }));
vi.mock('../../services/cloudSessionManager', () => ({ withCloudAuth: mocks.cloudAuth }));
vi.mock('../common/Feedback/Toast', () => ({ showToast: () => 'toast', updateToast: vi.fn(), removeToast: vi.fn() }));
vi.mock('../common', async () => ({
  Select: (await import('../common/Select/Select')).Select,
  ToggleSwitch: (await import('../common/Input/ToggleSwitch')).ToggleSwitch,
  Modal: (props: { children?: JSX.Element; footer?: JSX.Element }) => <div>{props.children}{props.footer}</div>,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  VoiceSamplePicker: () => null,
  TaskProgressContent: () => null,
}));
vi.mock('../common/Modal/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

beforeEach(() => vi.clearAllMocks());

it.each(['fast', 'high-quality'])('regenerates with the selected %s preset, without changing the saved provider', async (preset) => {
  const host = document.createElement('div');
  document.body.append(host);
  const generated = vi.fn();
  const dispose = render(() => <TtsGenerateModal isOpen onClose={() => {}} cardId="card" wordText="Hello" onGenerated={generated} />, host);
  try {
    await Promise.resolve();
    const select = host.querySelector<HTMLSelectElement>('#tts-generate-audio-preset')!;
    expect(select.value).toBe('fast');
    select.value = preset;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const submit = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.CardEditor.GenerateTtsAction')!;
    submit.click();
    await vi.waitFor(() => expect(generated).toHaveBeenCalledOnce());
    expect(mocks.generate).toHaveBeenCalledWith('card', 'Hello', DEFAULT_SETTINGS.language, 'word', preset === 'fast' ? 'qwen3' : 'cloud', 'sample', preset === 'fast' ? undefined : 'cloud-token', 'https://example.test', preset);
    expect(mocks.cloudAuth).toHaveBeenCalledTimes(preset === 'fast' ? 0 : 1);
    expect(mocks.access).toHaveBeenCalledTimes(preset === 'fast' ? 1 : 0);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ flashcardTtsProvider: 'cloud', flashcardVoiceSampleId: 'sample' });
  } finally {
    dispose();
    host.remove();
  }
});
