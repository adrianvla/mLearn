import { Component, Show, type JSX } from 'solid-js';
import type { ProsodyOverlayProps } from './ProsodyOverlay';
import { getLanguageProsodyOverlayConfig } from '../../../shared/languageFeatures';
import { prosodyVisible } from '../../../shared/prosodySettings';
import { useSettings } from '../../context';
import type { LanguageProsodyOverlayConfig } from '../../../shared/types';
import './GenericProsodyOverlay.css';

/**
 * Package-declared declarative prosody overlay.
 *
 * Draws ANY prosody model whose language package declares `prosody.overlay`:
 * the caller's text stays visible (children preserved, like the Japanese
 * overlay), and a declarative mark bar spans the unit range derived from the
 * annotated reading at the payload's numeric position (1-based). No mora
 * logic, no particle rules, no linguistic interpretation — languages whose
 * models need semantics register real renderers instead.
 */

function segmentUnits(text: string, config: LanguageProsodyOverlayConfig): string[] {
  if (config.unit === 'grapheme' && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

const GenericDeclarativeOverlay: Component<ProsodyOverlayProps> = (props) => {
  const { settings } = useSettings();
  const config = () => getLanguageProsodyOverlayConfig(props.languageData);
  const source = () => (props.reading ?? props.word).normalize('NFC');
  const unitCount = () => {
    const overlayConfig = config();
    if (!overlayConfig) return 0;
    return segmentUnits(source(), overlayConfig).length;
  };
  const markedIndex = () => {
    const position = props.prosodyPosition;
    if (position === null || position === undefined || !Number.isFinite(position) || position <= 0) return -1;
    return position - 1;
  };
  const enabled = () => Boolean(config()) && prosodyVisible(settings);
  const markStyle = (): JSX.CSSProperties | undefined => {
    const count = unitCount();
    const index = markedIndex();
    if (count <= 0 || index < 0 || index >= count) return undefined;
    const mark = config()!.mark;
    return {
      left: `${(index / count) * 100}%`,
      width: `${(1 / count) * 100}%`,
      'border-top-width': mark === 'overline' ? 'var(--prosody-overlay-height)' : '0',
      'border-bottom-width': mark === 'underline' ? 'var(--prosody-overlay-height)' : '0',
    };
  };

  return (
    <span
      class={`prosody-overlay-wrapper ${props.mode === 'overlay' ? '' : 'generic-prosody-inline'} ${props.class || ''}`.trim()}
      style={props.style}
    >
      {props.children}
      <Show when={enabled()}>
        <span
          class={`generic-prosody-markbar generic-prosody-markbar--${config()!.mark}`}
          style={markStyle()}
          aria-hidden="true"
        />
      </Show>
    </span>
  );
};

export default GenericDeclarativeOverlay;
