/**
 * VoiceSamplePicker Component
 * Reusable voice sample selector with upload button,
 * transcription progress indicator, transcript display,
 * sample playback, and TTS test input.
 */

import { Component, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { Select } from '../Select/Select';
import { Input } from './Input';
import { Btn } from '../Button/Button';
import { IconBtn } from '../Button/Button';
import { ProgressBar } from '../Feedback/ProgressBar';
import { ConfirmDialog } from '../Modal/ConfirmDialog';
import { PlayIcon, PauseIcon, TrashIcon } from '../Misc';
import type { VoiceSample, VoiceTtsAudio } from '../../../../shared/types';
import './VoiceSamplePicker.css';

export interface VoiceSamplePickerProps {
  value: string;
  onChange: (sampleId: string) => void;
  selectClass?: string;
  /** TTS provider to use for the test button (overrides default conversation voice provider) */
  ttsProvider?: string;
}

export const VoiceSamplePicker: Component<VoiceSamplePickerProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const [voiceSamples, setVoiceSamples] = createSignal<VoiceSample[]>([]);
  const [transcribing, setTranscribing] = createSignal(false);
  const [lastTranscript, setLastTranscript] = createSignal('');

  // Sample playback state
  const [playingSample, setPlayingSample] = createSignal(false);
  let sampleAudio: HTMLAudioElement | null = null;

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = createSignal(false);

  // TTS test state
  const [ttsTestText, setTtsTestText] = createSignal('');
  const [ttsGenerating, setTtsGenerating] = createSignal(false);
  const [ttsPlaying, setTtsPlaying] = createSignal(false);
  const [ttsModelLoading, setTtsModelLoading] = createSignal(false);
  const [ttsDownloadProgress, setTtsDownloadProgress] = createSignal(0);
  let ttsAudioContext: AudioContext | null = null;
  let ttsSource: AudioBufferSourceNode | null = null;
  let ttsQueue: VoiceTtsAudio[] = [];
  let ttsQueueIndex = 0;
  let ttsCleanups: Array<() => void> = [];

  // Reactively sync transcript whenever props.value or voice samples change
  createEffect(() => {
    updateTranscriptFromSelected(voiceSamples(), props.value);
  });

  onMount(async () => {
    try {
      const samples = await getBridge().voice.voiceSampleList();
      if (samples) {
        setVoiceSamples(samples);
      }
    } catch (e) {
      console.error(e);
      // Voice samples not available (e.g., mobile)
    }

    // Listen for TTS audio chunks and status
    const bridge = getBridge();
    ttsCleanups.push(bridge.voice.onVoiceTtsAudio((audio: VoiceTtsAudio) => {
      if (!ttsGenerating() && !ttsPlaying()) return;
      ttsQueue.push(audio);
      if (!ttsPlaying()) {
        setTtsPlaying(true);
        playNextTtsChunk();
      }
    }));

    ttsCleanups.push(bridge.voice.onVoiceTtsStatus((status) => {
      if (!status.generating) {
        setTtsGenerating(false);
        setTtsModelLoading(false);
      }
      if (status.modelLoading !== undefined) {
        setTtsModelLoading(status.modelLoading);
      }
      if (status.downloadProgress !== undefined) {
        setTtsDownloadProgress(status.downloadProgress);
      }
    }));
  });

  onCleanup(() => {
    stopSamplePlayback();
    stopTtsPlayback();
    ttsCleanups.forEach((fn) => fn());
    if (ttsAudioContext) {
      ttsAudioContext.close();
      ttsAudioContext = null;
    }
  });

  function updateTranscriptFromSelected(samples: VoiceSample[], id: string) {
    if (!id) {
      setLastTranscript('');
      return;
    }
    const sample = samples.find((s) => s.id === id);
    if (sample?.transcript) {
      setLastTranscript(sample.transcript);
    } else {
      setLastTranscript('');
    }
  }

  function handleSelectionChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    props.onChange(value);
  }

  async function handleUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const filePath = await getBridge().files.getPathForFile(file);
        const name = file.name.replace(/\.[^.]+$/, '');
        const newSample = await getBridge().voice.voiceSampleUpload(filePath, name);
        const samples = await getBridge().voice.voiceSampleList();
        if (samples) setVoiceSamples(samples);

        if (newSample?.id) {
          setTranscribing(true);
          setLastTranscript('');
          try {
            const result = await getBridge().voice.voiceSampleTranscribe(newSample.id);
            setLastTranscript(result.text);
            const updated = await getBridge().voice.voiceSampleList();
            if (updated) setVoiceSamples(updated);
          } catch (e) {
            console.error(e);
            // Transcription failed — not critical
          } finally {
            setTranscribing(false);
          }
        }
      } catch (e) {
        console.error(e);
        // Upload failed
      }
    };
    input.click();
  }

  // ── Sample playback ──
  let sampleBlobUrl: string | null = null;

  function stopSamplePlayback() {
    if (sampleAudio) {
      sampleAudio.pause();
      sampleAudio.onended = null;
      sampleAudio.onerror = null;
      sampleAudio = null;
    }
    if (sampleBlobUrl) {
      URL.revokeObjectURL(sampleBlobUrl);
      sampleBlobUrl = null;
    }
    setPlayingSample(false);
  }

  async function toggleSamplePlayback() {
    if (playingSample()) {
      stopSamplePlayback();
      return;
    }

    const id = props.value;
    if (!id) return;

    try {
      const dataUrl = await getBridge().voice.voiceSampleGetPath(id);
      if (!dataUrl) return;

      // Decode base64 data URL to blob (CSP blocks both data: media-src and fetch of data: URLs)
      const [header, b64] = dataUrl.split(',');
      const mime = header.match(/:(.*?);/)?.[1] || 'audio/wav';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));

      stopSamplePlayback();
      sampleBlobUrl = blobUrl;
      const audio = new Audio(blobUrl);
      sampleAudio = audio;
      setPlayingSample(true);

      audio.onended = () => {
        if (sampleAudio === audio) {
          setPlayingSample(false);
          sampleAudio = null;
        }
      };

      audio.onerror = () => {
        if (sampleAudio === audio) {
          setPlayingSample(false);
          sampleAudio = null;
        }
      };

      await audio.play();
    } catch (e) {
      console.error(e);
      setPlayingSample(false);
    }
  }

  // ── TTS test playback ──

  function playNextTtsChunk() {
    if (ttsQueueIndex >= ttsQueue.length) {
      setTtsPlaying(false);
      return;
    }

    const audio = ttsQueue[ttsQueueIndex];

    if (!ttsAudioContext) {
      ttsAudioContext = new AudioContext();
    }

    const buffer = ttsAudioContext.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.samples);

    ttsSource = ttsAudioContext.createBufferSource();
    ttsSource.buffer = buffer;
    ttsSource.connect(ttsAudioContext.destination);

    ttsSource.onended = () => {
      ttsQueueIndex++;
      playNextTtsChunk();
    };

    ttsSource.start();
  }

  function stopTtsPlayback() {
    if (ttsSource) {
      try { ttsSource.stop(); } catch (e) {
        console.error(e);
      }
      ttsSource.disconnect();
      ttsSource = null;
    }
    ttsQueue = [];
    ttsQueueIndex = 0;
    setTtsGenerating(false);
    setTtsPlaying(false);
    getBridge().voice.voiceTtsStop();
  }

  function handleTtsTest() {
    const text = ttsTestText().trim();
    if (!text) return;

    if (ttsGenerating() || ttsPlaying()) {
      stopTtsPlayback();
      return;
    }

    ttsQueue = [];
    ttsQueueIndex = 0;
    setTtsGenerating(true);

    const voiceSampleId = props.value || undefined;
    getBridge().voice.voiceTtsGenerate(text, settings.language, 1.0, voiceSampleId, props.ttsProvider);
  }

  async function handleDelete() {
    const id = props.value;
    if (!id) return;
    stopSamplePlayback();
    stopTtsPlayback();
    await getBridge().voice.voiceSampleDelete(id);
    props.onChange('');
    setLastTranscript('');
    const samples = await getBridge().voice.voiceSampleList();
    if (samples) setVoiceSamples(samples);
    setDeleteConfirmOpen(false);
  }

  const sampleOptions = () => {
    const opts: Array<{ value: string; label: string }> = [
      { value: '', label: t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.DefaultVoice') },
    ];
    for (const s of voiceSamples()) {
      opts.push({ value: s.id, label: s.name });
    }
    return opts;
  };

  const selectedSample = () => {
    const id = props.value;
    if (!id) return undefined;
    return voiceSamples().find((s) => s.id === id);
  };

  return (
    <div>
      <div class="voice-sample-picker-row">
        <Select
          options={sampleOptions()}
          value={props.value}
          onChange={handleSelectionChange}
          class={props.selectClass}
        />
        <Show when={props.value}>
          <IconBtn
            size="sm"
            icon={playingSample() ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            onClick={toggleSamplePlayback}
            aria-label={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.PlaySample')}
            title={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.PlaySample')}
          />
          <IconBtn
            size="sm"
            icon={<TrashIcon size={14} />}
            onClick={() => setDeleteConfirmOpen(true)}
            aria-label={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.DeleteSample')}
            title={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.DeleteSample')}
          />
        </Show>
        <Btn size="sm" onClick={handleUpload} disabled={transcribing()}>
          {t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Upload')}
        </Btn>
      </div>

      <Show when={transcribing()}>
        <div class="voice-sample-picker-status">
          <span class="voice-sample-picker-status-label">
            {t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Transcribing')}
          </span>
          <ProgressBar value={100} size="xs" variant="primary" animated />
        </div>
      </Show>

      <Show when={!transcribing() && lastTranscript() && props.value}>
        <div class="voice-sample-picker-status">
          <span class="voice-sample-picker-status-label">
            {t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Transcript')}
          </span>
          <span class="voice-sample-picker-transcript">{lastTranscript()}</span>
        </div>
      </Show>

      <Show when={!transcribing() && !lastTranscript() && selectedSample() && !selectedSample()!.transcript}>
        <div class="voice-sample-picker-status">
          <span class="voice-sample-picker-status-label voice-sample-picker-transcript">
            {t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.NoTranscript')}
          </span>
        </div>
      </Show>

      {/* TTS test input */}
      <div class="voice-sample-picker-tts-test">
        <Show when={ttsModelLoading()}>
          <div class="voice-sample-picker-status">
            <span class="voice-sample-picker-status-label">
              {t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.ModelLoading')}
            </span>
            <ProgressBar
              value={Math.round(ttsDownloadProgress() * 100)}
              size="xs"
              variant="primary"
              showPercent
              animated={ttsDownloadProgress() < 0.05}
            />
          </div>
        </Show>
        <Input
          size="sm"
          fullWidth
          placeholder={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.TestPlaceholder')}
          value={ttsTestText()}
          onInput={(e) => setTtsTestText(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleTtsTest(); }}
          disabled={ttsGenerating()}
        />
        <IconBtn
          size="sm"
          loading={ttsGenerating()}
          icon={
            ttsPlaying()
              ? <PauseIcon size={14} />
              : <PlayIcon size={14} />
          }
          onClick={handleTtsTest}
          disabled={!ttsTestText().trim() && !ttsGenerating() && !ttsPlaying()}
          aria-label={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.TestTts')}
          title={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.TestTts')}
        />
      </div>

      <ConfirmDialog
        isOpen={deleteConfirmOpen()}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        variant="danger"
        title={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.DeleteSample')}
        message={t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.DeleteConfirm')}
        showLoading
      />
    </div>
  );
};
