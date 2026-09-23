import { Component, For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { useLocalization } from '../../context';
import {
  DiagnosticSession,
  type DiagnosticQuality,
  type DiagnosticResult,
} from '../../learning/diagnosticSampling';
import { TimingBaseline } from '../../learning/timingBaseline';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../shared/encounterTiming';
import type { AttemptQuality } from '../../../shared/constants';
import {
  parseHistoricalBackgroundRecords,
  type HistoricalBackgroundKind,
  type HistoricalBackgroundRecord,
  type HistoricalBackgroundScore,
} from '../../../shared/learningBackground';
import './GrammarCoverage.css';
import './PlacementSession.css';

export interface PlacementPool {
  /** Raw level on the package's own scale. */
  level: number;
  /** Package-owned display label. */
  label: string;
  /** Untracked candidate words of this level (caller-chosen order). */
  words: string[];
}

export interface PlacementSessionProps {
  language: string;
  /** Difficulty-ascending live pools; empty pools are omitted by the caller. */
  pools: PlacementPool[];
  /** Current-package validator: the word must still exist at that level. */
  isWordAtLevel: (word: string, level: number) => boolean;
  /** Dated historical background records for this language (R09). */
  background: HistoricalBackgroundRecord[];
  onAddBackground: (record: HistoricalBackgroundRecord) => void;
  onRemoveBackground: (id: string) => void;
  /** The learner's currently declared level on the package scale, if any. */
  declaredLevel: number | null;
  /** Package-aware difficulty comparison: is `level` at or easier than
   *  `target` on THIS package's own scale (raw numbers may order inversely). */
  isLevelAtOrEasierThan: (level: number, target: number) => boolean;
  /**
   * True while the hosting tab's projections/knowledge are reloading (e.g.
   * right after a rating bumped eventsVersion). The session MUST stay mounted
   * through these flips — the caller renders this component OUTSIDE its
   * loading gate — and only the DOM hides; timing stops while hidden.
   */
  booting?: boolean;
  /** First-class assessment entry point, without the embedded disclosure. */
  focused?: boolean;
  /** Web Locks DI seam. Production resolves `globalThis.navigator.locks`
   *  (Chromium renderers); when absent (or explicitly `null`), placement is
   *  DISABLED with a localized fallback (G04) instead of running an
   *  unserialized multi-tab session — cursor reads are not atomic without a
   *  real lock. */
  locks?: PlacementLocks | null;
  /** Exclusion policy predicate for the resolved learning language. When the
   *  PENDING word becomes ignored mid-session, it is auto-skipped without
   *  evidence — ignored words are never tested (G04). */
  isWordIgnored?: (word: string) => boolean;
  /** Records a REAL canonical attempt for the sampled word (origin 'placement'). */
  onRate: (word: string, level: number, quality: AttemptQuality, timing: AttemptTiming | null) => void;
  /** Explicit learner consent to move their declared level (never implicit). */
  onApplyPlacement: (level: number) => void;
}

/**
 * Durable placement resume (G01), mirroring the grammar-pass storage
 * contract: the session's OWN pool snapshot and sampled outcomes survive
 * unmount/restart, bound to the exact pool multiset they were planned under.
 * The snapshot — not the live untracked pools — drives the sampler, because
 * every rated word leaves the live pool mid-session. Restoration validates
 * the snapshot against the CURRENT package data (each word must still exist
 * at its level); corrupt entries or changed curricula are discarded, never
 * resumed. Storage unavailability degrades to no-resume silently.
 */
const placementStorageKey = (language: string): string => `mlearn-placement:${language}`;

/** Per-session identity nonce (G01 session integrity): collisions cannot be
 *  ruled out on exotic runtimes, so the fallback mixes wall clock and two
 *  independent random draws. */
const newSessionId = (): string => {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Minimal Web Locks surface (Chromium renderers provide it). DI seam for
 *  tests; when genuinely unavailable the idle Start affordance is disabled
 *  with a localized fallback (G04) instead of running an unserialized
 *  multi-tab session. */
export interface PlacementLocks {
  request: (name: string, callback: () => void | Promise<void>) => Promise<void>;
}

interface StoredPlacement {
  /** The learning language this session belongs to; validated on restore so a
   *  cross-language (or copied) entry can never be loaded under another key. */
  language: string;
  /** Per-session identity nonce minted at startSession. Session integrity
   *  (G01): a stale queued submission must be able to tell the session it
   *  was rating from a REPLACEMENT session written while it waited for the
   *  lock — dismiss+restart or a concurrent tab's fresh start can produce a
   *  durable entry with the same denominator and even the same (zero) draw
   *  count, which content or length comparison alone cannot distinguish. */
  sessionId: string;
  denominator: string;
  pools: PlacementPool[];
  /** Every presented word in presentation order — outcomes AND skips — so a
   *  resume replays the exact deterministic draw sequence. */
  draws: Array<{ key: string; level: number; outcome: DiagnosticQuality | 'skipped' }>;
}

function poolDenominator(pools: readonly PlacementPool[]): string {
  const entries: string[] = [];
  for (const pool of pools) {
    for (const word of pool.words) entries.push(`${word}\u0000${pool.level}`);
  }
  return entries.sort().join('\u0001');
}

function loadStoredPlacement(
  language: string,
  isWordAtLevel: (word: string, level: number) => boolean,
): StoredPlacement | null {
  try {
    const raw = globalThis.localStorage?.getItem(placementStorageKey(language));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlacement;
    const poolsValid = Array.isArray(parsed?.pools)
      && parsed.pools.length > 0
      && parsed.pools.every((pool) => (
        typeof pool?.level === 'number'
          && typeof pool?.label === 'string'
          && Array.isArray(pool.words)
          && pool.words.length > 0
          && pool.words.every((word) => typeof word === 'string' && isWordAtLevel(word, pool.level))
      ));
    if (!poolsValid) return null;
    if (parsed.language !== language) return null;
    if (typeof parsed.sessionId !== 'string' || parsed.sessionId === '') return null;
    const OUTCOMES: ReadonlyArray<DiagnosticQuality | 'skipped'> = ['fluent', 'struggled', 'missed', 'skipped'];
    const drawsValid = Array.isArray(parsed?.draws)
      && parsed.draws.every((draw) => (
        typeof draw?.key === 'string'
          && typeof draw?.level === 'number'
          && OUTCOMES.includes(draw.outcome)
          && parsed.pools.some((pool) => pool.level === draw.level && pool.words.includes(draw.key))
      ));
    if (!drawsValid) return null;
    if (parsed.denominator !== poolDenominator(parsed.pools)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredPlacement(language: string, stored: StoredPlacement | null): boolean {
  const storage = globalThis.localStorage;
  if (storage === undefined || storage === null) return false;
  try {
    // Only an explicit null (completion/dismiss) removes the entry: a
    // zero-draw start state IS durably written, so an interruption right
    // after Start resumes into the waiting first prompt instead of losing
    // the session (G01).
    if (stored === null) {
      storage.removeItem(placementStorageKey(language));
    } else {
      storage.setItem(placementStorageKey(language), JSON.stringify(stored));
    }
    // The caller MUST treat false as "cursor not durable": a rating whose
    // cursor cannot be persisted is refused (no evidence without a cursor).
    return true;
  } catch {
    return false;
  }
}

/**
 * Replays a stored draw list into a fresh sampler. Returns null when ANY
 * draw is not exactly the pending pick at its position (reordered, foreign,
 * or duplicated entries) — the whole entry is then invalid and must be
 * discarded, never partially resumed (G01): the draw order is deterministic,
 * so any deviation means the stored state does not belong to this plan.
 */
function replayPlacement(
  pools: readonly PlacementPool[],
  draws: StoredPlacement["draws"],
): DiagnosticSession | null {
  const session = new DiagnosticSession(
    pools.map((pool) => ({ id: String(pool.level), label: pool.label, items: pool.words })),
  );
  for (const draw of draws) {
    const pick = session.pick();
    if (pick === null || pick.key !== draw.key) return null;
    if (draw.outcome === "skipped") session.skip(draw.key);
    else session.record(draw.key, draw.outcome);
  }
  return session;
}

const KIND_OPTIONS: readonly HistoricalBackgroundKind[] = ["exam", "school", "self-assessment"];

/** Composes a record's supplied scores for display: overall first, then each
 *  per-skill entry — exactly what the learner entered, verbatim. */
const suppliedScoreText = (record: HistoricalBackgroundRecord): string => {
  const parts: string[] = [];
  if (record.score?.overall !== undefined) parts.push(record.score.overall);
  if (record.score?.skills !== undefined) {
    for (const [skill, value] of Object.entries(record.score.skills)) parts.push(`${skill} ${value}`);
  }
  return parts.join(' · ');
};

/** Collision-resistant background-record ID (Codex POST_REVIEW minor:
 *  separate renderer windows run separate module instances, so a
 *  module-scoped counter cannot disambiguate two windows in the same
 *  millisecond; removal filters by ID alone and would then drop both
 *  records). Mirrors `newSessionId`: UUID when available, otherwise wall
 *  clock plus two independent random draws. */
export const nextBackgroundId = (): string => {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Optional returning-learner placement (R09).
 *
 * A dated historical result (exam, school course, self-assessment) is
 * recorded as BACKGROUND for the current language — records are
 * display/storage only for now (guiding the sampler's starting scope is a
 * W04 policy concern), and they mass-claim nothing. "Check my level" runs a
 * small category-balanced adaptive probe over the package's own level bands,
 * sampling untracked words only; every rated word produces real canonical
 * evidence through onRate, and every UNSAMPLED word stays unmeasured. The
 * recommendation is a suggestion with a visible trace; applying it to the
 * declared level is always an explicit learner action. Skip advances without
 * recording (G04). A session never starts by itself: the probe runs only
 * after the learner presses Start, and collapses back to nothing otherwise.
 */
export const PlacementSession: Component<PlacementSessionProps> = (props) => {
  const { t } = useLocalization();
  const [expanded, setExpanded] = createSignal(false);
  const [formOpen, setFormOpen] = createSignal(false);
  const [formKind, setFormKind] = createSignal<HistoricalBackgroundKind>('exam');
  const [formLabel, setFormLabel] = createSignal('');
  const [formLevel, setFormLevel] = createSignal('');
  const [formDate, setFormDate] = createSignal('');
  const [formNote, setFormNote] = createSignal('');
  const [formSkills, setFormSkills] = createSignal('');
  /** Supplied overall score, verbatim as printed on the source (R09). */
  const [formScoreOverall, setFormScoreOverall] = createSignal('');
  /** Per-skill supplied scores keyed by the parsed skill token. Only tokens
   *  still present in the skills field are read at save time. */
  const [formSkillScores, setFormSkillScores] = createSignal<Record<string, string>>({});

  /** The skills field parsed into tokens: comma-separated, learner's own
   *  wording, empty tokens dropped — the exact per-skill score key set. */
  const parsedFormSkills = createMemo(() =>
    formSkills().split(',').map((skill) => skill.trim()).filter((skill) => skill !== ''),
  );

  const [stored, setStored] = createSignal<StoredPlacement | null>(
    loadStoredPlacement(props.language, props.isWordAtLevel),
  );
  const [storedLanguage, setStoredLanguage] = createSignal<string>(props.language);
  /** Exact serialized value of the LAST durable write this component made, so
   *  its own storage events (when they fire) are ignored by onStorage. */
  let lastWrittenValue: string | null = null;
  /** Single write-through for every durable change: records the exact serialized
   *  value (for self-write suppression) before delegating to the storage key. */
  const persistTo = (language: string, entry: StoredPlacement | null): boolean => {
    lastWrittenValue = entry === null ? null : JSON.stringify(entry);
    return saveStoredPlacement(language, entry);
  };
  /** Per-language response-latency baseline (R11): reset on a language switch so
   *  cross-language medians are never compared. */
  const [baseline, setBaseline] = createSignal<TimingBaseline>(new TimingBaseline());
  /** Bumped after every in-place baseline sample so dependent memos
   *  (the summary's task-response median) re-evaluate — the baseline object
   *  itself is mutated without a signal write. */
  const [baselineVersion, bumpBaselineVersion] = createSignal(0);

  // Well-known browser global (Navigator.locks); the typed view is the DI
  // seam's resolution, not unchecked external input.
  // happy-dom/Node report `navigator.locks` as null (not undefined), so the
  // typed view must treat both as absent.
  const globalLocks = globalThis as { navigator?: { locks?: PlacementLocks | null } };
  // An explicit `locks` prop (null included) overrides the global resolution,
  // so tests can deterministically disable the probe even where a global
  // lock exists; undefined falls through to the production navigator.
  const locksApi = createMemo(() => {
    if (props.locks !== undefined) return props.locks;
    return globalLocks.navigator?.locks ?? null;
  });
  /** Without a real lock primitive there is no atomic multi-tab claim: the
   *  probe is disabled (G04) rather than unsafe. */
  const locksAvailable = createMemo(() => locksApi() != null);

  /** Serializes read → cursor-advance → evidence across tabs. The critical
   *  section re-checks the pending pick and the durable cursor: while a
   *  submission waited for the lock, another tab may have consumed the word,
   *  completed or removed the session — the stale submission is dropped (or
   *  the removal adopted) instead of duplicating evidence (G01). */
  const inPlacementLock = (language: string, critical: () => void): void => {
    const locks = locksApi();
    if (locks == null) return;
    void locks.request(`mlearn-placement:${language}`, critical);
  };

  /** Adopt-or-reject against the durable state from inside a lock: returns
   *  true when the caller must drop its submission because another surface
   *  advanced, removed or REPLACED the shared session (session identity,
   *  not draw count, distinguishes a dismiss+restart from the rated session). */
  const adoptDurableChanges = (active: StoredPlacement): boolean => {
    // During a boot flip the validator rejects every word (empty frequency
    // map) and loadStoredPlacement returns null for a perfectly valid
    // session — that is NOT an external removal. Submissions cannot happen
    // while booting (the probe DOM is hidden); if one ever reaches here,
    // drop it without touching durable storage.
    if (props.booting) return true;
    const submissionLanguage = active.language;
    const fresh = loadStoredPlacement(submissionLanguage, props.isWordAtLevel);
    if (fresh === null) {
      // Removed elsewhere (another tab completed or dismissed), or storage
      // became unavailable: adopt the removal / refuse the write instead of
      // resurrecting the session — evidence never outlives its cursor.
      persistTo(submissionLanguage, null);
      setStored(null);
      return true;
    }
    if (fresh.sessionId !== active.sessionId) {
      // A different session identity is on disk: another surface dismissed
      // and restarted, or started a replacement, while this submission waited
      // for the lock. The stale submission belongs to a session that no
      // longer exists — adopt the replacement (its own cursor) and drop it;
      // equal denominator or draw counts cannot legitimize it (G01).
      setStored(fresh);
      return true;
    }
    if (fresh.draws.length > active.draws.length) {
      setStored(fresh); // adopt the other tab's cursor; drop the stale submission
      return true;
    }
    return false;
  };
  /** The learning language the in-memory session belongs to. Guards the
   *  persistence effect so a stale snapshot (from before a language switch)
   *  is never written under the NEW language's storage key, and lets a
   *  cross-tab reload land on the right language. */


  /** Strict replay: null when the stored draw list no longer replays exactly
   *  (reordered/foreign rows) — such an entry is corrupt and discarded below. */
  const replay = createMemo(() => {
    const active = stored();
    if (active === null) return null;
    return replayPlacement(active.pools, active.draws);
  });

  // A stored entry whose draws do not replay exactly is corrupt (G01):
  // clear it and fall back to a fresh Start rather than partially resuming.
  createEffect(() => {
    if (stored() !== null && replay() === null) {
      persistTo(stored()!.language, null);
      setStored(null);
    }
  });

  const sampler = replay;

  const sampledCount = createMemo(() => sampler()?.result().sampledCount ?? 0);
  const pendingPick = createMemo(() => sampler()?.pick() ?? null);
  /** The word currently on screen: rate/skip handlers must still present it. */
  const presentedWord = createMemo(() => pendingPick()?.key ?? null);

  const placementResult = createMemo<DiagnosticResult | null>(() => {
    const session = sampler();
    if (stored() === null || session === null) return null;
    return pendingPick() === null ? session.result() : null;
  });

  /** A live prompt is on screen: session started, not finished. */
  const sessionLive = createMemo(() => stored() !== null && pendingPick() !== null);


  // Language switch: drop the PREVIOUS language's in-memory session, baseline
  // and expanded panel. This runs FIRST on a language change (created before
  // the restore effect below), then restore reloads the new language's session.
  createEffect(on(() => props.language, () => {
    setStored(null);
    setStoredLanguage(props.language);
    setExpanded(false);
    setBaseline(new TimingBaseline());
  }, { defer: true }));
  // Restore/swap the durable session (G01). Deferred past mount and gated on
  // `booting`: while the package data is absent (the tab mounts this panel
  // before its projections exist), the word validator cannot trust the empty
  // frequency map, so restore waits for the first ready flip instead of
  // discarding a durable session. A finished summary in memory is never
  // clobbered by a reload; mid-session reloads are lossless because every
  // draw is persisted synchronously.
  createEffect(on([() => props.language, () => props.isWordAtLevel, () => props.booting], ([language, isWordAtLevel, booting]) => {
    if (booting) return;
    if (placementResult() !== null) return; // summary stays until dismissed
    const loaded = loadStoredPlacement(language, isWordAtLevel);
    if (loaded === null && stored() === null) return;
    setStored(loaded);
    setStoredLanguage(language);
  }, { defer: true }));



  // Cross-tab arbitration (G01): multiple Level Study tabs share localStorage.
  // When another tab persists a draw, reload this tab's session (validating
  // and replaying it) so the shared pending word cannot be rated twice — the
  // rate() presented-key identity guard then rejects the now-stale click.
  // Self-writes are skipped by value; an in-memory finished summary is never
  // clobbered by a reload.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== placementStorageKey(props.language)) return;
    // Suppress only our own non-removal writes by value: a removal
    // (newValue null) from ANY tab — including this one — must propagate so
    // a tab that never wrote still drops its stale session.
    if (event.newValue !== null && event.newValue === lastWrittenValue) return;
    if (props.booting) return; // validator untrustworthy while loading
    if (placementResult() !== null) return; // summary stays until dismissed
    const reloaded = loadStoredPlacement(props.language, props.isWordAtLevel);
    if (reloaded === null && stored() === null) return;
    setStored(reloaded);
    setStoredLanguage(props.language);
  };
  globalThis.addEventListener('storage', onStorage);
  onCleanup(() => globalThis.removeEventListener('storage', onStorage));

  const placementLevel = createMemo(() => {
    const categoryId = placementResult()?.placement?.categoryId;
    if (categoryId === undefined) return null;
    const level = Number(categoryId);
    return Number.isFinite(level) ? level : null;
  });

  // Persist after every sample; a completed session removes its entry (the
  // summary stays in memory until dismissed). A stale snapshot from before a
  // language switch is never written under the new language's key.
  createEffect(() => {
    const active = stored();
    if (active === null) return;
    if (storedLanguage() !== props.language) return;
    if (placementResult() !== null) persistTo(active.language, null);
    else persistTo(active.language, active);
  });

  const dismissSession = () => {
    persistTo(props.language, null);
    setStored(null);
  };

  const startSession = () => {
    if (props.pools.length === 0) return;
    const startLanguage = props.language;
    const startIsWordAtLevel = props.isWordAtLevel;
    const startPools = props.pools;
    const next: StoredPlacement = { language: startLanguage, sessionId: newSessionId(), denominator: poolDenominator(startPools), pools: startPools, draws: [] };
    inPlacementLock(startLanguage, () => {
      // A concurrent tab may already hold a session for this language: adopt
      // it (re-summon its cursor) instead of clobbering it with a fresh start.
      const existing = loadStoredPlacement(startLanguage, startIsWordAtLevel);
      if (existing !== null && existing.language === startLanguage) { setStored(existing); return; }
      // A session that cannot be durably written must not start: ratings
      // would be refused for lack of a cursor (G01), so surface the failure
      // instead of a silently broken probe (G04).
      if (!persistTo(startLanguage, next)) {
        setStorageUnavailable(true);
        return;
      }
      setStorageUnavailable(false);
      // The lock resolved under a language switch: the entry belongs to the
      // captured start language, never to whatever is live now (G01/R19).
      if (props.language !== startLanguage) return;
      setStoredLanguage(startLanguage);
      setStored(next);
    });
  };

  // Active-engagement timing per prompt (shared encounter instrumentation):
  // blur/hidden pauses are excluded from activeLatencyMs; focus-stalled rows
  // are excluded from the personal baseline but still recorded as audit.
  // The timer exists ONLY while a live prompt is on screen — idle, collapsed
  // or summary time never enters any rating's activeLatencyMs.
  let encounterTimer: EncounterTimer | null = null;
  const stopTiming = (): AttemptTiming | null => {
    const timing = encounterTimer?.stop() ?? null;
    encounterTimer?.dispose();
    encounterTimer = null;
    return timing;
  };
  onCleanup(() => stopTiming());


  // One timer per presented prompt: the effect keys on the presented word
  // while the expanded panel shows a live session. Collapsing or a boot flip
  // (projection reload) stops the timer — off-screen time is not retrieval
  // time; re-expanding starts a fresh one. Idle/collapsed/summary time never
  // enters any activeLatencyMs.
  createEffect(on(() => ((props.focused || expanded()) && sessionLive() && !props.booting ? presentedWord() : null), (promptWord) => {
    stopTiming();
    if (promptWord !== null) {
      encounterTimer = createEncounterTimer();
      encounterTimer.start();
    }
  }));

  /** Presentation-beat lock + gesture truth, identical contract to the
   *  grammar pass: a double-click's trailing activation (detail > 1) and
   *  key auto-repeat are the SAME gesture as the previous rating and are
   *  rejected outright; the 150 ms beat is defense-in-depth. */
  const [submissionsLocked, setSubmissionsLocked] = createSignal(false);
  /** True when a durable write failed (quota/private storage): Start is
   *  disabled with an honest message instead of a session that cannot keep
   *  its cursor (G01/G04). */
  const [storageUnavailable, setStorageUnavailable] = createSignal(false);
  let submissionLockTimer: number | undefined;
  onCleanup(() => clearTimeout(submissionLockTimer));

  const rate = (quality: AttemptQuality, presented: string | undefined) => {
    if (submissionsLocked()) return;
    const pick = pendingPick();
    if (pick === null || presented !== pick.key) return;
    const pool = stored()?.pools.find((candidate) => String(candidate.level) === pick.categoryId);
    if (pool === undefined) return;
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    const timing = stopTiming();
    const cleanSample = timing !== null && !timing.interrupted && !timing.stalled;
    // Durable cursor FIRST, in the same synchronous handler as the evidence
    // write: a crash between the two can consume an item once without its
    // outcome, but can never leave evidence behind while the cursor still
    // points at the word — resume would re-present and duplicate it (G01).
    const submissionLanguage = stored()?.language ?? props.language;
    inPlacementLock(submissionLanguage, () => {
      // Re-verify under the serialized claim: awaiting the lock lets another
      // tab consume or remove the session; the stale submission is then
      // dropped by adoption (never duplicate evidence).
      const currentPick = pendingPick();
      if (currentPick === null || currentPick.key !== pick.key) return;
      const active = stored();
      const livePool = active?.pools.find((candidate) => String(candidate.level) === currentPick.categoryId);
      if (active === null || livePool === undefined) return;
      // The lock resolved under a language switch: the in-memory session
      // belongs to its stored language, never to whatever is live now — the
      // callback runs against the captured session or not at all (G01/R19).
      if (props.language !== active.language) return;
      if (adoptDurableChanges(active)) return;
      // Re-check exclusion INSIDE the serialized claim: another window may
      // have ignored the pending word while this submission waited for the
      // lock — stage a locked skip instead of recording evidence on a word
      // that must never be tested (G04).
      if (props.isWordIgnored?.(currentPick.key)) {
        const skipped = stageDraw(currentPick.key, livePool.level, 'skipped');
        if (skipped === null) {
          setStorageUnavailable(true);
          return;
        }
        setStored(skipped);
        return;
      }
      // Durable cursor FIRST (stageDraw persists without publishing): when
      // it cannot be persisted (quota/private storage), the rating is
      // REFUSED — no baseline sample, no evidence; the learner may retry or
      // skip (G01). Publication order: reactive cursor BEFORE the evidence
      // callback (the callback can synchronously bump parent state and must
      // never observe a stale session), and the baseline version bump keeps
      // latency memos reactive to in-place sample additions.
      const next = stageDraw(currentPick.key, livePool.level, quality);
      if (next === null) {
        // Mid-session durable-write failure: refuse THIS submission (no
        // evidence without a cursor), say so, and leave the prompt retryable.
        setStorageUnavailable(true);
        return;
      }
      setStorageUnavailable(false);
      if (cleanSample && timing !== null) {
        baseline().add(lengthBucketKey(currentPick.key), { latencyMs: timing.activeLatencyMs, usable: true });
        bumpBaselineVersion((version) => version + 1);
      }
      setStored(next);
      props.onRate(currentPick.key, livePool.level, quality, timing);
    });
  };

  const skip = (presented: string | undefined) => {
    if (submissionsLocked()) return;
    const pick = pendingPick();
    if (pick === null || presented !== pick.key) return;
    const pool = stored()?.pools.find((candidate) => String(candidate.level) === pick.categoryId);
    if (pool === undefined) return;
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    stopTiming();
    const skipLanguage = stored()?.language ?? props.language;
    inPlacementLock(skipLanguage, () => {
      const currentPick = pendingPick();
      if (currentPick === null || currentPick.key !== pick.key) return;
      const active = stored();
      const livePool = active?.pools.find((candidate) => String(candidate.level) === currentPick.categoryId);
      if (active === null || livePool === undefined) return;
      if (props.language !== active.language) return;
      if (adoptDurableChanges(active)) return;
      const next = stageDraw(currentPick.key, livePool.level, 'skipped');
      if (next === null) {
        setStorageUnavailable(true);
        return;
      }
      setStorageUnavailable(false);
      setStored(next);
    });
  };

  /** Persists a draw WITHOUT publishing it reactively yet, returning the
   *  next durable entry, or null when the cursor could not be persisted
   *  (quota/private storage) — callers must then refuse the evidence write.
   *  Publication (`setStored(next)`) happens after the cursor is durable AND
   *  the in-memory baseline sample is taken, so summary memos never read a
   *  half-updated sample. The sampler memo replays the published draw list,
   *  so the pick, the live prompt and resume state all advance from one
   *  published source. */
  const stageDraw = (key: string, level: number, outcome: DiagnosticQuality | 'skipped'): StoredPlacement | null => {
    const active = stored();
    if (active === null) return null;
    const next: StoredPlacement = { ...active, draws: [...active.draws, { key, level, outcome }] };
    if (!persistTo(next.language, next)) return null;
    return next;
  };

  // Mid-session exclusion (G04): if the pending word was ignored while the
  // session is live (e.g. ignored in another window), advance past it via a
  // skip — ignored words are never tested, and a skip records no evidence.
  // The advance uses the SAME serialized claim, fresh-state adoption and
  // durable-write refusal as skip(), so it cannot race another tab's cursor.
  const ignoreSkipEffect = () => {
    if (props.booting || storageUnavailable()) return;
    const pick = pendingPick();
    if (pick === null || !props.isWordIgnored) return;
    if (!props.isWordIgnored(pick.key)) return;
    const ignoreLanguage = stored()?.language ?? props.language;
    inPlacementLock(ignoreLanguage, () => {
      const currentPick = pendingPick();
      if (currentPick === null || currentPick.key !== pick.key) return;
      const active = stored();
      const pool = active?.pools.find((candidate) => String(candidate.level) === currentPick.categoryId);
      if (active === null || pool === undefined) return;
      if (props.language !== active.language) return;
      if (adoptDurableChanges(active)) return;
      const next = stageDraw(currentPick.key, pool.level, 'skipped');
      if (next === null) {
        // Same durability contract as skip(): a failed advance must surface,
        // not leave the ignored word pending behind silent rate buttons.
        setStorageUnavailable(true);
        return;
      }
      setStored(next);
    });
  };
  createEffect(ignoreSkipEffect);

  // R09: an exam/school result is a DATED historical record — achieved-date
  // is required for those kinds; a self-assessment may stay undated.
  const dateRequired = createMemo(() => formKind() !== 'self-assessment');
  const canSaveRecord = createMemo(() => formLabel().trim() !== '' && (!dateRequired() || formDate().trim() !== ''));

  const submitBackground = () => {
    const label = formLabel().trim();
    if (label === '') return;
    if (dateRequired() && formDate().trim() === '') return;
    const record: HistoricalBackgroundRecord = {
      id: nextBackgroundId(),
      language: props.language,
      kind: formKind(),
      label,
      recordedAt: Date.now(),
    };
    const level = formLevel().trim();
    if (level !== '') record.level = level;
    const completedAt = formDate().trim();
    if (completedAt !== '') record.completedAt = completedAt;
    const note = formNote().trim();
    if (note !== '') record.note = note;
    // Free-text, comma-separated skill scope (R09: record WHAT the result
    // covered); empty tokens are dropped, wording stays the learner's own.
    const skills = parsedFormSkills();
    if (skills.length > 0) record.skillScope = skills;
    // Supplied scores (R09): captured verbatim as printed — overall and/or
    // per-skill — so a result's score provenance is structured data a later
    // placement pass can read, never a note to be re-interpreted. A skill
    // token removed from the skills field leaves no orphan score.
    const scoreOverall = formScoreOverall().trim();
    const scoreSkills: Record<string, string> = {};
    for (const skill of skills) {
      const value = (formSkillScores()[skill] ?? '').trim();
      if (value !== '') scoreSkills[skill] = value;
    }
    if (scoreOverall !== '' || Object.keys(scoreSkills).length > 0) {
      const score: HistoricalBackgroundScore = {};
      if (scoreOverall !== '') score.overall = scoreOverall;
      if (Object.keys(scoreSkills).length > 0) score.skills = scoreSkills;
      record.score = score;
    }
    props.onAddBackground(record);
    setFormLabel('');
    setFormLevel('');
    setFormDate('');
    setFormNote('');
    setFormSkills('');
    setFormScoreOverall('');
    setFormSkillScores({});
    setFormOpen(false);
  };


  /** Comparable task-response buckets (R11): latencies of words of very
   *  different lengths are not comparable, so samples are bucketed by the
   *  presented word's length class and only that bucket's own median is shown
   *  (task-response latency, never retrieval/automaticity). */
  const LENGTH_BUCKETS: ReadonlyArray<{ min: number; max: number }> = [
    { min: 1, max: 3 },
    { min: 4, max: 7 },
    { min: 8, max: 99 },
  ];
  const lengthBucketKey = (word: string): string => {
    const bucket = LENGTH_BUCKETS.find((candidate) => word.length <= candidate.max) ?? LENGTH_BUCKETS[LENGTH_BUCKETS.length - 1]!;
    return `placement:surface-recognition:${bucket.min}-${bucket.max}`;
  };


  const cleanLatency = createMemo(() => {
    baselineVersion(); // reactive to in-place sample additions
    if (sampledCount() === 0) return undefined;
    let best: { medianMs: number; usableSamples: number; min: number; max: number } | undefined;
    for (const bucket of LENGTH_BUCKETS) {
      const snapshot = baseline().median(`placement:surface-recognition:${bucket.min}-${bucket.max}`);
      if (snapshot === undefined) continue;
      if (best === undefined || snapshot.usableSamples > best.usableSamples) {
        best = { ...snapshot, min: bucket.min, max: bucket.max };
      }
    }
    return best;
  });

  const moveAhead = createMemo(() => {
    const level = placementLevel();
    if (level === null || props.declaredLevel === null) return false;
    // Package-aware: raw level numbers can order difficulty inversely, so
    // "above the declared level" is decided on the package's own scale.
    return !props.isLevelAtOrEasierThan(level, props.declaredLevel);
  });

  return (
    <section class="placement-session" classList={{ 'placement-session--focused': !!props.focused, 'placement-session--live': sessionLive() }} aria-label={t('mlearn.LevelStudy.Placement.Title')}>
      <Show when={!props.focused}>
      <button
        type="button"
        class="placement-session__header"
        onClick={() => setExpanded(!expanded())}
        aria-expanded={expanded()}
      >
        <h3 class="placement-session__title">{t('mlearn.LevelStudy.Placement.Title')}</h3>
        <span class="placement-session__toggle">{expanded() ? '−' : '+'}</span>
      </button>
      </Show>
      <Show when={(props.focused || expanded()) && !props.booting}>
        <details class="placement-session__background">
          <summary>{t('mlearn.LevelStudy.Placement.BackgroundTitle')}</summary>
          <p class="placement-session__description">{t('mlearn.LevelStudy.Placement.Description')}</p>
          <Show when={props.background.length === 0}>
            <p class="placement-session__empty">{t('mlearn.LevelStudy.Placement.BackgroundEmpty')}</p>
          </Show>
          <ul class="placement-session__records">
            <For each={props.background}>
              {(record) => (
                <li class="placement-session__record">
                  <span class="placement-session__record-label">{record.label}</span>
                  <span class="placement-session__record-kind">{t(`mlearn.LevelStudy.Placement.Kind.${record.kind}`)}</span>
                  <Show when={record.level !== undefined}>
                    <span class="placement-session__record-level">{record.level}</span>
                  </Show>
                  <Show when={record.score !== undefined}>
                    <span class="placement-session__record-score">
                      {t('mlearn.LevelStudy.Placement.SuppliedScore', { score: suppliedScoreText(record) })}
                    </span>
                  </Show>
                  <Show when={record.completedAt !== undefined} fallback={
                    <Show when={record.kind !== 'self-assessment'}>
                      <span class="placement-session__record-date placement-session__record-date--unknown">
                        {t('mlearn.LevelStudy.Placement.DateUnknown')}
                      </span>
                    </Show>
                  }>
                    <span class="placement-session__record-date">{record.completedAt}</span>
                  </Show>
                  <button
                    type="button"
                    class="placement-session__record-remove"
                    aria-label={t('mlearn.LevelStudy.Placement.RemoveRecord')}
                    onClick={() => props.onRemoveBackground(record.id)}
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={!formOpen()} fallback={
            <div class="placement-session__form">
              <label class="placement-session__field">
                <span>{t('mlearn.LevelStudy.Placement.KindLabel')}</span>
              <select
                class="placement-session__form-kind"
                value={formKind()}
                aria-label={t('mlearn.LevelStudy.Placement.KindLabel')}
                onChange={(event) => setFormKind(event.currentTarget.value as HistoricalBackgroundKind)}
              >
                <For each={[...KIND_OPTIONS]}>
                  {(kind) => <option value={kind}>{t(`mlearn.LevelStudy.Placement.Kind.${kind}`)}</option>}
                </For>
              </select>
              </label>
              <label class="placement-session__field">
                <span>{t('mlearn.LevelStudy.Placement.ResultLabel')}</span>
              <input
                type="text"
                class="placement-session__form-label"
                placeholder={t('mlearn.LevelStudy.Placement.LabelPlaceholder')}
                aria-label={t('mlearn.LevelStudy.Placement.ResultLabel')}
                value={formLabel()}
                onInput={(event) => setFormLabel(event.currentTarget.value)}
              />
              </label>
              <label class="placement-session__field">
                <span>{t('mlearn.LevelStudy.Placement.LevelLabel')}</span>
              <input
                type="text"
                class="placement-session__form-level"
                placeholder={t('mlearn.LevelStudy.Placement.LevelPlaceholder')}
                aria-label={t('mlearn.LevelStudy.Placement.LevelLabel')}
                value={formLevel()}
                onInput={(event) => setFormLevel(event.currentTarget.value)}
              />
              </label>
              <label class="placement-session__field">
                <span>{t('mlearn.LevelStudy.Placement.DateLabel')}</span>
              <input
                type="date"
                class="placement-session__form-date"
                aria-label={t('mlearn.LevelStudy.Placement.DateLabel')}
                value={formDate()}
                onInput={(event) => setFormDate(event.currentTarget.value)}
              />
              </label>
              <label class="placement-session__field placement-session__field--wide">
                <span>{t('mlearn.LevelStudy.Placement.NoteLabel')}</span>
              <input
                type="text"
                class="placement-session__form-note"
                placeholder={t('mlearn.LevelStudy.Placement.NotePlaceholder')}
                aria-label={t('mlearn.LevelStudy.Placement.NoteLabel')}
                value={formNote()}
                onInput={(event) => setFormNote(event.currentTarget.value)}
              />
              </label>
              <label class="placement-session__field placement-session__field--wide">
                <span>{t('mlearn.LevelStudy.Placement.SkillsLabel')}</span>
              <input
                type="text"
                class="placement-session__form-skills"
                placeholder={t('mlearn.LevelStudy.Placement.SkillsPlaceholder')}
                aria-label={t('mlearn.LevelStudy.Placement.SkillsLabel')}
                value={formSkills()}
                onInput={(event) => setFormSkills(event.currentTarget.value)}
              />
              </label>
              <label class="placement-session__field">
                <span>{t('mlearn.LevelStudy.Placement.ScoreOverallLabel')}</span>
              <input
                type="text"
                class="placement-session__form-score"
                placeholder={t('mlearn.LevelStudy.Placement.ScoreOverallPlaceholder')}
                aria-label={t('mlearn.LevelStudy.Placement.ScoreOverallLabel')}
                value={formScoreOverall()}
                onInput={(event) => setFormScoreOverall(event.currentTarget.value)}
              />
              </label>
              <For each={parsedFormSkills()}>
                {(skill) => (
                  <label class="placement-session__field">
                    <span>{t('mlearn.LevelStudy.Placement.ScoreSkillLabel', { skill })}</span>
                  <input
                    type="text"
                    class="placement-session__form-skill-score"
                    placeholder={t('mlearn.LevelStudy.Placement.ScoreSkillPlaceholder')}
                    aria-label={t('mlearn.LevelStudy.Placement.ScoreSkillLabel', { skill })}
                    value={formSkillScores()[skill] ?? ''}
                    onInput={(event) => setFormSkillScores((scores) => ({ ...scores, [skill]: event.currentTarget.value }))}
                  />
                  </label>
                )}
              </For>
              <Show when={dateRequired() && formDate().trim() === ''}>
                <span class="placement-session__date-required">{t('mlearn.LevelStudy.Placement.DateRequired')}</span>
              </Show>
              <div class="placement-session__form-actions">
                <button type="button" class="placement-session__form-save" disabled={!canSaveRecord()} onClick={submitBackground}>
                  {t('mlearn.LevelStudy.Placement.SaveRecord')}
                </button>
              </div>
            </div>
          }>
            <button type="button" class="placement-session__add" onClick={() => setFormOpen(true)}>
              {t('mlearn.LevelStudy.Placement.AddRecord')}
            </button>
          </Show>
        </details>

        <Show when={placementResult() !== null} fallback={
          <>
            {/* G04: without a session lock primitive there is no atomic
                multi-tab claim, so the probe is DISABLED with an honest
                message instead of running an unserialized session. */}
            <Show when={!locksAvailable()}>
              <p class="placement-session__no-pool">{t('mlearn.LevelStudy.Placement.NoLocks')}</p>
            </Show>
            {/* A live session runs on its OWN stored pool snapshot: it stays
                operable even when the live pools empty (second window rated
                the remaining words) — EmptyPools only speaks to idle Start. */}
            {/* Storage failure (quota/private mode) mid-session: the probe
                hides its rate/skip controls and says so instead of offering
                submissions that silently cannot keep a cursor (G04). */}
            <Show when={storageUnavailable()}>
              <p class="placement-session__no-pool">{t('mlearn.LevelStudy.Placement.NoStorage')}</p>
            </Show>
            <Show when={sessionLive() && locksAvailable()}>
              <div class="placement-session__live">
                <p class="placement-session__progress" role="status">{t('mlearn.LevelStudy.Placement.LiveProgress', { count: stored()?.draws.length ?? 0 })}</p>
                <span class="placement-session__prompt" data-word={presentedWord() ?? ''}>
                  {t('mlearn.LevelStudy.Placement.Prompt', { word: presentedWord() ?? '' })}
                </span>
                <span class="placement-session__probe">
                  <button type="button" class="placement-session__rate" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; rate('missed', presentedWord() ?? undefined); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                    {t('mlearn.Rating.Matrix.Missed')}
                  </button>
                  <button type="button" class="placement-session__rate" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; rate('struggled', presentedWord() ?? undefined); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                    {t('mlearn.Rating.Matrix.Struggled')}
                  </button>
                  <button type="button" class="placement-session__rate" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; rate('fluent', presentedWord() ?? undefined); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                    {t('mlearn.Rating.Matrix.Fluent')}
                  </button>
                  <button type="button" class="placement-session__skip" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; skip(presentedWord() ?? ''); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                    {t('mlearn.LevelStudy.Placement.Skip')}
                  </button>
                </span>
              </div>
            </Show>
            <Show when={!sessionLive() && locksAvailable()}>
              {/* The probe never starts by itself: Start is the only entry,
                  and only while live pools exist. */}
              <Show when={storageUnavailable()}>
                <p class="placement-session__no-pool">{t('mlearn.LevelStudy.Placement.NoStorage')}</p>
              </Show>
              <Show when={props.pools.length > 0} fallback={
                <p class="placement-session__no-pool">{t('mlearn.LevelStudy.Placement.EmptyPools')}</p>
              }>
                {/* Retryable while storage is unavailable: each attempt
                    re-runs the durable write and clears the flag on success. */}
                <button type="button" class="placement-session__start" onClick={startSession}>
                  {t('mlearn.LevelStudy.Placement.Start')}
                </button>
              </Show>
            </Show>
          </>
        }>
          <div class="placement-session__summary" data-testid="placement-summary">
            <Show
              when={placementResult()?.placement != null}
              fallback={
                <p class="placement-session__placement placement-session__placement--lowest">
                  {t('mlearn.LevelStudy.Placement.PlacementLowest')}
                </p>
              }
            >
              <p class="placement-session__placement">
                {t('mlearn.LevelStudy.Placement.Placement', { level: placementResult()?.placement?.label ?? '' })}
              </p>
            </Show>
            <Show when={moveAhead()}>
              <p class="placement-session__move-ahead">{t('mlearn.LevelStudy.Placement.MoveAhead')}</p>
            </Show>
            <ul class="placement-session__trace">
              <For each={placementResult()?.categories ?? []}>
                {(category) => (
                  <li class="placement-session__trace-row" data-category={category.categoryId}>
                    {t('mlearn.LevelStudy.Placement.TraceRow', {
                      label: category.label,
                      sampled: category.sampled,
                      hits: category.hits,
                      misses: category.misses,
                      skipped: category.skipped,
                    })}
                  </li>
                )}
              </For>
            </ul>
            <p class="placement-session__evidence-note">{t('mlearn.LevelStudy.Placement.EvidenceNote', { count: sampledCount() })}</p>
            <Show when={cleanLatency() !== undefined}>
              <p class="placement-session__latency">
                {t('mlearn.LevelStudy.Placement.CleanLatency', { range: cleanLatency()!.max === 99 ? `${cleanLatency()!.min}+` : `${cleanLatency()!.min}-${cleanLatency()!.max}`, ms: Math.round(cleanLatency()!.medianMs) })}
              </p>
            </Show>
            <div class="placement-session__actions">
              <Show when={placementLevel() !== null}>
                <button type="button" class="placement-session__apply" onClick={() => { const level = placementLevel(); if (level !== null) props.onApplyPlacement(level); }}>
                  {t('mlearn.LevelStudy.Placement.UseLevel')}
                </button>
              </Show>
              <button type="button" class="placement-session__dismiss" onClick={dismissSession}>
                {t('mlearn.LevelStudy.Placement.Dismiss')}
              </button>
            </div>
          </div>
        </Show>
      </Show>
    </section>
  );
};

/**
 * Parses stored raw settings data into language-scoped background records.
 * Exported for the tab wiring and tests: malformed rows are dropped rather
 * than hiding the rest.
 */
export function backgroundRecordsForLanguage(raw: unknown, language: string): HistoricalBackgroundRecord[] {
  return parseHistoricalBackgroundRecords(raw)
    .filter((record) => record.language === language);
}

export default PlacementSession;
