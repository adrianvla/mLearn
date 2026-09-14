/**
 * Canonical model-content boundary.
 *
 * Model output is control-bearing text. Providers may deliver reasoning as
 * dedicated `thinking` fields (transported here wrapped in `<think>` regions),
 * and some models leak reasoning conventions directly into ordinary content —
 * for example a `[Thinking]` label followed by a `<channel|>` speech marker.
 * Neither is character speech: reasoning text must never become user-visible
 * dialogue, journal content, learner evidence, or inferred actions.
 *
 * `sanitizeModelSpeech` is the one shared transform for that boundary. Apply it
 * wherever model output becomes character speech: agent streaming/finalization,
 * journal-draft persistence, and the display/history projections of persisted
 * events (idempotent, so pre-existing rows render clean too). Human-authored
 * text is never passed through this function.
 */

/** Control tokens that can open a reasoning region. */
const OPENERS = ['<think>', '[thinking]'] as const;
/** Control tokens that close reasoning or mark where speech resumes. */
const CLOSERS = ['</think>', '[/thinking]', '<|channel|>', '<channel|>', '<|channel>', '<channel>'] as const;
const ALL_MARKERS = [...OPENERS, ...CLOSERS] as const;

const OPENER_PATTERN = /<think>|\[thinking\]/i;
const THINK_CLOSE_PATTERN = /<\/think>/i;
const LABEL_CLOSE_PATTERN = /\[\/thinking\]|<\|?channel\|?>/i;
const STRAY_TOKEN_PATTERN = /<\/?think>|\[\/?thinking\]|<\|?channel\|?>/gi;

const LONGEST_MARKER = Math.max(...ALL_MARKERS.map((marker) => marker.length));

/**
 * Remove reasoning regions and control markers from model output.
 *
 * Semantics:
 * - A `<think>…</think>` region is dropped entirely.
 * - A `[thinking]` label begins a reasoning region that ends at `[/thinking]`
 *   or a `<channel|>`-family marker; speech after the marker is kept.
 * - An unterminated reasoning region runs to the end of the output and is
 *   dropped; while `streaming`, it is withheld so it can still close cleanly
 *   in a later chunk.
 * - Stray closing/channel tokens are deleted wherever they appear.
 * - While `streaming`, a trailing partial marker is withheld until the next
 *   chunk disambiguates it.
 *
 * The function is pure and idempotent; it never rewrites human text because
 * callers only pass model-produced character speech.
 */
export function sanitizeModelSpeech(content: string, streaming = false): string {
  let speech = '';
  let rest = content;
  for (;;) {
    const open = OPENER_PATTERN.exec(rest);
    if (open === null) {
      speech += rest;
      break;
    }
    speech += rest.slice(0, open.index);
    rest = rest.slice(open.index + open[0].length);
    const isThinkTag = open[0].toLowerCase() === '<think>';
    const close = (isThinkTag ? THINK_CLOSE_PATTERN : LABEL_CLOSE_PATTERN).exec(rest);
    if (close !== null) {
      rest = rest.slice(close.index + close[0].length);
      continue;
    }
    // Unterminated reasoning region: never speech. Withhold it while streaming
    // (a later chunk may close it; the full text is re-sanitized each chunk)
    // and drop it once the response is final.
    rest = '';
    break;
  }
  speech = speech.replace(STRAY_TOKEN_PATTERN, '');
  if (streaming) speech = withHeldPartialMarker(speech);
  return speech.trim();
}

/** Withhold a trailing fragment that could still grow into a control marker. */
function withHeldPartialMarker(text: string): string {
  const max = Math.min(text.length, LONGEST_MARKER - 1);
  for (let cut = max; cut >= 1; cut--) {
    const suffix = text.slice(text.length - cut);
    if (ALL_MARKERS.some((marker) => marker.toLowerCase().startsWith(suffix.toLowerCase()))) {
      return text.slice(0, text.length - cut);
    }
  }
  return text;
}

/**
 * Sanitize the text payload of a journal message event. Human messages are
 * returned untouched; character messages pass through the canonical boundary
 * so persisted rows written before the boundary existed still project clean.
 */
export function sanitizeJournalMessageText(type: string, text: string): string {
  return type === 'message.character' ? sanitizeModelSpeech(text) : text;
}
