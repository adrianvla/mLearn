/**
 * Markdown Renderer for Conversation Agent
 *
 * Renders markdown content with optional tokenized POS coloring.
 * - Streaming (no tokens): renders markdown HTML via `marked`
 * - Tokenized: renders markdown structure with ChatToken components
 *   preserving both formatting and POS color information.
 */

import { Component, For, Show, createMemo, JSX } from 'solid-js';
import { Marked, type Token as MarkedToken, type Tokens } from 'marked';
import type { Token } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import './MarkdownRenderer.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.conversationAgent.markdownRenderer");

// ============================================================================
// Markdown → HTML (streaming / plain fallback)
// ============================================================================

const markedInstance = new Marked({ breaks: true, gfm: true, async: false });

/**
 * Parse markdown content to sanitized HTML string.
 * Used during streaming when tokens are not yet available.
 */
export function parseMarkdownToHtml(content: string): string {
  if (!content) return '';
  try {
    // Use parseInline for single-line chat messages to avoid wrapping in <p>
    const trimmed = content.trim();
    // If the content has multiple lines / paragraphs, use full parse
    if (trimmed.includes('\n\n') || trimmed.includes('```') || trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      return markedInstance.parse(trimmed) as string;
    }
    return markedInstance.parseInline(trimmed) as string;
  } catch (e) {
    log.error("error", e);
    return content;
  }
}

// ============================================================================
// Markdown structure → JSX nodes with POS-colored tokens
// ============================================================================

/**
 * Build a flat list of "text characters" from the raw markdown source,
 * mapping each rendered character to its position in the NLP token array.
 *
 * The idea: marked.lexer gives us the AST structure; we walk it,
 * and for every *visible text* leaf we encounter, we consume the next
 * NLP tokens whose `.word` characters match.
 */

interface TokenConsumer {
  tokens: Token[];
  pos: number;
}

