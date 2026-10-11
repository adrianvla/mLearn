import { PeopleGroupIcon } from '../Misc/Icons';
import { Show, createEffect, createSignal, type Component } from 'solid-js';
import './Avatar.css';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  class?: string;
  fallback?: 'icon' | 'initials';
}

/** Decorative identity next to an accessible name; a missing photo defaults to a pictogram. */
export const Avatar: Component<AvatarProps> = (props) => {
  const [failed, setFailed] = createSignal(false);
  createEffect(() => { void props.src; setFailed(false); });
  const initials = () => {
    const parts = props.name.trim().split(/\s+/u).filter(Boolean);
    return [parts[0], parts.length > 1 ? parts.at(-1) : undefined]
      .filter((part): part is string => Boolean(part))
      .map(part => Array.from(part)[0]).join('').toLocaleUpperCase();
  };
  const noPhotoFallback = () => props.fallback === 'initials' ? initials() || <PeopleGroupIcon size={20} /> : <PeopleGroupIcon size={20} />;
  return <span class={`avatar avatar--${props.size ?? 'md'} ${props.class ?? ''}`} aria-hidden="true">
    <Show when={props.src && !failed()} fallback={noPhotoFallback()}>
      <img src={props.src} alt="" onError={() => setFailed(true)} />
    </Show>
  </span>;
};
