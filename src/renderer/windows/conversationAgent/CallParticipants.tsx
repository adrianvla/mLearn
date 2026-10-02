import { For, Show, type Component } from 'solid-js';
import { Avatar } from '../../components/common';
import { useLocalization } from '../../context';
import type { Participant } from '../../../shared/world';
import './CallParticipants.css';

export type CallParticipant = Pick<Participant, 'id' | 'displayName' | 'profilePhoto' | 'voiceSampleId'>;

export const CallParticipants: Component<{
  participants: readonly CallParticipant[];
  speakingActorId?: string | null;
  voiceLabel: string;
  usingVoiceSamples: boolean;
}> = (props) => {
  const { t } = useLocalization();
  return <div class="call-participants" aria-label={t('mlearn.ConversationAgent.Voice.PeopleInCall')}>
    <For each={props.participants}>{person => <div class="call-participant"
      classList={{ 'call-participant--speaking': props.speakingActorId === person.id }} data-participant-id={person.id}>
      <Avatar size="lg" name={person.displayName} src={person.profilePhoto} />
      <strong>{person.displayName}</strong>
      <span class="call-participant-voice">{props.usingVoiceSamples && person.voiceSampleId
        ? t('mlearn.ConversationAgent.Voice.VoiceSample') : props.voiceLabel}</span>
      <Show when={props.speakingActorId === person.id}>
        <span class="call-participant-speaking">{t('mlearn.ConversationAgent.Voice.Speaking')}</span>
      </Show>
    </div>}</For>
  </div>;
};
