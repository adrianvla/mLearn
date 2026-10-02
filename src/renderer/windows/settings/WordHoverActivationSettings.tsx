import { Show } from 'solid-js';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { useSettings, useLocalization } from '../../context';
import { SettingRow, Select, KeybindInput, formatKeybindDisplay } from '../../components/common';

/** Both settings entry points edit the same global activation preferences. */
export function WordHoverActivationSettings() {
  const { settings, updateSettings, isSettingManaged } = useSettings();
  const { t } = useLocalization();
  return <>
    <SettingRow label={t('mlearn.Settings.Reader.WordHoverBehavior.TriggerMode.Label')}
      description={t('mlearn.Settings.Reader.WordHoverBehavior.TriggerMode.Description')} settingKey="readerWordHoverTrigger">
      <Select value={settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger!}
        onChange={(event) => updateSettings({ readerWordHoverTrigger: event.currentTarget.value as WordHoverTriggerMode })}
        options={[
          { value: 'hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.Hover') },
          { value: 'long-hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.LongHover') },
          { value: 'key-hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.KeyHover', {
            key: formatKeybindDisplay(settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!, t),
          }) },
        ]} />
    </SettingRow>
    <Show when={(settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger) === 'key-hover' || isSettingManaged('readerWordHoverKey')}>
      <SettingRow label={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Label')}
        description={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Description')} settingKey="readerWordHoverKey">
        <KeybindInput value={settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!}
          onChange={(key) => updateSettings({ readerWordHoverKey: key })} allowModifierOnly />
      </SettingRow>
    </Show>
  </>;
}