/** Advance the consumer past markdown-syntax characters that the tokenizer may have emitted */
function skipMarkdownSyntax(consumer: TokenConsumer): void {
  while (consumer.pos < consumer.tokens.length) {
    const word = consumer.tokens[consumer.pos].word;
    if (/^(\*{1,3}|_{1,3}|~{2}|`{1,3}|#{1,6}\s?)$/.test(word)) {
      consumer.pos++;
    } else {
      break;
    }
  }
}

/** Consume NLP tokens that match `text`, returning the matched tokens */
function consumeTokensForText(consumer: TokenConsumer, text: string): Token[] {
  if (!text) return [];

  const result: Token[] = [];
  let textPos = 0;

  while (textPos < text.length && consumer.pos < consumer.tokens.length) {
    skipMarkdownSyntax(consumer);
    if (consumer.pos >= consumer.tokens.length) break;

    const token = consumer.tokens[consumer.pos];
    const word = token.word;

    // Check if the current token's word matches at the current position in text
    if (text.startsWith(word, textPos)) {
      result.push(token);
      textPos += word.length;
      consumer.pos++;
    } else if (word.length > 0 && text[textPos] === word[0]) {
      // Partial match — the token might span across markdown boundaries
      result.push(token);
      textPos += word.length;
      consumer.pos++;
    } else {
      // Mismatch — try to skip whitespace alignment
      if (/^\s+$/.test(text[textPos])) {
        result.push({ word: text[textPos], type: '', partOfSpeech: '' } as Token);
        textPos++;
      } else {
        // Push remaining text as a plain token with word content
        result.push({ word: text[textPos], type: '', partOfSpeech: '' } as Token);
        textPos++;
      }
    }
  }

  // If we didn't consume all the text, add remainder as plain token
  if (textPos < text.length) {
    result.push({ word: text.slice(textPos), type: '', partOfSpeech: '' } as Token);
  }

  return result;
}

// ============================================================================
// Tokenized Markdown Renderer Component
// ============================================================================

interface ChatTokenProps {
  token: Token;
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode: WordHoverTriggerMode;
  triggerKey: string;
}

interface MarkdownRendererProps {
  content: string;
  tokens?: Token[];
  isStreaming?: boolean;
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode: WordHoverTriggerMode;
  triggerKey: string;
  /** The ChatToken component to use for rendering individual tokens */
  renderToken: Component<ChatTokenProps>;
}

export const MarkdownRenderer: Component<MarkdownRendererProps> = (props) => {
  const htmlContent = createMemo(() => {
    if (props.tokens && props.tokens.length > 0) return '';
    return parseMarkdownToHtml(props.content);
  });

  const tokenizedNodes = createMemo(() => {
    if (!props.tokens || props.tokens.length === 0) return null;

    const consumer: TokenConsumer = { tokens: props.tokens, pos: 0 };
    let ast: MarkedToken[];
    try {
      ast = markedInstance.lexer(props.content);
    } catch (e) {
      log.error("error", e);
      return null;
    }
    return renderMarkedTokens(ast, consumer, props);
  });

  return (
    <Show
      when={tokenizedNodes()}
      fallback={
        <span class="ca-markdown" innerHTML={htmlContent()} />
      }
    >
      <span class="ca-markdown">{tokenizedNodes()}</span>
    </Show>
  );
};

// ============================================================================
// Recursive AST → JSX renderer
// ============================================================================

function renderMarkedTokens(
  tokens: MarkedToken[],
  consumer: TokenConsumer,
  props: MarkdownRendererProps,
): JSX.Element[] {
  const elements: JSX.Element[] = [];

  for (const mt of tokens) {
    const el = renderMarkedToken(mt, consumer, props);
    if (el !== null && el !== undefined) {
      if (Array.isArray(el)) {
        elements.push(...el);
      } else {
        elements.push(el);
      }
    }
  }

  return elements;
}

function renderTextTokens(
  text: string,
  consumer: TokenConsumer,
  props: MarkdownRendererProps,
): JSX.Element {
  const consumed = consumeTokensForText(consumer, text);
  const TokenComp = props.renderToken;

  return (
    <For each={consumed}>
      {(token) => (
        <TokenComp
          token={token}
          onTokenHover={props.onTokenHover}
          onTokenLeave={props.onTokenLeave}
          triggerMode={props.triggerMode}
          triggerKey={props.triggerKey}
        />
      )}
    </For>
  );
}

function renderInlineTokens(
  tokens: MarkedToken[] | undefined,
  consumer: TokenConsumer,
  props: MarkdownRendererProps,
): JSX.Element[] {
  if (!tokens || tokens.length === 0) return [];
  return renderMarkedTokens(tokens, consumer, props);
}

function renderMarkedToken(
  mt: MarkedToken,
  consumer: TokenConsumer,
  props: MarkdownRendererProps,
): JSX.Element | JSX.Element[] | null {
  switch (mt.type) {
    case 'text': {
      const textToken = mt as Tokens.Text;
      if (textToken.tokens) {
        return renderInlineTokens(textToken.tokens, consumer, props);
      }
      return renderTextTokens(textToken.raw, consumer, props);
    }

    case 'paragraph': {
      const para = mt as Tokens.Paragraph;
      skipMarkdownSyntax(consumer);
      const children = renderInlineTokens(para.tokens, consumer, props);
      return <p class="ca-md-p">{children}</p>;
    }

    case 'strong': {
      const strong = mt as Tokens.Strong;
      skipMarkdownSyntax(consumer);
      const children = renderInlineTokens(strong.tokens, consumer, props);
      skipMarkdownSyntax(consumer);
      return <strong>{children}</strong>;
    }

    case 'em': {
      const em = mt as Tokens.Em;
      skipMarkdownSyntax(consumer);
      const children = renderInlineTokens(em.tokens, consumer, props);
      skipMarkdownSyntax(consumer);
      return <em>{children}</em>;
    }

    case 'del': {
      const del = mt as Tokens.Del;
      skipMarkdownSyntax(consumer);
      const children = renderInlineTokens(del.tokens, consumer, props);
      skipMarkdownSyntax(consumer);
      return <del>{children}</del>;
    }

    case 'codespan': {
      const code = mt as Tokens.Codespan;
      skipMarkdownSyntax(consumer);
      // Code spans: skip consuming tokens, render as plain code
      const codeTokens = consumeTokensForText(consumer, code.text);
      skipMarkdownSyntax(consumer);
      return <code class="ca-md-code">{codeTokens.map((t) => t.word).join('')}</code>;
    }

    case 'code': {
      const codeBlock = mt as Tokens.Code;
      // Skip all tokens that correspond to the code block
      const codeTokens = consumeTokensForText(consumer, codeBlock.text);
      skipMarkdownSyntax(consumer);
      return (
        <pre class="ca-md-pre">
          <code>{codeTokens.map((t) => t.word).join('')}</code>
        </pre>
      );
    }

    case 'heading': {
      const heading = mt as Tokens.Heading;
      skipMarkdownSyntax(consumer);
      const children = renderInlineTokens(heading.tokens, consumer, props);
      return <strong class="ca-md-heading">{children}</strong>;
    }

    case 'list': {
      const list = mt as Tokens.List;
      const items = list.items.map((item) => {
        skipMarkdownSyntax(consumer);
        const children = renderMarkedTokens(item.tokens, consumer, props);
        return <li>{children}</li>;
      });
      return list.ordered
        ? <ol class="ca-md-list">{items}</ol>
        : <ul class="ca-md-list">{items}</ul>;
    }

    case 'list_item': {
      const item = mt as Tokens.ListItem;
      const children = renderMarkedTokens(item.tokens, consumer, props);
      return <li>{children}</li>;
    }

    case 'blockquote': {
      const bq = mt as Tokens.Blockquote;
      const children = renderMarkedTokens(bq.tokens, consumer, props);
      return <blockquote class="ca-md-blockquote">{children}</blockquote>;
    }

    case 'br':
      return <br />;

    case 'hr':
      return <hr class="ca-md-hr" />;

    case 'space':
      return null;

    case 'escape': {
      const esc = mt as Tokens.Escape;
      return renderTextTokens(esc.text, consumer, props);
    }

    case 'link': {
      const link = mt as Tokens.Link;
      const children = renderInlineTokens(link.tokens, consumer, props);
      return <a href={link.href} target="_blank" rel="noopener noreferrer" class="ca-md-link">{children}</a>;
    }

    default:
      // For unknown token types, try to render the raw text
      if ('raw' in mt && typeof mt.raw === 'string') {
        return renderTextTokens(mt.raw, consumer, props);
      }
      return null;
  }
}
