/**
 * Speculative world-context prefetch for voice turns.
 *
 * While the learner speaks, STT emits partial transcripts roughly once per
 * second. Compiling the journal context is pure and sub-millisecond, so we
 * compile eagerly (latest-wins) and reuse the result when the final transcript
 * matches the last compiled input — exactly or up to token normalization.
 * Cache entries are partitioned per participant scope and invalidated when the
 * world version changes under us.
 * Speculative work is disposable by construction: the compile is a pure
 * function with no side effects, no journal writes, and no timers.
 */

/** Partials shorter than this are early-VAD noise, not worth compiling. */
const MIN_PARTIAL_CHARS = 8;

export interface VoicePrefetchStats {
  /** Whether the last resolveFinal reused cached speculative work. */
  cacheHit: boolean;
  /** Wall time of the last actual compile (0 on cache hit). */
  compileMs: number;
}

export interface VoicePrefetch {
  /** Compile speculatively for a partial transcript (latest-wins). */
  onPartial: (text: string, scopeId?: string) => void;
  /** Resolve the context for the final transcript, reusing cached work when it matches. */
  resolveFinal: (text: string, scopeId?: string) => string;
  /** Telemetry from the most recent resolveFinal call. */
  lastStats: () => VoicePrefetchStats;
}

interface PrefetchCache {
  inputText: string;
  normalized: string;
  output: string;
  /** Partition key: which participant's view this compile belongs to. */
  scopeId: string;
  /** World version at compile time; a mismatch means the cache is stale. */
  version: string;
}

/** Lowercase token join: punctuation, case, and whitespace differences ignored. */
function normalizeTokens(text: string): string {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');
}

/**
 * `version` invalidates cached speculative work when the world changes under
 * us (journal growth, roster change): a cache entry only survives if BOTH the
 * input text and the world version still match.
 */
export function createVoicePrefetch(
  compile: (text: string, scopeId: string) => string,
  version: () => string = () => '',
): VoicePrefetch {
  let cache: PrefetchCache | null = null;
  let stats: VoicePrefetchStats = { cacheHit: false, compileMs: 0 };

  const compileNow = (text: string, scopeId: string): string => {
    const startedAt = performance.now();
    const output = compile(text, scopeId);
    stats = { cacheHit: false, compileMs: performance.now() - startedAt };
    cache = { inputText: text, normalized: normalizeTokens(text), output, scopeId, version: version() };
    return output;
  };

  const fresh = (scopeId: string): boolean =>
    cache !== null && cache.scopeId === scopeId && cache.version === version();

  return {
    onPartial(text, scopeId = '') {
      if (text.length < MIN_PARTIAL_CHARS) return;
      // Latest-wins: compile is sync and pure, so input-equality against the
      // cached entry (same scope, same world version) is the entire
      // single-flight story.
      if (fresh(scopeId) && cache!.inputText === text) return;
      compileNow(text, scopeId);
    },
    resolveFinal(text, scopeId = '') {
      if (fresh(scopeId)) {
        const matches = cache!.inputText === text || cache!.normalized === normalizeTokens(text);
        if (matches) {
          stats = { cacheHit: true, compileMs: 0 };
          return cache!.output;
        }
      }
      return compileNow(text, scopeId);
    },
    lastStats: () => stats,
  };
}
