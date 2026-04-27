/**
 * Explainer Cards Component
 * Displays parsed LLM explanation content in structured cards
 * Used by WordHover to show translation, word explanation, and grammar points
 */

import { Component, For, Show, createMemo, createResource } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useLanguage, useLocalization, useSettings } from '../../context';
import { useTokenizer } from '../../hooks/useTranslation';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.explainerCards");
// Types previously from explainerParser — now defined here for tool-call-based flow
export type ExplainerSectionType = 'translation' | 'explanation' | 'grammar';

export interface GrammarPoint {
  term: string;
  description: string;
}

export interface ExplainerSection {
  type: ExplainerSectionType;
  title?: string;
  word?: string;
  content?: string;
  grammarPoints?: GrammarPoint[];
}

export interface ParsedExplainer {
  sections: ExplainerSection[];
  rawText?: string;
}
import { Spinner } from '../common';
import './ExplainerCards.css';

// ============================================================================
// Props
// ============================================================================

export interface ExplainerCardsProps {
  /** Parsed explainer data from parseExplainerResponse */
  data: ParsedExplainer;
  /** The word being explained (for highlighting) */
  targetWord?: string;
  /** The original context phrase (for tokenizing translation) */
  contextPhrase?: string;
  /** Whether to show loading state */
  loading?: boolean;
}

export interface TranslationCardProps {
  content: string;
  contextPhrase?: string;
  targetWord?: string;
}

export interface ExplanationCardProps {
  title: string;
  content: string;
  word?: string;
}

export interface GrammarCardProps {
  title: string;
  points: GrammarPoint[];
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Colored Phrase - uses createResource pattern for async tokenization
 */
const ColoredPhrase: Component<{ phrase: string; targetWord?: string }> = (props) => {
  const { settings } = useSettings();
  const { tokenize } = useTokenizer({ language: settings.language });
  const { currentLangData } = useLanguage();
  
  const colourCodes = createMemo(() => {
    const langData = currentLangData();
    return langData?.colour_codes || {};
  });
  
  // Create a resource for async tokenization
  const [coloredHtml] = createResource(
    () => ({ phrase: props.phrase, target: props.targetWord, colors: colourCodes() }),
    async ({ phrase, target, colors }) => {
      if (!phrase) return phrase;
      try {
        const tokens: Token[] = await tokenize(phrase);
        if (tokens && tokens.length > 0) {
          return tokensToColoredHtml(tokens, colors, target);
        }
      } catch (e) {
        log.error("error", e);
        // Fallback to plain text
      }
      return phrase;
    }
  );
  
  return (
    <Show when={!coloredHtml.loading} fallback={<span class="explainer-phrase-loading">{props.phrase}</span>}>
      <div 
        class="explainer-card__phrase" 
        innerHTML={coloredHtml() || props.phrase} 
      />
    </Show>
  );
};

/**
 * Translation Card - shows the translated phrase with colored tokens
 */
export const TranslationCard: Component<TranslationCardProps> = (props) => {
  const { t } = useLocalization();
  
  return (
    <div class="explainer-card explainer-card--translation">
      <h4 class="explainer-card__title">{t('mlearn.Explainer.Translation')}</h4>
      <Show 
        when={props.contextPhrase}
        fallback={<p class="explainer-card__content">{props.content}</p>}
      >
        <ColoredPhrase 
          phrase={props.contextPhrase!} 
          targetWord={props.targetWord}
        />
      </Show>
      <Show when={props.content && props.content !== props.contextPhrase}>
        <p class="explainer-card__translation">{props.content}</p>
      </Show>
    </div>
  );
};

/**
 * Explanation Card - shows word explanation with the word highlighted
 */
export const ExplanationCard: Component<ExplanationCardProps> = (props) => {
  // Format content with highlighted word
  const formattedContent = createMemo(() => {
    let content = props.content;
    const word = props.word;
    
    if (word && content) {
      // Highlight occurrences of the word in various bracket formats
      const patterns = [
        new RegExp(`[「『]${escapeRegex(word)}[」』]`, 'g'),
        new RegExp(`"${escapeRegex(word)}"`, 'g'),
      ];
      
      for (const pattern of patterns) {
        content = content.replace(pattern, `<span class="explainer-highlight">${word}</span>`);
      }
    }
    
    return content;
  });
  
  return (
    <div class="explainer-card explainer-card--explanation">
      <h4 class="explainer-card__title">{props.title}</h4>
      <p class="explainer-card__content" innerHTML={formattedContent()} />
    </div>
  );
};

/**
 * Grammar Card - shows grammar points as a list of sub-cards
 */
export const GrammarCard: Component<GrammarCardProps> = (props) => {
  const { t } = useLocalization();
  
  return (
    <div class="explainer-card explainer-card--grammar">
      <h4 class="explainer-card__title">{props.title || t('mlearn.Explainer.GrammarPoints')}</h4>
      <div class="explainer-card__points">
        <For each={props.points}>
          {(point) => (
            <div class="grammar-point">
              <Show when={point.term}>
                <span class="grammar-point__term">{point.term}</span>
              </Show>
              <span class="grammar-point__description">{point.description}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * ExplainerCards - renders parsed LLM explanation as structured cards
 */
export const ExplainerCards: Component<ExplainerCardsProps> = (props) => {
  const { t } = useLocalization();
  
  return (
    <div class="explainer-cards">
      <Show when={props.loading}>
        <div class="explainer-cards__loading">
          <Spinner size={32} shape="square" />
        </div>
      </Show>
      
      <Show when={!props.loading}>
        <Show 
          when={props.data.sections.length > 0}
          fallback={
            <Show when={props.data.rawText}>
              <div class="explainer-card explainer-card--raw">
                <p class="explainer-card__content" innerHTML={props.data.rawText?.replace(/\n/g, '<br/>') || ''} />
              </div>
            </Show>
          }
        >
          <For each={props.data.sections}>
            {(section) => (
              <Show when={section.type === 'translation'}>
                <TranslationCard 
                  content={section.content || ''} 
                  contextPhrase={props.contextPhrase}
                  targetWord={props.targetWord}
                />
              </Show>
            )}
          </For>
          
          <For each={props.data.sections}>
            {(section) => (
              <Show when={section.type === 'explanation'}>
                <ExplanationCard 
                  title={section.title || t('mlearn.Explainer.Explanation')}
                  content={section.content || ''}
                  word={section.word}
                />
              </Show>
            )}
          </For>
          
          <For each={props.data.sections}>
            {(section) => (
              <Show when={section.type === 'grammar' && section.grammarPoints}>
                <GrammarCard 
                  title={section.title || t('mlearn.Explainer.GrammarPoints')}
                  points={section.grammarPoints!}
                />
              </Show>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default ExplainerCards;
