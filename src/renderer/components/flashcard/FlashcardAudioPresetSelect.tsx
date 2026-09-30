import { Component } from 'solid-js';
import { Select } from '../common';
import { useLocalization } from '../../context';
import type { FlashcardAudioPreset } from '../../../shared/types';

export const FlashcardAudioPresetSelect: Component<{
  value: FlashcardAudioPreset;
  onChange: (value: FlashcardAudioPreset) => void;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
}> = (props) => {
  const { t } = useLocalization();
  return (
    <Select
      id={props.id}
      aria-label={props.ariaLabel ?? t('mlearn.AI.Settings.FlashcardTTS.Preset.Label')}
      disabled={props.disabled}
      value={props.value}
      options={[
        { value: 'high-quality', label: t('mlearn.AI.Settings.FlashcardTTS.Preset.HighQuality') },
        { value: 'fast', label: t('mlearn.AI.Settings.FlashcardTTS.Preset.Fast') },
      ]}
      onChange={(event) => props.onChange(event.currentTarget.value as FlashcardAudioPreset)}
    />
  );
};
