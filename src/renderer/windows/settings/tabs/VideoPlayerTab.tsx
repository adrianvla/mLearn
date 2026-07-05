/**
 * Video Player Settings Tab
 * Video player behaviour, live translator, subtitle processing, and playback settings
 */

import { Component, Show } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, Select, VideoIcon, RangeInput } from '../../../components/common';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import {
  hideReadingAnnotationsForKnownWords,
  readingAnnotationsEnabled,
} from '../../../../shared/readingAnnotationSettings';
import {
  getProsodyToggleDescription as getLanguageProsodyToggleDescription,
  getProsodyToggleLabel as getLanguageProsodyToggleLabel,
} from '../../../../shared/languageFeatures';
import '../SettingsForm.css';

export const VideoPlayerTab: Component = () => {
  const { settings, updateSettings, showProsody, setProsodyVisible } = useSettings();
  const { t } = useLocalization();
  const { getLanguageFeatures, currentLangData } = useLanguage();

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.VideoPlayer.Title'),
        description: t('mlearn.Settings.VideoPlayer.Description'),
        icon: <VideoIcon size={20} />,
      }}
      padding="lg"
    >

      <SettingGroup title={t('mlearn.Settings.Groups.LiveTranslator')}>
        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.LiveTranslator.Show.Label')}
          description={t('mlearn.Settings.VideoPlayer.LiveTranslator.Show.Description')}
        >
          <ToggleSwitch
            checked={settings.showLiveTranslator ?? DEFAULT_SETTINGS.showLiveTranslator!}
            onChange={(checked) => {
              if (checked) {
                updateSettings({ showLiveTranslator: true, openAside: true });
              } else {
                updateSettings({ showLiveTranslator: false });
              }
            }}
          />
        </SettingRow>

        <Show when={settings.showLiveTranslator !== false}>
          <SettingRow
            label={t('mlearn.Settings.VideoPlayer.LiveTranslator.IncludeKnown.Label')}
            description={t('mlearn.Settings.VideoPlayer.LiveTranslator.IncludeKnown.Description')}
          >
            <ToggleSwitch
              checked={settings.liveTranslatorIncludeKnown ?? DEFAULT_SETTINGS.liveTranslatorIncludeKnown!}
              onChange={(checked) => updateSettings({ liveTranslatorIncludeKnown: checked })}
            />
          </SettingRow>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.DisplayOptions')}>
        <Show when={getLanguageFeatures().supportsReadings}>
          <SettingRow
            label={t('mlearn.Settings.DisplayOptions.ShowReadingAnnotations.Label')}
            description={t('mlearn.Settings.DisplayOptions.ShowReadingAnnotations.Description')}
          >
            <ToggleSwitch
              checked={readingAnnotationsEnabled(settings)}
              onChange={(checked) => updateSettings({
                showReadingAnnotations: checked,
              })}
            />
          </SettingRow>
        </Show>

        <Show when={getLanguageFeatures().supportsReadings && readingAnnotationsEnabled(settings)}>
          <SettingRow
            label={t('mlearn.Settings.DisplayOptions.HideReadingForKnownWords.Label')}
            description={t('mlearn.Settings.DisplayOptions.HideReadingForKnownWords.Description')}
          >
            <ToggleSwitch
              checked={hideReadingAnnotationsForKnownWords(settings)}
              onChange={(checked) => updateSettings({ hideReadingForKnownWords: checked })}
            />
          </SettingRow>
        </Show>

        <Show when={getLanguageFeatures().supportsProsody}>
          <SettingRow
            label={getLanguageProsodyToggleLabel(currentLangData()) ?? t('mlearn.Settings.DisplayOptions.ShowProsody.Label')}
            description={getLanguageProsodyToggleDescription(currentLangData()) ?? t('mlearn.Settings.DisplayOptions.ShowProsody.Description')}
          >
            <ToggleSwitch
              checked={showProsody()}
              onChange={setProsodyVisible}
            />
          </SettingRow>
        </Show>

        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.ShowPos.Label')}
          description={t('mlearn.Settings.DisplayOptions.ShowPos.Description')}
        >
          <ToggleSwitch
            checked={settings.show_pos}
            onChange={(checked) => updateSettings({ show_pos: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.BlurEffect')}>
        <SettingRow
          label={t('mlearn.Settings.BlurEffect.BlurWords.Label')}
          description={t('mlearn.Settings.BlurEffect.BlurWords.Description')}
        >
          <ToggleSwitch
            checked={settings.blur_words}
            onChange={(checked) => updateSettings({ blur_words: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.KnownWords.BlurKnown.Label')}
          description={t('mlearn.Settings.VideoPlayer.KnownWords.BlurKnown.Description')}
        >
          <ToggleSwitch
            checked={settings.blurKnownWords ?? DEFAULT_SETTINGS.blurKnownWords!}
            onChange={(checked) => updateSettings({ blurKnownWords: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.BlurEffect.BlurKnownSubtitles.Label')}
          description={t('mlearn.Settings.BlurEffect.BlurKnownSubtitles.Description')}
        >
          <ToggleSwitch
            checked={settings.blur_known_subtitles}
            onChange={(checked) => updateSettings({ blur_known_subtitles: checked })}
          />
        </SettingRow>

        <Show when={settings.blur_words || settings.blurKnownWords || settings.blur_known_subtitles}>
          <SettingRow
            label={t('mlearn.Settings.BlurEffect.BlurAmount.Label')}
            description={t('mlearn.Settings.BlurEffect.BlurAmount.Description')}
          >
            <RangeInput
              min={1}
              max={20}
              value={settings.blur_amount}
              onChange={(value) => updateSettings({ blur_amount: value })}
              class="setting-range"
            />
            <span class="setting-hint">{settings.blur_amount}px</span>
          </SettingRow>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.VideoPlayerBehaviour')}>
        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.Playback.VideoFit.Label')}
          description={t('mlearn.Settings.VideoPlayer.Playback.VideoFit.Description')}
        >
          <Select
            class="setting-select"
            value={settings.videoFit ?? DEFAULT_SETTINGS.videoFit}
            onChange={(e) => updateSettings({ videoFit: e.currentTarget.value as 'contain' | 'cover' | 'fill' })}
          >
            <option value="contain">{t('mlearn.Settings.VideoPlayer.Playback.VideoFit.Contain')}</option>
            <option value="cover">{t('mlearn.Settings.VideoPlayer.Playback.VideoFit.Cover')}</option>
            <option value="fill">{t('mlearn.Settings.VideoPlayer.Playback.VideoFit.Fill')}</option>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.Playback.ShowSubtitles.Label')}
          description={t('mlearn.Settings.VideoPlayer.Playback.ShowSubtitles.Description')}
        >
          <ToggleSwitch
            checked={settings.showSubtitles ?? DEFAULT_SETTINGS.showSubtitles!}
            onChange={(checked) => updateSettings({ showSubtitles: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.Playback.ShowTranslation.Label')}
          description={t('mlearn.Settings.VideoPlayer.Playback.ShowTranslation.Description')}
        >
          <ToggleSwitch
            checked={settings.showTranslation ?? DEFAULT_SETTINGS.showTranslation!}
            onChange={(checked) => updateSettings({ showTranslation: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.Playback.SubtitlePosition.Label')}
          description={t('mlearn.Settings.VideoPlayer.Playback.SubtitlePosition.Description')}
        >
          <Select
            class="setting-select"
            value={settings.subtitlePosition ?? DEFAULT_SETTINGS.subtitlePosition}
            onChange={(e) => updateSettings({ subtitlePosition: e.currentTarget.value as 'top' | 'bottom' })}
          >
            <option value="bottom">{t('mlearn.Settings.VideoPlayer.Playback.SubtitlePosition.Bottom')}</option>
            <option value="top">{t('mlearn.Settings.VideoPlayer.Playback.SubtitlePosition.Top')}</option>
          </Select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.VideoPlayer.SubtitleProcessing.Title')}>
        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.SubtitleProcessing.RemoveParentheses.Label')}
          description={t('mlearn.Settings.VideoPlayer.SubtitleProcessing.RemoveParentheses.Description')}
        >
          <ToggleSwitch
            checked={settings.removeParentheses ?? DEFAULT_SETTINGS.removeParentheses!}
            onChange={(checked) => updateSettings({ removeParentheses: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.SubtitleProcessing.RemoveSpeakerNames.Label')}
          description={t('mlearn.Settings.VideoPlayer.SubtitleProcessing.RemoveSpeakerNames.Description')}
        >
          <ToggleSwitch
            checked={settings.removeSpeakerNames ?? DEFAULT_SETTINGS.removeSpeakerNames!}
            onChange={(checked) => updateSettings({ removeSpeakerNames: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.VideoPlayer.FlashcardMedia.Title')}>
        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.FlashcardMedia.MediaType.Label')}
          description={t('mlearn.Settings.VideoPlayer.FlashcardMedia.MediaType.Description')}
        >
          <Select
            class="setting-select"
            value={settings.flashcardMediaType ?? DEFAULT_SETTINGS.flashcardMediaType}
            onChange={(e) => updateSettings({ flashcardMediaType: e.currentTarget.value as 'image' | 'video' })}
          >
            <option value="image">{t('mlearn.Settings.VideoPlayer.FlashcardMedia.MediaType.Image')}</option>
            <option value="video">{t('mlearn.Settings.VideoPlayer.FlashcardMedia.MediaType.Video')}</option>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.VideoPlayer.FlashcardMedia.VideoMargin.Label')}
          description={t('mlearn.Settings.VideoPlayer.FlashcardMedia.VideoMargin.Description')}
          disabled={settings.flashcardMediaType !== 'video'}
        >
          <RangeInput
            min={0}
            max={2000}
            step={100}
            value={settings.flashcardVideoMargin ?? DEFAULT_SETTINGS.flashcardVideoMargin}
            onChange={(value) => updateSettings({ flashcardVideoMargin: value })}
            class="setting-range"
            disabled={settings.flashcardMediaType !== 'video'}
          />
          <span class="setting-hint">{settings.flashcardVideoMargin ?? DEFAULT_SETTINGS.flashcardVideoMargin}ms</span>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.Performance')}>
        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.ImmediateFetch.Label')}
          description={t('mlearn.Settings.DisplayOptions.ImmediateFetch.Description')}
        >
          <ToggleSwitch
            checked={settings.immediateFetch}
            onChange={(checked) => updateSettings({ immediateFetch: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Performance.HoverKnownGetFromDictionary.Label')}
          description={t('mlearn.Settings.Performance.HoverKnownGetFromDictionary.Description')}
        >
          <ToggleSwitch
            checked={settings.hover_known_get_from_dictionary}
            onChange={(checked) => updateSettings({ hover_known_get_from_dictionary: checked })}
          />
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};
