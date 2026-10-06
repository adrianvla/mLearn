import { For, Show, createMemo, type Component } from 'solid-js';
import { Avatar } from '../Avatar/Avatar';
import './ParticipantAvatarGroup.css';

export interface AvatarParticipant {
  id: string;
  displayName: string;
  profilePhoto?: string;
}

export interface ParticipantAvatarGroupProps {
  participants: readonly AvatarParticipant[];
  size?: 'sm' | 'md' | 'lg';
}

/** A compact avatar made from the current roster, preserving its stable order. */
export const ParticipantAvatarGroup: Component<ParticipantAvatarGroupProps> = (props) => {
  const roster = createMemo(() => {
    const seen = new Set<string>();
    return props.participants.filter(person => {
      if (seen.has(person.id)) return false;
      seen.add(person.id);
      return true;
    });
  });
  const shown = createMemo(() => roster().length > 4 ? roster().slice(0, 3) : roster());
  const overflow = () => Math.max(0, roster().length - shown().length);
  const slotCount = () => shown().length + (overflow() ? 1 : 0);

  return <Show when={roster().length > 0}>
    <span class={`participant-avatar-group participant-avatar-group--${props.size ?? 'md'}`}
      data-testid="participant-avatar-group" data-total-count={roster().length} data-slot-count={slotCount()} aria-hidden="true">
      <For each={shown()}>{person => <span class="participant-avatar-group__slot" data-participant-id={person.id}>
        <Avatar name={person.displayName} src={person.profilePhoto} size={props.size} class="participant-avatar-group__avatar" />
      </span>}</For>
      <Show when={overflow() > 0}>
        <span class="participant-avatar-group__overflow">+{overflow()}</span>
      </Show>
    </span>
  </Show>;
};
