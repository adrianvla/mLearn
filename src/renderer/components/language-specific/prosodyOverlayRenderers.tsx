import { Component, splitProps } from 'solid-js';
import { JapanesePitchAccentOverlay } from './JapanesePitchAccentOverlay';
import type { ProsodyOverlayProps } from './ProsodyOverlay';

const JapanesePitchAccentProsodyOverlay: Component<ProsodyOverlayProps> = (props) => {
  const [local, overlayProps] = splitProps(props, [
    'allowStoredProsodyWithoutMetadata',
    'isReadingScript',
    'prosodyPosition',
    'prosodyType',
  ]);

  return (
    <JapanesePitchAccentOverlay
      {...overlayProps}
      pitchPosition={local.prosodyPosition}
      allowStoredPitchWithoutMetadata={local.allowStoredProsodyWithoutMetadata}
    />
  );
};

const PROSODY_OVERLAY_RENDERERS: Record<string, Component<ProsodyOverlayProps>> = {
  'japanese-pitch-accent': JapanesePitchAccentProsodyOverlay,
};

export function getProsodyOverlayComponent(type: unknown): Component<ProsodyOverlayProps> | undefined {
  return typeof type === 'string' ? PROSODY_OVERLAY_RENDERERS[type] : undefined;
}
