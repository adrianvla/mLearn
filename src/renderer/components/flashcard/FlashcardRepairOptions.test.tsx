import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { FlashcardRepairOptions } from './FlashcardRepairOptions';
import { FlashcardAudioPresetSelect } from './FlashcardAudioPresetSelect';
import { DEFAULT_REPAIR_SELECTION } from '../../utils/flashcardRepairPlan';
import { DEFAULT_SETTINGS, type FlashcardAudioPreset } from '../../../shared/types';

vi.mock('../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../common', async () => ({
  CheckboxCard: (await import('../common/Card/CheckboxCard')).CheckboxCard,
  Select: (await import('../common/Select/Select')).Select,
}));

it('keeps dependent repair choices enabled by default and toggles independently', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const [selection, setSelection] = createSignal({ ...DEFAULT_REPAIR_SELECTION });
  const dispose = render(() => <FlashcardRepairOptions
    counts={{ content: 2, example: 4, wordAudio: 3, exampleAudio: 0, exampleMeaning: 1 }}
    selection={selection()}
    onChange={(aspect, enabled) => setSelection((previous) => ({ ...previous, [aspect]: enabled }))}
  />, host);
  const inputs = Array.from(host.querySelectorAll('input'));
  expect(inputs).toHaveLength(5);
  expect(inputs.every((input) => input.checked)).toBe(true);
  inputs[3].click();
  expect(selection()).toEqual({ ...DEFAULT_REPAIR_SELECTION, wordAudio: false });
  expect(inputs[0].checked).toBe(true);
  inputs[1].click();
  expect(selection().example).toBe(false);
  expect(selection().exampleMeaning).toBe(true);
  expect(selection().exampleAudio).toBe(true);
  dispose();
  host.remove();
});

it('offers both presets and allows overriding the regeneration default', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const [preset, setPreset] = createSignal<FlashcardAudioPreset>(DEFAULT_SETTINGS.flashcardRegenerationAudioPreset);
  const dispose = render(() => <FlashcardAudioPresetSelect value={preset()} onChange={setPreset} />, host);
  await Promise.resolve();
  const select = host.querySelector('select')!;
  expect(select.value).toBe('fast');
  expect(Array.from(select.options).map((option) => option.value)).toEqual(['high-quality', 'fast']);
  select.value = 'high-quality';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(preset()).toBe('high-quality');
  dispose();
  host.remove();
});
