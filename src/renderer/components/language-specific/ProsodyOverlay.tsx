import { Component, createMemo, JSX, Show } from 'solid-js';
import type { FlashcardProsody, LanguageData } from '../../../shared/types';
import { getLanguageProsodyOverlayConfig, getLanguageProsodyType } from '../../../shared/languageFeatures';
import { getProsodyOverlayComponent } from './prosodyOverlayRenderers';

export interface ProsodyOverlayProps {
  /** The headword, surface form, or renderer-specific lookup key. */
  word: string;
  /** Reading, pronunciation, transliteration, or display text used by the selected renderer. */
  reading?: string;
  /** Part of speech for renderer-specific context rules. */
  pos?: string;
  /** Following part of speech for context-sensitive renderers. */
  nextPos?: string;
  /** Display mode selected by the caller. */
  mode?: 'overlay' | 'pill' | 'preview';
  /** Text to decorate in overlay mode. */
  children?: JSX.Element;
  /** Additional CSS class. */
  class?: string;
  /** Optional inline style for wrapper elements. */
  style?: JSX.CSSProperties;
  /** Language code for cache lookups when the decorated word is not in the active study language. */
  language?: string;
  /** Language metadata that selects the renderer for package-defined prosody. */
  languageData?: LanguageData | null;
  /** Whether the decorated text is already in the language's reading/pronunciation script. */
  isReadingScript?: boolean;
  /** Renderer hint for whether to show an auxiliary continuation segment. */
  showParticleBox?: boolean;
  /** Renderer hint to use uniform visual treatment. */
  homogenous?: boolean;
  /** Part-of-speech label to display in compact pill renderers. */
  posLabel?: string;
  /** Explicit prosody model from saved card or translation payload. */
  prosodyType?: NonNullable<FlashcardProsody['type']>;
  /** Explicit prosody position. Interpretation belongs to the selected prosody renderer. */
  prosodyPosition?: number | null;
  /** Allow explicit stored card prosody to render even if the language package is not currently loaded. */
  allowStoredProsodyWithoutMetadata?: boolean;
}

function renderFallback(mode: ProsodyOverlayProps['mode'], children?: JSX.Element, className?: string, style?: JSX.CSSProperties): JSX.Element {
  return (mode ?? 'overlay') === 'overlay'
    ? <span class={`prosody-overlay-wrapper ${className || ''}`} style={style}>{children}</span>
    : null;
}

export const ProsodyOverlay: Component<ProsodyOverlayProps> = (props) => {
  const rendererType = () => (
    props.prosodyType && props.prosodyType !== 'none'
      ? props.prosodyType
      : getLanguageProsodyType(props.languageData)
  );
  const OverlayRenderer = createMemo(() => {
    const explicit = props.prosodyType;
    const exact = getProsodyOverlayComponent(rendererType());
    if (exact) return exact;
    // Package-declared declarative overlay: only when the stored/payload type
    // agrees with the language's declared model (or there is none yet). An
    // explicit 'none' suppresses the overlay entirely.
    if (explicit === 'none') return undefined;
    const languageType = getLanguageProsodyType(props.languageData);
    if (explicit !== undefined && languageType !== undefined && explicit !== languageType) return undefined;
    return getLanguageProsodyOverlayConfig(props.languageData) ? getProsodyOverlayComponent('generic-declarative') : undefined;
  });

  return (
    <Show
      when={OverlayRenderer()}
      fallback={renderFallback(props.mode, props.children, props.class, props.style)}
    >
      {(renderer) => {
        const ResolvedOverlayRenderer = renderer();
        return <ResolvedOverlayRenderer {...props} />;
      }}
    </Show>
  );
};

export default ProsodyOverlay;
