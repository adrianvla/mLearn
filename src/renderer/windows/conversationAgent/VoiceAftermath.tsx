/**
 * VoiceAftermath — Summary panel shown after a voice call session ends.
 * Displays a list of mistakes the LLM noted (via note_mistake tool)
 * plus basic session stats.
 */

import { Component, Show, For } from 'solid-js';
import { useLocalization } from '../../context';
import { formatDurationShort } from '../../utils/timeFormatting';
import type { VoiceSessionAftermath } from '../../../shared/types';

export interface VoiceAftermathProps {
  aftermath: VoiceSessionAftermath;
  onDismiss: () => void;
}

export const VoiceAftermath: Component<VoiceAftermathProps> = (props) => {
  const { t } = useLocalization();

  return (
    <div class="voice-aftermath">
      <div class="voice-aftermath-header">
        <h3>{t('mlearn.ConversationAgent.Voice.Aftermath.Title')}</h3>
        <button class="voice-aftermath-dismiss" onClick={props.onDismiss} aria-label="Dismiss">
          &times;
        </button>
      </div>

      <div class="voice-aftermath-stats">
        <span>{t('mlearn.ConversationAgent.Voice.Aftermath.Duration')}: {formatDurationShort(props.aftermath.duration, t)}</span>
        <span>{t('mlearn.ConversationAgent.Voice.Aftermath.Messages')}: {props.aftermath.messageCount}</span>
      </div>

      <Show
        when={props.aftermath.mistakes.length > 0}
        fallback={
          <p class="voice-aftermath-empty">
            {t('mlearn.ConversationAgent.Voice.Aftermath.NoMistakes')}
          </p>
        }
      >
        <div class="voice-aftermath-mistakes">
          <h4>{t('mlearn.ConversationAgent.Voice.Aftermath.Mistakes')} ({props.aftermath.mistakes.length})</h4>
          <ul class="voice-aftermath-list">
            <For each={props.aftermath.mistakes}>
              {(m) => (
                <li class="voice-aftermath-item">
                  <div class="voice-aftermath-word">
                    <strong>{m.word}</strong>
                    <Show when={m.reading}>
                      <span class="voice-aftermath-reading">{m.reading}</span>
                    </Show>
                    <span class="voice-aftermath-type">{m.type}</span>
                  </div>
                  <div class="voice-aftermath-correction">
                    <span class="voice-aftermath-arrow">&rarr;</span> {m.correction}
                  </div>
                  <Show when={m.context}>
                    <div class="voice-aftermath-context">&ldquo;{m.context}&rdquo;</div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
};
