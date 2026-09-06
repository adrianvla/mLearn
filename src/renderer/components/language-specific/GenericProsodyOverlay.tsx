import { Component, For, Show } from 'solid-js';
import type { ProsodyOverlayProps } from './ProsodyOverlay';
import { getLanguageProsodyOverlayConfig } from '../../../shared/languageFeatures';
import type { LanguageProsodyOverlayConfig } from '../../../shared/types';
import './GenericProsodyOverlay.css';

/**
 * Package-declared declarative prosody overlay.
 *
 * Draws ANY prosody model whose language package declares `prosody.overlay`:
 * segment the annotated reading into the declared unit type and visually mark
 * the unit at the payload's numeric position (1-based). No mora logic, no
 * particle rules, no linguistic interpretation — languages whose models need
 * semantics register real renderers instead (Japanese pitch accent).
 */

function segmentUnits(text: string, config: LanguageProsodyOverlayConfig): string[] {
  if (config.unit === 'grapheme' && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

const GenericDeclarativeOverlay: Component<ProsodyOverlayProps> = (props) => {
  const config = () => getLanguageProsodyOverlayConfig(props.languageData);
  const source = () => (props.reading ?? props.word).normalize('NFC');
  const units = () => {
    const overlayConfig = config();
    if (!overlayConfig) return [];
    return segmentUnits(source(), overlayConfig);
  };
  const markedIndex = () => {
    const position = props.prosodyPosition;
    if (position === null || position === undefined || !Number.isFinite(position) || position <= 0) return -1;
    return position - 1;
  };
  const markClass = () => {
    const overlayConfig = config();
    if (!overlayConfig) return '';
    return `generic-prosody-mark--${overlayConfig.mark}`;
  };
  const wrapperClass = () => `prosody-overlay-wrapper ${props.mode === 'overlay' ? '' : 'generic-prosody-inline'} ${props.class || ''}`.trim();

  return (
    <Show
      when={config()}
      fallback={<span class={`prosody-overlay-wrapper ${props.class || ''}`} style={props.style}>{props.children}</span>}
    >
      <span class={wrapperClass()} style={props.style}>
        <span class="generic-prosody-units">
          <For each={units()}>
            {(unit, index) => (
              <span class={`generic-prosody-unit${index() === markedIndex() ? ` ${markClass()}` : ''}`}>{unit}</span>
            )}
          </For>
        </span>
      </span>
    </Show>
  );
};

export default GenericDeclarativeOverlay;
