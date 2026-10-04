import { useLearningModel } from '../../hooks/useLearningModel';
import { beginReviewSession, reviewSessionRemaining, reviewSessionHasAvailableCards, type ReviewSession } from '../../../shared/reviewSession';
/**
 * Flashcard Review Component
 * SRS review interface with Anki-like rating buttons
 */

import { Component, JSX, Show, createSignal, createMemo, onCleanup, createEffect, batch, on, untrack } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../context';
import type { FlashcardPresentationKnowledge } from './FlashcardWordTitle';
import { FlashcardDisplay } from './FlashcardDisplay';
import type { LearningDecision } from '../../../shared/learningDecision';
import type { PolicyDecision } from '../../learning/types';
import { policyContextFromSettings } from '../../learning/policyContext';
import { useDecisionPin } from '../../hooks/useDecisionPin';
import { FlashcardEditModal } from './FlashcardEditModal';
import { TtsGenerateModal } from './TtsGenerateModal';
import {
  KnowledgeLoadError, Button, Badge, Panel, MicrophoneIcon, EditIcon, ToggleSwitch, StealthIcon, VolumeOffIcon,
  EyeIcon, Popover, WriteStatusBanner, StudyEncounter, StudySessionHUD, useConfirmDialog
} from '../common';
import { useKnowledgeProjection } from '../../hooks/useKnowledgeProjection';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import { isElectron } from '../../../shared/platform';
import { colorizeTokenizedText } from '../../utils/languageTokenization';
import { showToast } from '../common/Feedback/Toast';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';
import { eligibleReviewActivities, renderableReviewActivities, selectReviewActivity, activityScaffolds, type ReviewActivity } from './reviewActivities';
import { ProsodyOverlay } from '../language-specific';
import type { CapabilityKey, Flashcard, FlashcardContent, ReviewPresentation } from '../../../shared/types';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';
import { getProvidedAccessesForCue, getTestedAccesses } from '../../../shared/languageFeatures';
import { qualityToSrsRating, worstAttemptQuality } from '../../../shared/constants';
import { nextAttemptId, providedAccessScaffolds, isAccessMeasurable, type AttemptId, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../shared/encounterTiming';
import { type ProfileObservation, type RateOptions } from '../common';
import type { AttemptQuality } from '../../../shared/constants';
import { OtherLanguageDueHint } from './OtherLanguageDueHint';
import { studySessionState, type StudySessionWriteStatus } from '../../learning/studySession';
import { resolveFlashcardColourCodes } from '../../utils/flashcardBulkExamples';
import { isBlockedByPendingWrite, isNativeActivationTarget, isRatingKeyIgnored, isRevealKey, isUndoShortcut } from '../../utils/ratingShortcuts';
import { canRetryRetraction, isRetractionWriteBlocking, type RetractionWriteState } from '../../learning/undoHistory';
import './FlashcardReview.css';
import { requiresDestructiveConfirmation, buildDestructiveConfirmOptions } from '../../windows/flashcards/bulkDestructiveConfirm';
import { ratingLatencyTraceOn, watchLongTasks } from '../../services/ratingLatencyTrace';
import { getLogger } from '../../../shared/utils/logger';
import { flashcardReviewPolicyEntry, selectFlashcardReviewDecision, restoreFlashcardReviewDecision, reviewHandoffActivity } from './flashcardReviewDecision';
import { createReviewAssistanceStore, type ReviewAssistance } from '../../learning/reviewAssistance';
import { useLearningInput } from '../common/LearningWorkspace/LearningWorkspace';

const log = getLogger("renderer.components.flashcardReview");

type ReviewEncounter = { session?: ReviewSession; carriedScaffolds?: AttemptScaffolds; activity: ReviewActivity; knowledge: FlashcardPresentationKnowledge; tested: readonly CapabilityKey[]; card: Flashcard; decision: PolicyDecision | null; provenance: LearningDecision; cursor?: ReviewPresentation };

interface ReviewRatingWrite {
  encounter: ReviewEncounter;
  /** The durable rating write's state; the encounter is idle when null. */
  phase: StudySessionWriteStatus;
  attemptId: AttemptId;
  card: Flashcard;
  language: string;
  observations: readonly ProfileObservation[];
  quality: AttemptQuality;
  easy: boolean;
  timing: AttemptTiming | null;
  origin: string;
  scaffolds?: AttemptScaffolds;
  assistance?: { scope: string; record: ReviewAssistance };
}

export interface FlashcardReviewProps {
  encounterLimit?: number;
  /** Home uses a bounded admission batch, then continues ordinary requested review. */
  continueAfterBatch?: boolean;
  sessionRequestId?: string;
  initialCardId?: string;
  handoff?: import('../../../shared/learningDecision').LearningDecision;
  onComplete?: () => void;
  onClose?: () => void;
  style?: JSX.CSSProperties;
}

export const FlashcardReview: Component<FlashcardReviewProps> = (props) => {
  const { t } = useLocalization();
  const { showConfirm, ConfirmDialogElement } = useConfirmDialog();
  const {
    store,
    isKnowledgeReady,
    getComprehensiveWordStatusWithSourceSync,
    getAccessStatus,
    queueCounts,
    getCurrentCard,
    isWordIgnoredSync,
    buryCard,
    removeFlashcard,
    undoLastAction,
    canUndo,
    refreshQueue,
    generateExampleSentenceWithLLM,
    updateFlashcardContent,
    updateFlashcard,
    submitRating,
    saveReviewPresentation,
    releaseReviewPosition,
    ratingPersistenceState,
    retryRatingPersistence,
    queue,
  } = useFlashcards();

  // This pinned encounter owns the displayed card, choice and presentation
  // knowledge. Background acknowledgments cannot create a successor; explicit
  // review actions advance it, and peer card/schedule edits invalidate it.
  const decisionPin = useDecisionPin<ReviewEncounter | null>();

  const [showAnswer, setShowAnswer] = createSignal(false);
  const [showActivityPreferences, setShowActivityPreferences] = createSignal(false);
  const [audioAvailability, setAudioAvailability] = createSignal<Record<string, boolean>>({});
  const [audioHeardChoice, setAudioHeardChoice] = createSignal<string | null>(null);
  const [audioFailedChoice, setAudioFailedChoice] = createSignal<string | null>(null);
  const [showCardActions, setShowCardActions] = createSignal(false);
  let cardActionsAnchor: HTMLButtonElement | undefined;
  let activityPreferencesAnchor: HTMLButtonElement | undefined;
  const assistanceStore = createReviewAssistanceStore(localStorage,
    typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null);
  const [referenceAssistance, setReferenceAssistance] = createSignal<ReviewAssistance | null>(null);
  const [restoredAssistanceScope, setRestoredAssistanceScope] = createSignal<string | null>(null);
  const [assistanceWrite, setAssistanceWrite] = createSignal<StudySessionWriteStatus | null>(null);
  let retryReference: (() => void) | undefined;
  let referenceEncounter = 0;
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const [cardsAnswered, setCardsAnswered] = createSignal(0);
  const [showTtsModal, setShowTtsModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [ratingWrite, setRatingWrite] = createSignal<ReviewRatingWrite | null>(null);
  const [removalWrite, setRemovalWrite] = createSignal<{
    encounter: ReviewEncounter; card: Flashcard; language: string; sessionLanguage: string; phase: StudySessionWriteStatus | null;
  } | null>(null);
  // Undo is a durable write (it appends a retraction), reported through the
  // same owner Word Sync uses so the two surfaces cannot disagree about it.
  const [retractionWrite, setRetractionWrite] = createSignal<RetractionWriteState>(null);
  const [editingCard, setEditingCard] = createSignal<Flashcard | null>(null);
  const [regeneratingExample, setRegeneratingExample] = createSignal(false);
  let reviewScrollContainer: HTMLDivElement | undefined;
  let reviewActionsContainer: HTMLDivElement | undefined;
  const [reviewActionsTarget, setReviewActionsTarget] = createSignal<HTMLDivElement>();
  const resetReviewScroll = () => {
    if (reviewScrollContainer) reviewScrollContainer.scrollTop = 0;
    if (reviewActionsContainer) reviewActionsContainer.scrollTop = 0;
  };

  // Active-engagement timing per card: blur/hidden pauses are excluded from
  // the recorded latency; the shared timer is the single implementation all
  // encounter surfaces use (review, Word Sync, welcome review).
  let encounterTimer: EncounterTimer | null = null;

  const stopTiming = (): AttemptTiming | null => {
    const timing = encounterTimer?.stop() ?? null;
    encounterTimer?.dispose();
    encounterTimer = null;
    return timing;
  };

  onCleanup(() => stopTiming());

  // TTS integration
  const { settings, updateSetting } = useSettings();
  const { langData, currentLangData, isLoading: languageLoading } = useLanguage();
  const learning = useLearningModel(() => settings.language);
  let lastLocallyRated: { id: string; snapshot: string } | undefined;
  const { playTts, isGenerating: ttsGenerating, stop: stopTts, metadata: ttsMetadata, playingField: ttsPlayingField } = useFlashcardTts();
  // A confirmed command belongs to this study scope. A late old-scope
  // acknowledgment must not hide or advance the successor encounter.
  createEffect(on(() => settings.language, () => {
    if (removalWrite()) { setRemovalWrite(null); setShowAnswer(false); }
  }, { defer: true }));
  const languageForCard = (card: Flashcard): string => card.language || settings.language;
  const assistanceScope = (card: Flashcard) => JSON.stringify([languageForCard(card), card.id]);
  const languageDataForCard = (card: Flashcard) => {
    const language = languageForCard(card);
    return langData[language] ?? (language === settings.language ? currentLangData() : null);
  };

  const [sessionEpoch, setSessionEpoch] = createSignal(0);
  const [releasedRequest, setReleasedRequest] = createSignal<string>();
  const [releaseWrite, setReleaseWrite] = createSignal<{ command: import('../../../shared/reviewPresentationWrite').ReviewPositionRelease; phase: 'pending' | 'failed'; stale?: boolean }>();
  createEffect(on(() => settings.language, () => { setReleaseWrite(undefined); }, { defer: true }));
  let localSession: { scope: string; admission: string; session: ReviewSession } | undefined;
  const finiteSession = createMemo(() => {
    const scope = JSON.stringify([settings.language, props.sessionRequestId, sessionEpoch()]);
    const saved = store.meta.reviewSessions?.[settings.language];
    const admission = JSON.stringify([settings.language, sessionEpoch()]);
    const held = localSession && (saved?.id === localSession.session.id ? saved : localSession.session);
    // A refreshed model may temporarily remove the inferred limit. It cannot
    // turn an admitted finite chunk into continuous work or resize its membership.
    if (localSession?.admission === admission && held && (localSession.scope === scope || reviewSessionRemaining(held) > 0)) return held;
    const limit = props.continueAfterBatch && sessionEpoch() > 0 ? undefined : props.encounterLimit;
    if (limit === undefined) return undefined;
    if (saved && (reviewSessionHasAvailableCards(saved, store, settings.language) || (sessionEpoch() === 0 && (!props.sessionRequestId || saved.requestId === props.sessionRequestId)))) {
      localSession = { scope, admission, session: saved }; return saved;
    }
    const ids = [...queue().newQueue, ...queue().scheduledQueue];
    const fallback = untrack(getCurrentCard);
    if (fallback && !ids.includes(fallback.id)) ids.push(fallback.id);
    const eligible = ids.filter(id => {
      const card = store.flashcards[id] ?? (fallback?.id === id ? fallback : undefined);
      return card && !card.suspended && !card.buried && languageForCard(card) === settings.language && !isWordIgnoredSync(card.content.front, settings.language);
    });
    if (!eligible.length) return undefined;
    const acceptOffer = releasedRequest() !== props.sessionRequestId;
    const initialCardId = acceptOffer && props.sessionRequestId && props.initialCardId && eligible.includes(props.initialCardId) ? props.initialCardId : undefined;
    const session = { ...(acceptOffer && props.handoff ? { initialHandoff: JSON.parse(JSON.stringify(props.handoff)) } : {}), ...(initialCardId ? { initialCardId } : {}), ...beginReviewSession(crypto.randomUUID(), eligible, limit, Date.now()),
      ...(props.sessionRequestId ? { requestId: props.sessionRequestId } : {}) };
    localSession = { scope, admission, session }; return session;
  });
  const sessionAllows = (id: string) => !finiteSession() || (reviewSessionRemaining(finiteSession()!) > 0
    && finiteSession()!.cardIds.includes(id) && !finiteSession()!.completedCardIds.includes(id));
  const preferences = () => settings.reviewActivities ?? DEFAULT_SETTINGS.reviewActivities;
  const activityChoices = (card: Flashcard, restoring = false) => renderableReviewActivities(eligibleReviewActivities(card, languageDataForCard(card),
    restoring ? { holistic: true, focused: true, audio: true } : preferences(),
    restoring || (!settings.flashcardMuteAudio && audioAvailability()[card.id] === true), {
      focused: t('mlearn.Flashcards.Review.Focused'), focusedTarget: t('mlearn.Knowledge.Capability.prosodic-pattern'), focusedPrompt: target => t('mlearn.Flashcards.Review.FocusedPrompt', { target }),
      audio: t('mlearn.Flashcards.Review.Audio'), audioPrompt: t('mlearn.Flashcards.Review.AudioPrompt'),
    }, !restoring), card, languageDataForCard(card));
  // Bounded concurrent metadata-only recording lookups; no synthesis or text fallback.
  const checkedAudio = new Set<string>();
  const [audioResourceEpoch, setAudioResourceEpoch] = createSignal(0);
  createEffect(() => {
    const epoch = audioResourceEpoch();
    if (!preferences().audio || settings.flashcardMuteAudio) return;
    const candidates = [...queue().newQueue, ...queue().scheduledQueue];
    const fallback = candidates.length ? null : untrack(getCurrentCard);
    if (fallback && !candidates.includes(fallback.id)) candidates.push(fallback.id);
    const ids = candidates.filter(id => !checkedAudio.has(id));
    ids.forEach(id => checkedAudio.add(id));
    let next = 0;
    const results: Record<string, boolean> = {};
    const worker = async () => {
      while (!disposed && next < ids.length) {
        const id = ids[next++];
        let available = false;
        try { available = !!await getBridge().flashcards.getFlashcardTts(id, 'word'); }
        catch (error) { log.warn('Review recording lookup failed:', error); }
        results[id] = available;
      }
    };
    if (ids.length) void Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker)).then(() => {
      if (!disposed && untrack(audioResourceEpoch) === epoch) setAudioAvailability(previous => ({ ...previous, ...results }));
    });
  });

  const refreshAudioResources = () => {
    checkedAudio.clear();
    setAudioResourceEpoch(epoch => epoch + 1);
  };

  const snapshotEncounter = (encounter: Omit<ReviewEncounter, 'knowledge' | 'tested'>): ReviewEncounter => untrack(() => {
    const card = encounter.card;
    const language = languageForCard(card);
    const data = languageDataForCard(card);
    const tested = encounter.provenance.selected.task.requested;
    const accesses = Object.fromEntries([...new Set([...tested, ...Object.keys(data?.learning?.capabilities ?? {}), 'prosodic-pattern'])]
      .map(capability => [capability, { ...getAccessStatus(card.content.front, capability, language) }]));
    let exposed = encounter.cursor?.cardId === card.id && encounter.cursor.scaffolds?.['prior-cue-exposure'] === true;
    if (encounter.cursor?.cardId === card.id) {
      const previous = encounter.cursor.decision;
      if (previous && previous.id !== encounter.provenance.id
        && JSON.stringify(previous.selected.task) !== JSON.stringify(encounter.provenance.selected.task)) {
        try {
          const prior = assistanceStore.read(assistanceScope(card), previous.id);
          exposed = exposed || prior?.revealed === true || (prior?.scaffolds.audio === true && encounter.activity.kind !== 'audio-recognition');
        }
        catch { exposed = true; } // An unreadable exposure marker cannot justify cold recall.
      } else if (!previous && encounter.activity.kind !== 'holistic' && encounter.cursor.scaffolds && Object.keys(encounter.cursor.scaffolds).length) {
        exposed = true; // Undo returns consulted material, including across an activity change.
      }
    }
    return { ...encounter, session: finiteSession(), ...(exposed ? { carriedScaffolds: { ...providedAccessScaffolds(tested), 'prior-cue-exposure': true } } : {}),
      tested, knowledge: { ready: isKnowledgeReady(),
      wordKnown: getComprehensiveWordStatusWithSourceSync(card.content.front, language).status === 'known', accesses } };
  });

  // Preserve whether the learner requested the cue. Automatic audio has the
  // same assistance provenance, without a learner-requested reference banner.
  const handlePlayTts = (cardId: string, text: string, field: 'word' | 'example', silentIfMissing = false, requested = true) => {
    const card = currentCard();
    if (!card || card.id !== cardId || ratingWrite() !== null || removalWrite() !== null
      || isRetractionWriteBlocking(retractionWrite()) || assistanceWrite() !== null) return;
    const scope = assistanceScope(card);
    const encounter = referenceEncounter;
    const choiceId = currentEncounter()!.provenance.id;
    const language = languageForCard(card);
    const sameEncounter = () => !disposed && referenceEncounter === encounter
      && currentEncounter()?.provenance.id === choiceId && !!currentCard() && assistanceScope(currentCard()!) === scope && ratingWrite() === null
      && removalWrite() === null && !isRetractionWriteBlocking(retractionWrite());
    // Resource lookup may finish after reveal. Only audio admitted while the
    // question is still shown supplies a retrieval cue. Once admitted, its
    // durable record survives cancellation or a restart conservatively.
    let cueAdmitted = false;
    const play = () => {
      if (!sameEncounter()) return;
      void playTts(cardId, text, language, field, {
        silentIfMissing,
        beforePlay: async () => {
          if (!sameEncounter()) return false;
          if (showAnswer() && !cueAdmitted) return true;
          cueAdmitted = true;
          setAssistanceWrite('pending');
          try {
            const capabilities = getTestedAccesses({ languageData: languageDataForCard(card), surface: card.content.front,
              hasReadingData: cardHasReadingData(card), hasProsodyData: cardHasProsodyData(card), taskType: 'srs-review' });
            const supplied = getProvidedAccessesForCue(languageDataForCard(card), capabilities, `${field}-audio`);
            const record = await assistanceStore.provide(scope, { audio: true, ...providedAccessScaffolds(supplied) }, sameEncounter, choiceId, requested);
            if (!record || !sameEncounter()) return false;
            setReferenceAssistance(record);
            setAssistanceWrite(null);
            retryReference = undefined;
            return true;
          } catch (error) {
            if (sameEncounter()) {
              log.warn('Failed to save review audio assistance:', error);
              setAssistanceWrite('failed');
              retryReference = play;
            }
            return false;
          }
        },
      });
    };
    play();
  };

  /**
   * Opt-in per-computation timing.
   *
   * A Solid memo re-runs on every unrelated update, so "the whole-queue
   * rebuild" is only ever visible as whichever computation happened to trigger
   * it. Timing each reactive unit at its own boundary names the owner rather
   * than the symptom, and reports nothing at all when the tracer is off.
   */
  const timed = <T,>(name: string, compute: () => T): T => {
    if (!ratingLatencyTraceOn()) return compute();
    const started = performance.now();
    const result = compute();
    const elapsed = performance.now() - started;
    if (elapsed >= 1) {
      // eslint-disable-next-line no-console
      console.log(`%c[SOLID] ${name}=${elapsed.toFixed(1)}ms`, 'color:#6a9; font-weight:bold');
    }
    return result;
  };

  // Current card
  const currentEncounter = createMemo(() => timed('currentEncounter', () => {
    const removal = removalWrite();
    if (removal) return removal.encounter;
    const held = ratingWrite();
    if (held) return held.encounter;
    if (finiteSession() && reviewSessionRemaining(finiteSession()!) === 0) return null;
    const fallback = getCurrentCard();
    if (fallback && languageLoading() && !languageDataForCard(fallback)) return null;
    if (!fallback || isWordIgnoredSync(fallback.content.front, languageForCard(fallback))) return null;
    const language = languageForCard(fallback);
    const pinned = decisionPin.peek(language);
    if (pinned) {
      const actual = store.flashcards[pinned.card.id] ?? (fallback.id === pinned.card.id ? fallback : undefined);
      const admitted = actual && sessionAllows(actual.id) && !actual.suspended && !actual.buried && !isWordIgnoredSync(actual.content.front, language)
        && (actual.id === fallback.id || queue().newQueue.includes(actual.id) || queue().scheduledQueue.includes(actual.id));
      // Preferences choose future work. Package/task changes and peer ratings
      // still invalidate the displayed question through the actual card snapshot.
      const declaration = actual && eligibleReviewActivities(actual, languageDataForCard(actual),
        { holistic: true, focused: true, audio: true }, true, {
          focused: t('mlearn.Flashcards.Review.Focused'), focusedTarget: t('mlearn.Knowledge.Capability.prosodic-pattern'),
          focusedPrompt: target => t('mlearn.Flashcards.Review.FocusedPrompt', { target }),
          audio: t('mlearn.Flashcards.Review.Audio'), audioPrompt: t('mlearn.Flashcards.Review.AudioPrompt'),
        }, false).find(activity => activity.id === pinned.activity.id);
      if (admitted && declaration && JSON.stringify({ ...actual, retentionCache: undefined }) === JSON.stringify({ ...pinned.card, retentionCache: undefined })
        && JSON.stringify(flashcardReviewPolicyEntry(actual, language, languageDataForCard(actual), declaration).task) === JSON.stringify(pinned.provenance.selected.task)) return pinned;
    }
    // The policy arbitrates within the scheduler's OWN visible workload for
    // today (the queue — respecting daily caps and same-day scheduling), not
    // just its first card (R07/R08): goal/deadline weighting and intensity
    // momentum can only change allocation when there is more than one
    // candidate. Queued-new cards carry their state so the source scores them
    // as exploration (novelty), never as fabricated overdue repair.
    if (!learning.ready()) return null;
    const nowMs = Date.now();
    const restored = store.meta?.reviewPresentations?.[language];
    const cursor = restored ? JSON.parse(JSON.stringify(restored)) as ReviewPresentation : undefined;
    // A resumable task is already admitted. Resource discovery and preferences
    // must not replace its cue while an asynchronous recording lookup is pending.
    // The original package contract and card content still have to match; audio
    // playback itself retains its completion/error gate, including missing files.
    if (restored?.decision) {
      const card = store.flashcards[restored.cardId] ?? (fallback.id === restored.cardId ? fallback : undefined);
      const admitted = card && sessionAllows(card.id) && !card.suspended && !card.buried
        && languageForCard(card) === language && !isWordIgnoredSync(card.content.front, language)
        && (card.id === fallback.id || queue().newQueue.includes(card.id) || queue().scheduledQueue.includes(card.id));
      const activity = admitted && activityChoices(card, true).find(activity => activity.id === restored.decision!.selected.task.taskTemplateId
        || (activity.kind === 'holistic' && restored.decision!.selected.task.taskTemplateId === flashcardReviewPolicyEntry(card, language, languageDataForCard(card)).task?.taskTemplateId));
      const resumed = activity && restoreFlashcardReviewDecision(restored, card!, flashcardReviewPolicyEntry(card!, language, languageDataForCard(card!), activity));
      if (resumed && activity) return decisionPin.pin(language, () => snapshotEncounter({
        card: JSON.parse(JSON.stringify(card)) as Flashcard, decision: null, cursor, activity, ...resumed,
      }), encounter => !!encounter && encounter.provenance.id === resumed.provenance.id
        && JSON.stringify({ ...encounter.card, retentionCache: undefined }) === JSON.stringify({ ...card, retentionCache: undefined }));
    }
    // Identity of the eligible workload. Building the scheduler's entries for
    // every queued card is O(queue) work with two hash derivations per card, so
    // it is resolved LAZILY: an encounter that resumes a durable cursor, or one
    // whose pin is still valid, needs only the entries for the cards it
    // actually consults. Selecting a fresh card still sees the whole pool -
    // the policy has to arbitrate the real workload - but it does it once per
    // selection instead of on every reactive re-run.
    const eligibleCards = timed('eligiblePool', () => [...queue().newQueue, ...queue().scheduledQueue]
      .map((id) => store.flashcards[id])
      .filter((card): card is Flashcard => !!card && sessionAllows(card.id) && !card.suspended && !card.buried
        && (card.language || settings.language) === language
        && !isWordIgnoredSync(card.content.front, language) && activityChoices(card).length > 0));
    // The scheduler fallback is always eligible, even when the queue has not
    // caught up with it yet - it is the card the surface would present.
    if (sessionAllows(fallback.id) && !eligibleCards.some(card => card.id === fallback.id) && activityChoices(fallback).length) eligibleCards.push(fallback);
    // A local rating may precede the scheduler's reactive acknowledgment.
    // Prefer other admitted work until that exact schedule snapshot changes.
    const sameRated = (card: Flashcard) => card.id === lastLocallyRated?.id && JSON.stringify(card) === lastLocallyRated.snapshot;
    const freshCards = eligibleCards.filter(card => !sameRated(card));
    const first = finiteSession()?.completedCardIds.length === 0 ? finiteSession()?.initialCardId : undefined;
    const initial = eligibleCards.find(card => card.id === first);
    const handoff = finiteSession()?.completedCardIds.length === 0 ? finiteSession()?.initialHandoff : undefined;
    if (handoff && !initial) return null;
    const offeredActivity = handoff && initial ? reviewHandoffActivity(handoff, finiteSession()?.requestId, initial, language, languageDataForCard(initial), activityChoices(initial)) : null;
    // A resource or task change cannot silently substitute another retrieval for the offered one.
    if (handoff && !offeredActivity) return null;
    const planningCards = initial ? [initial] : (freshCards.length ? freshCards : eligibleCards).sort((a, b) => Number(b.id === fallback.id) - Number(a.id === fallback.id)).slice(0, 32);
    const availableIds = new Set(eligibleCards.map(card => card.id));
    const entryCache = new Map<string, ReturnType<typeof flashcardReviewPolicyEntry>>();
    const selectedActivities = new Map<string, ReviewActivity>();
    // The admitted pool has one language/package and one evidence snapshot.
    // Resolve opportunities and scope once rather than again for every card.
    const reviewPolicyContext = policyContextFromSettings(settings, language, { model: learning.model()!, events: learning.snapshot()!.events, data: languageDataForCard(fallback) });
    const entryFor = (card: Flashcard, selectedActivity?: ReviewActivity) => {
      const cached = entryCache.get(card.id);
      if (cached) return cached;
      const choices = activityChoices(card);
      const runtime = reviewPolicyContext.learning!;
      const activity = selectedActivity ?? selectReviewActivity(choices, learning.model()!,
        flashcardReviewPolicyEntry(card, languageForCard(card), languageDataForCard(card)).targets![0].entityId,
        { nowMs, horizonDays: runtime.horizonDays, deferDays: runtime.deferDays, targetWeights: runtime.targetWeights });
      selectedActivities.set(card.id, activity);
      const entry = flashcardReviewPolicyEntry(card, languageForCard(card), languageDataForCard(card), activity);
      entryCache.set(card.id, entry);
      return entry;
    };
    const reviewQueueEntries = (): ReturnType<typeof flashcardReviewPolicyEntry>[] =>
      timed(`reviewQueueEntries(n=${eligibleCards.length})`, () => planningCards.map(card => entryFor(card, card.id === initial?.id ? offeredActivity ?? undefined : undefined)));
    // Pinned for the active encounter (R20 repair): this memo re-runs on
    // every unrelated queue/store/settings update, and the unseeded weighted
    // draw would silently replace the displayed card. The pin re-serves the
    // same decision until an explicit review action advances the epoch.
    return decisionPin.pin(language, () => {
      if (restored && availableIds.has(restored.cardId)) {
        const card = store.flashcards[restored.cardId];
        const activity = activityChoices(card).find(a => a.id === restored.decision?.selected.task.taskTemplateId
          || (a.kind === 'holistic' && restored.decision?.selected.task.taskTemplateId === flashcardReviewPolicyEntry(card, languageForCard(card), languageDataForCard(card)).task?.taskTemplateId));
        const entry = entryFor(card, activity);
        const resumed = restoreFlashcardReviewDecision(restored, card, entry);
        if (resumed) return snapshotEncounter({ card: JSON.parse(JSON.stringify(card)) as Flashcard,
          decision: null, cursor, activity: selectedActivities.get(card.id)!, ...resumed });
      }
      if (restored && !restored.decision && availableIds.has(restored.cardId)) {
        // Undo names the actual restored card. No fresh graph decision or
        // random draw may silently replace that acknowledged return position.
        const card = store.flashcards[restored.cardId];
        const entry = entryFor(card);
        return snapshotEncounter({ card: JSON.parse(JSON.stringify(card)) as Flashcard, decision: null, cursor, activity: selectedActivities.get(card.id)!,
          provenance: { id: crypto.randomUUID(), at: nowMs, policyVersion: 'restored-review-position-v1',
            selected: { key: card.id, action: 'RESTORE', task: entry.task!,
              presentation: { cardId: card.id, language, surface: card.content.front, contentVersion: entry.presentation?.contentVersion },
              targets: entry.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability })) },
            baseline: null, detail: { scope: 'acknowledged-undo-position',
              reason: 'Return to the saved Undo position without making a fresh recommendation.' } } });
      }
      const selected = selectFlashcardReviewDecision({
        id: crypto.randomUUID(), at: nowMs,
        // The goal applies only to the queue's own learning language (R07).
        context: reviewPolicyContext,
        entries: reviewQueueEntries(),
      });
      if (!selected) return null;
      if (handoff && selected.provenance.selected.key === initial?.id) selected.provenance.detail.handoffRef = { id: handoff.id };
      const card = store.flashcards[selected.decision.candidate.key] ?? fallback;
      return snapshotEncounter({ card: JSON.parse(JSON.stringify(card)) as Flashcard, cursor, activity: selectedActivities.get(card.id)!, ...selected });
    }, (encounter) => {
      if (!encounter || !availableIds.has(encounter.card.id)) return false;
      const actual = store.flashcards[encounter.card.id] ?? fallback;
      const stillEligible = activityChoices(actual).find(activity => activity.id === encounter.activity.id);
      const task = stillEligible ? flashcardReviewPolicyEntry(actual, languageForCard(actual), languageDataForCard(actual), stillEligible).task : undefined;
      // A peer's rating retires this physical question even if its learning
      // card remains queued. Derived retention caches do not retire it.
      return JSON.stringify({ ...actual, retentionCache: undefined }) === JSON.stringify({ ...encounter.card, retentionCache: undefined })
        && languageForCard(actual) === languageForCard(encounter.card)
        && JSON.stringify(task) === JSON.stringify(encounter.provenance.selected.task);
    });
  }));

  // Cursor diagnostics belong to the encounter, but do not decide visibility.
  const [choiceWrite, setChoiceWrite] = createSignal<{ id: string; phase: StudySessionWriteStatus | null } | null>(null);
  const [stagePosition, setStagePosition] = createSignal<{ id: string; index: number } | null>(null);
  const stageIndex = () => stagePosition()?.id === currentEncounter()?.provenance.id
    ? stagePosition()!.index : currentEncounter()?.cursor?.id === currentEncounter()?.provenance.id ? currentEncounter()?.cursor?.stageIndex ?? 0 : 0;
  const currentStage = () => currentEncounter()?.activity.stages?.[stageIndex()];
  const hasNextStage = () => !!currentEncounter()?.activity.stages && stageIndex() < currentEncounter()!.activity.stages!.length - 1;
  const displayedKind = () => currentStage()?.kind ?? currentEncounter()?.activity.kind;
  const saveChoice = async (encounter: ReviewEncounter, expectedId: string | null = encounter.cursor?.id ?? null): Promise<void> => {
    const id = encounter.provenance.id;
    const report = (phase: StudySessionWriteStatus): void => {
      if (!disposed && currentEncounter()?.provenance.id === id) setChoiceWrite({ id, phase });
    };
    report('pending');
    try {
      await saveReviewPresentation(languageForCard(encounter.card), { id, cardId: encounter.card.id,
        ...(encounter.cursor?.correction ? { correction: encounter.cursor.correction } : {}),
        ...((encounter.cursor?.cardId === encounter.card.id && encounter.cursor.scaffolds) || encounter.carriedScaffolds
          ? { scaffolds: { ...encounter.cursor?.scaffolds, ...encounter.carriedScaffolds } } : {}),
        ...(encounter.session ? { session: encounter.session } : {}),
        ...(encounter.activity.stages ? { stageIndex: stageIndex(), stageScaffolds: store.meta.reviewPresentations?.[languageForCard(encounter.card)]?.id === id
          ? store.meta.reviewPresentations[languageForCard(encounter.card)].stageScaffolds : encounter.cursor?.id === id ? encounter.cursor.stageScaffolds : undefined } : {}),
        decision: encounter.provenance }, expectedId);
      report(null);
    } catch (error) {
      log.warn('Failed to save the background review position:', error);
      report('failed');
    }
  };
  const retryChoice = (): void => {
    const encounter = currentEncounter();
    if (!encounter) return;
    const authoritative = store.meta.reviewPresentations?.[languageForCard(encounter.card)];
    if (authoritative && authoritative.id !== encounter.provenance.id && authoritative.id !== encounter.cursor?.id) {
      // A peer owns the resumable position. Explicit recovery adopts that
      // choice instead of repeatedly trying to overwrite it with stale intent.
      batch(() => { setShowAnswer(false); decisionPin.advance(); });
    } else void saveChoice(encounter, authoritative?.id ?? null);
  };
  const startNewReview = async (): Promise<void> => {
    if (releaseWrite()?.phase === 'pending' || ratingWrite() || removalWrite() || isRetractionWriteBlocking(retractionWrite())) return;
    const command = (releaseWrite()?.stale ? undefined : releaseWrite()?.command) ?? JSON.parse(JSON.stringify({ kind: 'release', language: settings.language,
      expectedPresentation: store.meta.reviewPresentations?.[settings.language] ?? null,
      expectedSession: store.meta.reviewSessions?.[settings.language] ?? null })) as import('../../../shared/reviewPresentationWrite').ReviewPositionRelease;
    const request = props.sessionRequestId;
    setReleaseWrite({ command, phase: 'pending' });
    try {
      await releaseReviewPosition(command);
      if (disposed || settings.language !== command.language) return;
      batch(() => {
        if (props.sessionRequestId === request) setReleasedRequest(request);
        localSession = undefined;
        setSessionEpoch(value => value + 1);
        decisionPin.advance();
        setShowAnswer(false);
        setReleaseWrite(undefined);
      });
    } catch (error) {
      log.warn('Failed to leave unavailable Review work:', error);
      if (!disposed && settings.language === command.language) setReleaseWrite({ command, phase: 'failed',
        stale: String(error).includes('replaced by another window') });
    }
  };
  createEffect(on([() => currentEncounter()?.provenance.id, retractionWrite], () => {
    if (isRetractionWriteBlocking(retractionWrite())) return;
    const encounter = currentEncounter();
    if (encounter) void saveChoice(encounter);
    else setChoiceWrite(null);
  }));

  const currentPolicyInspection = () => {
    const encounter = currentEncounter();
    if (encounter?.decision?.trace) return { policyTrace: encounter.decision.trace, policyBrief: encounter.decision.encounter.why };
    // Own producer version only: unknown package detail remains preserved, not interpreted.
    const trace = encounter?.provenance.detail.trace as PolicyDecision['trace'];
    if (trace && trace.version === encounter?.provenance.policyVersion && trace.selectedKey === encounter.provenance.selected.key
      && Array.isArray(trace.ranking) && typeof encounter.provenance.detail.brief === 'string') {
      return { policyTrace: trace, policyBrief: encounter.provenance.detail.brief };
    }
    return undefined;
  };
  // The selected question is immutable for this encounter. Live store
  // reconciliation can update scheduling, never the card already on screen.
  const currentCard = createMemo(() => currentEncounter()?.card ?? null);

  const currentCardId = createMemo(() => currentCard()?.id);

  // Timing belongs to the encounter, including a genuine same-card requeue.
  // Held writes keep their stopped timer until the acknowledged next owner.
  createEffect(on(
    currentEncounter,
    (encounter) => {
      if (ratingWrite()) return;
      stopTts();
      stopTiming();
      if (encounter) {
        encounterTimer = createEncounterTimer();
        encounterTimer.start();
      }
    }
  ));

  const restoredAssistance = () => {
    const encounter = currentEncounter();
    if (encounter?.cursor?.correction) return encounter.cursor.correction.scaffolds;
    return encounter && (encounter.cursor?.scaffolds || encounter.carriedScaffolds) && encounter.cursor?.cardId === encounter.card.id
      ? { ...encounter.cursor?.scaffolds, ...encounter.carriedScaffolds } : undefined;
  };
  const encounterAssistance = createMemo(() => ({ ...restoredAssistance(), ...referenceAssistance()?.scaffolds, ...ratingWrite()?.scaffolds }));

  const cardHasReadingData = (card: Flashcard): boolean => {
    const r = card.content.reading;
    return !!r && r !== card.content.front;
  };

  const cardHasProsodyData = (card: Flashcard): boolean => {
    const p = card.content.prosody;
    return !!p && (p.position !== undefined || !!p.display);
  };

  const knowledge = useKnowledgeProjection(() => {
    const card = currentCard();
    return card ? { language: languageForCard(card), surface: card.content.front } : undefined;
  }, currentEncounter);

  // Package-declared task capabilities are part of the displayed encounter.
  // Projection resolution controls evidence admission, not the row layout.
  const testedAccesses = createMemo(on(currentEncounter, encounter => untrack(() => {
    const tested = encounter?.tested ?? [];
    const projection = knowledge.projection();
    // A cached projection for this surface can refine the initial profile.
    // Pending/new queries use the package's authored task profile for the
    // entire encounter; submission still admits only graph-supported accesses.
    if (!knowledge.loading() && projection?.status === 'ready'
      && (projection.querySurface === undefined || projection.querySurface === encounter?.card.content.front)) {
      return projection.surfaceKnown === false ? tested : tested.filter(capability => knowledge.capabilities().includes(capability));
    }
    return tested;
  })));
  const admittedAccesses = () => knowledge.projection()?.surfaceKnown === false ? testedAccesses()
    : testedAccesses().filter(capability => knowledge.capabilities().includes(capability));
  const capabilityQueryFailed = () => {
    const status = knowledge.projection()?.status;
    return status === 'error' || status === 'not-installed' || status === 'unavailable'
      || (!knowledge.loading() && status === 'ready' && admittedAccesses().length === 0);
  };

  // Event handlers read this prop too. Own the computation in the component,
  // rather than creating a JSX expression memo when a handler reads its getter.

  // Explicit whole-word / matrix submissions rate every tested capability —
  // revealed cues change the evidence condition, not the rating surface.
  // Scaffold provenance still travels on each observation (see below).
  const commitRating = async (write: ReviewRatingWrite) => {
    const inputAt = performance.now();
    setRatingWrite({ ...write, phase: 'pending' });
    // Opt-in latency tracer; see ratingLatencyTrace.
    const traceOn = ratingLatencyTraceOn();
    try {
      const result = await submitRating(write.card.content.front, write.observations, {
        language: write.language,
        attemptId: write.attemptId,
        decision: write.encounter.provenance,
        ...(write.encounter.session ? { reviewSessionId: write.encounter.session.id } : {}),
        ...(write.timing ? { timing: write.timing } : {}),
        taskType: write.encounter.activity.kind === 'holistic' ? 'srs-review' : write.encounter.activity.id,
        origin: write.origin,
        // Cues travel on the atomic rating command on either route. Their
        // local recovery marker is retired only when its durability receipt lands.
        persistence: 'background',
        ...(write.scaffolds ? { scaffolds: write.scaffolds } : {}),
        scheduler: {
          cardId: write.card.id,
          rating: qualityToSrsRating(write.quality, write.easy),
          timeSpentMs: write.timing?.wallLatencyMs ?? 0,
          tested: write.observations.map((observation) => observation.capability),
        },
      });
      // Opt-in latency tracer; see ratingLatencyTrace.
      //
      // Every boundary is recorded as an ABSOLUTE timestamp and the deltas are
      // derived afterwards. A delta captured at a mark only proves the work up
      // to that mark, so when an `await` resumes late - or a step is skipped -
      // a running delta silently reports someone else's time under this step's
      // name. Keeping the raw stamps means a label can never claim a duration
      // it did not actually measure, which is what made an earlier
      // "acknowledge=1475ms" reading impossible to trust.
      const stamps: Array<[string, number]> = [];
      const stamp = (label: string): void => {
        if (traceOn) stamps.push([label, performance.now()]);
      };
      const report = (): void => {
        if (!traceOn) return;
        const at = new Map(stamps);
        const between = (from: string, to: string): string => {
          const start = at.get(from); const end = at.get(to);
          return start !== undefined && end !== undefined ? `${from}->${to}=${(end - start).toFixed(1)}` : '';
        };
        const first = at.get('keypress');
        const last = at.get('afterBatch');
        const windows = [
          between('keypress', 'afterSubmitRating'),
          between('beforeBatch', 'afterBatch'),
          between('afterBatch', 'microtask'),
          between('microtask', 'animationFrame'),
        ].filter(Boolean);
        // eslint-disable-next-line no-console
        console.log(`%c[APPLY] persistence=background  ${windows.join('  ')}  total=${first !== undefined && last !== undefined ? (last - first).toFixed(1) : '?'}`,
          'color:#e80; font-weight:bold');
        // eslint-disable-next-line no-console
        console.log(`%c[APPLY-RAW] ${stamps.map(([label, ms]) => `${label}@${ms.toFixed(1)}`).join(' ')}`,
          'color:#999');
      };
      const stopLongTasks = traceOn ? watchLongTasks() : () => {};
      if (traceOn) stamps.push(['keypress', inputAt]);
      // Cleanup never serializes the next question behind browser storage locks.
      // Failed persistence retains the marker, including through explicit retry.
      if (write.assistance) {
        const assistance = write.assistance;
        void (result.persisted ?? Promise.resolve(true)).then(saved => {
          if (saved) return assistanceStore.acknowledge(assistance.scope, assistance.record);
          return undefined;
        }).catch(error => log.warn('Failed to retire durable review assistance:', error));
      }
      stamp('afterSubmitRating');
      stamp('beforeBatch');
      batch(() => {
        setShowAnswer(false);
        stamp('afterSetShowAnswer');
        // Publish the next encounter here; readiness must not trigger
        // auto-play for an intermediate selection before the pin advances.
        lastLocallyRated = { id: write.card.id, snapshot: JSON.stringify(write.card) };
        decisionPin.advance();
        stamp('afterPinAdvance');
        setRatingWrite(null);
        stamp('afterClearRatingWrite');
        // A different scope's effect owns its admission refresh. Same-card
        // requeues need an explicit new encounter even though the scope is stable.
        stamp('beforeCurrentCard');
        const next = currentCard();
        stamp('afterCurrentCard');
        if (next && assistanceScope(next) === assistanceScope(write.card)) {
          referenceEncounter += 1;
          refreshReferenceAssistance();
        }
        stamp('afterReferenceRefresh');
        if (result.completed) setCardsAnswered((previous) => previous + 1);
      });
      stamp('afterBatch');
      report();
      // A Solid write flushes its own memos and effects synchronously, but
      // whatever it scheduled runs after this function returns. Both are
      // stamped so the work is attributed to the turn that actually did it.
      if (traceOn) {
        queueMicrotask(() => { stamp('microtask'); report(); });
        requestAnimationFrame(() => { stamp('animationFrame'); report(); stopLongTasks(); });
      }
      resetReviewScroll();
    } catch (error) {
      log.warn('Failed to save flashcard review rating:', error);
      setRatingWrite({ ...write, phase: 'failed' });
    }
  };

  const handleBulkRate = (observations: readonly ProfileObservation[], opts?: RateOptions) => {
    const encounter = currentEncounter();
    const card = currentCard();
    if (!encounter || !card || !ratingArmed() || observations.length === 0) return;
    let assistance: ReviewAssistance | null;
    try { assistance = assistanceStore.read(assistanceScope(card), encounter.provenance.id); }
    catch (error) {
      log.warn('Failed to read review assistance:', error);
      setAssistanceWrite('failed');
      retryReference = () => refreshReferenceAssistance();
      return;
    }
    const scaffolds = encounter.cursor?.correction ? { ...encounter.cursor.correction.scaffolds }
      : { ...activityScaffolds(encounter.activity), ...restoredAssistance(), ...referenceAssistance()?.scaffolds, ...assistance?.scaffolds };
    const timing = encounter.cursor?.correction?.timing ?? stopTiming();
    // A mixed profile schedules on its weakest evidence — the same reduction
    // word sync applies, read from the one ordering (missed dominates
    // struggled dominates fluent).
    const projection = knowledge.projection();
    const requestedObservations = observations.filter(observation => encounter.tested.includes(observation.capability));
    const admittedObservations = projection?.surfaceKnown === false ? requestedObservations
      : requestedObservations.filter(observation => knowledge.capabilities().includes(observation.capability));
    if (admittedObservations.length === 0) return;
    const quality = worstAttemptQuality(admittedObservations.map((observation) => observation.quality));

    stopTts();
    const admittedCard = JSON.parse(JSON.stringify(card)) as Flashcard;
    admittedCard.language ??= languageForCard(card);
    void commitRating({
      phase: 'pending',
      attemptId: nextAttemptId(),
      card: admittedCard,
      encounter,
      language: languageForCard(card),
      observations: admittedObservations,
      quality,
      easy: opts?.easy === true,
      timing,
      origin: knowledge.projection()?.surfaceKnown === false ? 'flashcard-review:unmapped' : 'flashcard-review',
      ...(Object.keys(scaffolds).length ? { scaffolds } : {}),
      ...(assistance ? { assistance: { scope: assistanceScope(card), record: assistance } } : {}),
    });
  };

  // Counts
  const counts = createMemo(() => queueCounts());
  // An unresolved final encounter is still work until its ACK, even if the
  // provider has already published an empty queue.
  const remainingWork = createMemo(() => {
    const session = finiteSession();
    if (!session) return Math.max(counts().total, ratingWrite() || removalWrite() ? 1 : 0);
    const ids = new Set([...queue().newQueue, ...queue().scheduledQueue]);
    const fallback = getCurrentCard();
    if (fallback && counts().total > 0) ids.add(fallback.id);
    const remaining = session ? Math.min([...ids].filter(sessionAllows).length, reviewSessionRemaining(session)) : counts().total;
    return Math.max(remaining, ratingWrite() || removalWrite() ? 1 : 0);
  });

  // The interaction phase describes the encounter, never a background write.
  // Failed operations report recoverable errors alongside the same question.
  const presentation = createMemo(() => studySessionState({
    ready: !!currentEncounter() || !languageLoading(),
    index: finiteSession()?.completedCardIds.length ?? cardsAnswered(),
    total: (finiteSession()?.completedCardIds.length ?? cardsAnswered()) + remainingWork(),
    revealed: showAnswer(),
    write: remainingWork() === 0 && ratingPersistenceState() !== 'idle' ? ratingPersistenceState() === 'failed' ? 'failed' : 'pending' : null,
  }));

  /** A rating may only be committed from a revealed, idle encounter. */
  const canRate = createMemo(() =>
    presentation().canRate && ratingWrite() === null && removalWrite() === null && !isRetractionWriteBlocking(retractionWrite()));
  const ratingArmed = createMemo(() => canRate() && !!currentCard()
    && !knowledge.loading() && knowledge.projection()?.status === 'ready' && admittedAccesses().length > 0
    && ratingPersistenceState() !== 'failed'
    && choiceWrite()?.phase !== 'failed' && (!finiteSession() || choiceWrite()?.phase !== 'pending') && assistanceWrite() === null);

  function refreshReferenceAssistance(): void { timed('refreshReferenceAssistance', () => {
    const card = currentCard();
    try {
      const scope = card ? assistanceScope(card) : null;
      const record = scope ? assistanceStore.read(scope, currentEncounter()?.provenance.id) : null;
      // Reopening after answer exposure carries the answer, never a fresh recall.
      const correcting = !!currentEncounter()?.cursor?.correction;
      const revealed = correcting || record?.revealed === true;
      const resumed = correcting ? null : revealed && record && card ? { ...record, scaffolds: { ...record.scaffolds,
        ...providedAccessScaffolds(currentEncounter()?.tested ?? []) } } : record;
      batch(() => {
        setShowAnswer(revealed);
        setReferenceAssistance(resumed);
        setAssistanceWrite(null);
        setRestoredAssistanceScope(scope);
      });
      retryReference = undefined;
    } catch (error) {
      log.warn('Failed to restore review assistance:', error);
      setAssistanceWrite('failed');
      retryReference = refreshReferenceAssistance;
    }
  }); }

  function withReferenceContent(open: () => void, media = false): void {
    const card = currentCard();
    if (!card || ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite()) || assistanceWrite() === 'pending') return;
    if (showAnswer()) { open(); return; }
    const encounter = referenceEncounter;
    const choiceId = currentEncounter()!.provenance.id;
    const scope = assistanceScope(card);
    const sameEncounter = () => !disposed && referenceEncounter === encounter
      && currentEncounter()?.provenance.id === choiceId && !!currentCard() && assistanceScope(currentCard()!) === scope && ratingWrite() === null;
    const save = () => {
      if (!sameEncounter()) return;
      setAssistanceWrite('pending');
      void Promise.resolve().then(() => {
        const capabilities = currentEncounter()?.tested ?? [];
        // Front clips can expose sound, subtitles and translation. Treat the
        // whole clip as reference content; do not guess which answer it hides.
        return assistanceStore.provide(scope, { ...providedAccessScaffolds(capabilities), ...(media ? { media: true } : {}) }, sameEncounter, choiceId, true);
      }).then(record => {
        if (!record || !sameEncounter()) return;
        setReferenceAssistance(record);
        setAssistanceWrite(null);
        retryReference = undefined;
        open();
      }).catch(error => {
        if (!sameEncounter()) return;
        log.warn('Failed to save review reference exposure:', error);
        setAssistanceWrite('failed');
        retryReference = save;
      });
    };
    save();
  }

  createEffect(on(() => currentCard() ? JSON.stringify([assistanceScope(currentCard()!), currentEncounter()?.provenance.id]) : null, () => {
    timed('choiceScopeEffect', () => {
      referenceEncounter += 1;
      refreshReferenceAssistance();
    });
  }));

  const sessionAnswered = () => finiteSession()?.completedCardIds.length ?? cardsAnswered();
  const sessionTotal = createMemo(() => sessionAnswered() + remainingWork());
  // Calculate session progress percentage


  // Keyboard shortcuts
  {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRatingKeyIgnored(e)) return;

      // Native controls own Space/Enter. The study surface owns those keys
      // only while focus remains on non-interactive prompt content.
      if (isRevealKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (presentation().phase === 'question' && currentCard()) handleFlip();
        return;
      }

      // Undo rewrites the journal a pending write is appending to, so it waits
      // for the write to land. Other shortcuts are unaffected by that write.
      if (isUndoShortcut(e)) {
        if (isBlockedByPendingWrite('undo', ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite()))) { e.preventDefault(); return; }
        if (canUndo()) { e.preventDefault(); void handleUndo(); }
        return;
      }

      if (isNativeActivationTarget(e)) return;

      if (presentation().phase === 'complete') return;

      if (!currentCard()) return;

      if (!showAnswer()) {
        if (e.key === 'b') {
          e.preventDefault();
          handleBury();
        } else if (e.key === 'x') {
          e.preventDefault();
          handleRemove();
        }
      } else if (e.key === 'b') {
        e.preventDefault();
        handleBury();
      }
    };

    useLearningInput('surface', handleKeyDown, 'document');
  }

  // The session is over when the queue has drained: the contract already
  // reports that as `complete`, so completion is not tracked twice.
  createEffect(on(() => presentation().phase, phase => {
    if (phase !== 'complete') return;
    if (props.continueAfterBatch && finiteSession() && !releaseWrite()
      && [...queue().newQueue, ...queue().scheduledQueue].some(id => {
        const card = store.flashcards[id];
        return card && !card.suspended && !card.buried && languageForCard(card) === settings.language
          && !isWordIgnoredSync(card.content.front, settings.language);
      })) { void startNewReview(); return; }
    props.onComplete?.();
  }));

  // A new displayed card starts face-down (R20 repair): the reveal belongs
  // to one encounter, so an action that moves the displayed card must not
  // leak a revealed answer onto the next one. `on` fires only when the id
  // actually changes, so a pinned same-id re-run never flips the reveal.
  createEffect(on(
    () => currentCardId(),
    () => {
      resetReviewScroll();
    }
  ));

  // One automatic cue per pinned encounter. A provider may publish the next
  // card before its previous rating ACK returns; wait for admission to reopen.
  let automaticAudioEncounter: ReturnType<typeof currentEncounter> = null;
  createEffect(() => {
    const encounter = currentEncounter();
    const ready = !!encounter && ratingWrite() === null && removalWrite() === null && !isRetractionWriteBlocking(retractionWrite()) && assistanceWrite() === null;
    if (!encounter || encounter.activity.kind !== 'holistic' || encounter.activity.stages || !ready || restoredAssistanceScope() !== assistanceScope(encounter.card) || showAnswer() || !settings.flashcardAutoTts || settings.flashcardMuteAudio
      || automaticAudioEncounter === encounter) return;
    automaticAudioEncounter = encounter;
    timed('autoTtsEffect', () => handlePlayTts(encounter.card.id, encounter.card.content.front, 'word', true, false));
  });

  // Auto-TTS: play example when answer is revealed (waits for word TTS to finish)
  // Skip example TTS for cards with video — the video provides the audio
  createEffect(on(
    () => showAnswer(),
    (isShown) => {
      if (currentEncounter()?.activity.kind !== 'holistic' || !isShown || !settings.flashcardAutoTts || settings.flashcardMuteAudio) return;
      const card = currentCard();
      if (!card?.content.example || card.content.example === '-') return;
      if (card.content.videoUrl || card.content.skipExampleTts) return;
      // Play example immediately — playTts stops any previous audio first
      playTts(card.id, card.content.example!, languageForCard(card), 'example', { silentIfMissing: true });
    }
  ));

  const handleUndo = async () => {
    if (ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())) return;
    setRetractionWrite('pending');
    lastLocallyRated = undefined;
    try {
      const actionType = await undoLastAction();
      batch(() => {
        if (actionType === 'answer') setCardsAnswered(prev => Math.max(0, prev - 1));
        setRetractionWrite(null); setShowAnswer(false);
        // Publish one settled restored choice, without an intermediate cursor write.
        decisionPin.advance();
      });
      resetReviewScroll();
    } catch (error) {
      log.warn('Failed to persist flashcard Undo:', error);
      setRetractionWrite('failed');
    }
  };

  const handleBury = () => {
    if (ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())) return;
    const card = currentCard();
    if (!card) return;
    stopTiming();
    batch(() => {
      setShowAnswer(false);
      buryCard(card.id);
    });
    // The bury changed the pool: re-select afresh (R20 pin repair).
    decisionPin.advance();
    resetReviewScroll();
  };

  const removalStillMatches = (write: NonNullable<ReturnType<typeof removalWrite>>) => {
    const stored = store.flashcards[write.card.id];
    return settings.language === write.sessionLanguage && !!stored && JSON.stringify(stored) === JSON.stringify(write.card)
      && (stored.language || settings.language) === write.language;
  };

  const commitRemoval = async (write: NonNullable<ReturnType<typeof removalWrite>>) => {
    const pending = { ...write, phase: 'pending' as const };
    setRemovalWrite(pending);
    let removed = false;
    try {
      removed = removalStillMatches(pending) && await removeFlashcard(pending.card.id, true);
    } catch (error) {
      log.warn('Failed to persist flashcard removal:', error);
    }
    if (disposed || removalWrite() !== pending || settings.language !== pending.sessionLanguage) return;
    if (!removed) {
      setRemovalWrite({ ...pending, phase: 'failed' });
      return;
    }
    stopTiming();
    batch(() => {
      setShowAnswer(false);
      decisionPin.advance();
      setRemovalWrite(null);
    });
    resetReviewScroll();
  };

  const handleRemove = async () => {
    if (ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite()) || assistanceWrite() !== null) return;
    const encounter = currentEncounter();
    const card = currentCard();
    if (!encounter || !card) return;
    // Hold the confirmed encounter across the dialog and durable command.
    const write = { encounter, card: JSON.parse(JSON.stringify(card)) as Flashcard,
      language: languageForCard(card), sessionLanguage: settings.language, phase: null };
    setRemovalWrite(write);
    if (requiresDestructiveConfirmation(1)) {
      const confirmed = await showConfirm(buildDestructiveConfirmOptions({
        count: 1,
        titleKey: 'mlearn.Flashcards.Modals.DeleteCard.Title',
        messageKey: 'mlearn.Flashcards.Modals.DeleteCard.Confirm',
      }, t));
      if (disposed || removalWrite() !== write || settings.language !== write.sessionLanguage) return;
      if (!confirmed) { setRemovalWrite(null); return; }
    }
    await commitRemoval(write);
  };

  const audioPromptReady = () => displayedKind() !== 'audio-recognition'
    || audioHeardChoice() === currentEncounter()?.provenance.id || showAnswer();
  const playActivityAudio = () => {
    const encounter = currentEncounter();
    if (!encounter || ratingWrite() || removalWrite() || assistanceWrite() === 'pending') return;
    const id = encounter.provenance.id;
    setAudioFailedChoice(null);
    void playTts(encounter.card.id, encounter.card.content.front, languageForCard(encounter.card), 'word', {
      savedOnly: true,
      beforePlay: async () => {
        const same = () => !disposed && currentEncounter()?.provenance.id === id && !settings.flashcardMuteAudio;
        if (!same()) return false;
        setAssistanceWrite('pending');
        try {
          const data = languageDataForCard(encounter.card);
          const supplied = getProvidedAccessesForCue(data, Object.keys(data?.learning?.capabilities ?? {}), 'word-audio')
            .filter(capability => !encounter.tested.includes(capability));
          const record = await assistanceStore.provide(assistanceScope(encounter.card),
            { audio: true, ...providedAccessScaffolds(supplied) }, same, id);
          if (!record || !same()) return false;
          setReferenceAssistance(record);
          setAssistanceWrite(null);
          retryReference = undefined;
          return true;
        } catch (error) {
          if (same()) {
            log.warn('Failed to save the audio prompt receipt:', error);
            setAssistanceWrite('failed');
            retryReference = playActivityAudio;
          }
          return false;
        }
      },
      onCompleted: () => { if (!disposed && currentEncounter()?.provenance.id === id) setAudioHeardChoice(id); },
      onUnavailable: () => { if (!disposed && currentEncounter()?.provenance.id === id) setAudioFailedChoice(id); },
    });
  };

  const handleFlip = () => {
    const card = currentCard();
    if (!card || removalWrite() || ratingWrite() || assistanceWrite() === 'failed' || showAnswer() || !audioPromptReady()) return;
    const encounter = currentEncounter();
    if (hasNextStage()) {
      if (choiceWrite()?.phase === 'pending' || assistanceWrite() === 'pending') return;
      const index = stageIndex() + 1;
      const advance = async () => {
        setAssistanceWrite('pending');
        try {
          const previous = store.meta.reviewPresentations?.[languageForCard(card)];
          if (!previous || previous.id !== encounter!.provenance.id) throw new Error('The staged question was replaced');
          await saveReviewPresentation(languageForCard(card), { ...previous, stageIndex: index,
            stageScaffolds: { ...previous.stageScaffolds, [currentStage()!.id]: {
              ...restoredAssistance(), ...referenceAssistance()?.scaffolds,
            } } }, previous.id);
          if (disposed || currentEncounter() !== encounter) return;
          setStagePosition({ id: encounter!.provenance.id, index });
          setAssistanceWrite(null); retryReference = undefined; resetReviewScroll();
        } catch (error) {
          log.warn('Failed to save retrieval stage:', error);
          setAssistanceWrite('failed'); retryReference = () => { void advance(); };
        }
      };
      void advance(); return;
    }
    const scope = assistanceScope(card);
    const isCurrent = () => !disposed && currentEncounter() === encounter && !!currentCard()
      && assistanceScope(currentCard()!) === scope && !ratingWrite() && !removalWrite();
    const save = () => {
      if (!isCurrent()) return;
      setAssistanceWrite('pending');
      void assistanceStore.reveal(scope, encounter!.provenance.id, isCurrent).then(record => {
        if (!record || !isCurrent()) return;
        batch(() => {
          setReferenceAssistance({ ...record, scaffolds: { ...referenceAssistance()?.scaffolds, ...record.scaffolds } });
          setAssistanceWrite(null);
          setShowAnswer(true);
        });
        retryReference = undefined;
        resetReviewScroll();
      }).catch(error => {
        if (!isCurrent()) return;
        log.warn('Failed to save answer exposure before revealing:', error);
        setAssistanceWrite('failed');
        retryReference = save;
      });
    };
    save();
  };

  const handleRegenerateExample = async (cardId: string) => {
    const card = currentCard();
    if (!card || card.id !== cardId || regeneratingExample() || removalWrite()) return;
    const encounter = currentEncounter();
    const sessionLanguage = settings.language;
    const stillOwned = () => !disposed && !removalWrite() && currentEncounter() === encounter
      && currentCard()?.id === cardId && settings.language === sessionLanguage;

    setRegeneratingExample(true);
    try {
      const language = languageForCard(card);
      const languageData = languageDataForCard(card);
      const result = await generateExampleSentenceWithLLM(card.content.front, card.content.back, language);
      if (result.sentence && stillOwned()) {
        const exampleHtml = await colorizeTokenizedText({
          text: result.sentence,
          language,
          languageData,
          settings,
          colourCodes: resolveFlashcardColourCodes(languageData, settings.colour_codes),
          targetWord: card.content.front,
        });
        if (!stillOwned()) return;
        updateFlashcardContent(cardId, {
          example: exampleHtml,
          exampleMeaning: result.meaning || undefined,
        });
        showToast({ message: t('mlearn.CardEditor.RegenerateExample'), variant: 'success' });
      }
    } catch (e) {
      log.warn('Failed to regenerate example:', e);
    } finally {
      setRegeneratingExample(false);
    }
  };

  const handleEditCardSave = (content: FlashcardContent, metadataUpdates?: Partial<Flashcard>) => {
    const card = editingCard();
    if (!card) return;
    if (metadataUpdates && Object.keys(metadataUpdates).length > 0) {
      updateFlashcard(card.id, { content: { ...card.content, ...content }, ...metadataUpdates });
    } else {
      updateFlashcardContent(card.id, content);
    }
    setShowEditModal(false);
    setEditingCard(null);
  };

  const handleEditCardClose = () => {
    setShowEditModal(false);
    setEditingCard(null);
  };

  const handleOpenEditModal = () => {
    const card = currentCard();
    if (!card) return;

    batch(() => {
      setEditingCard(card);
      setShowEditModal(true);
    });
  };

  const handleStartOver = () => {
    batch(() => {
      refreshQueue();
      setSessionEpoch(epoch => epoch + 1);
      decisionPin.advance();
      setShowAnswer(false);
      setCardsAnswered(0);
    });
    resetReviewScroll();
  };

  // Rating buttons config with time estimates
  
  // Get state label variant
  const getStateLabelVariant = (card: Flashcard) => {
    switch (card.state) {
      case 'new': return 'primary' as const;
      case 'learning': return 'warning' as const;
      case 'relearning': return 'error' as const;
      case 'review': return 'success' as const;
      default: return 'default' as const;
    }
  };

  // Get state label text
  const getStateLabelText = (card: Flashcard) => {
    switch (card.state) {
      case 'new': return t('mlearn.Flashcards.Review.NewCard');
      case 'learning': return t('mlearn.Flashcards.Review.LearningCard');
      case 'relearning': return t('mlearn.Flashcards.Review.RelearningCard');
      case 'review': return t('mlearn.Flashcards.Review.ReviewCard');
      default: return '';
    }
  };

  return (
      <div class="flashcard-review-container" data-review-phase={presentation().phase} data-encounter-id={currentEncounter()?.provenance.id} style={props.style}>
        <Show when={learning.failed()}><KnowledgeLoadError onRetry={learning.retry} /></Show>
        <div class="review-activity-preferences">
          <Button ref={element => { activityPreferencesAnchor = element; }} size="sm" variant="ghost" aria-haspopup="dialog" aria-expanded={showActivityPreferences()} onClick={() => setShowActivityPreferences(!showActivityPreferences())}>
            {t('mlearn.Flashcards.Review.Activities')}
          </Button>
          <Popover open={showActivityPreferences} anchor={() => activityPreferencesAnchor} onClose={() => setShowActivityPreferences(false)}
            label={t('mlearn.Flashcards.Review.Activities')} class="review-activities-popover">
            <p>{t('mlearn.Flashcards.Review.ActivitiesHint')}</p>
            <ToggleSwitch checked={preferences().holistic} label={t('mlearn.Flashcards.Review.Holistic')}
              onChange={checked => updateSetting('reviewActivities', { ...preferences(), holistic: checked })} />
            <ToggleSwitch checked={preferences().focused} label={t('mlearn.Flashcards.Review.Focused')}
              onChange={checked => updateSetting('reviewActivities', { ...preferences(), focused: checked })} />
            <ToggleSwitch checked={preferences().audio} label={t('mlearn.Flashcards.Review.Audio')}
              onChange={checked => updateSetting('reviewActivities', { ...preferences(), audio: checked })} />
            <Button size="sm" onClick={refreshAudioResources}>{t('mlearn.Flashcards.Review.RefreshRecordings')}</Button>
          </Popover>
          <Show when={!currentCard() && remainingWork() > 0 && !languageLoading()}>
            <p role="status">{t('mlearn.Flashcards.Review.NoEligibleActivity')}</p>
            <Button size="sm" onClick={() => { refreshAudioResources(); }}>
              {t('mlearn.Global.TryAgain')}
            </Button>
            <Button size="sm" disabled={releaseWrite()?.phase === 'pending' || !!ratingWrite() || !!removalWrite() || isRetractionWriteBlocking(retractionWrite())}
              onClick={() => { void startNewReview(); }}>{t('mlearn.Flashcards.Review.StartNew')}</Button>
            <Show when={releaseWrite()?.phase === 'failed'}><p role="alert">{t('mlearn.Flashcards.Review.StartNewFailed')}</p></Show>
          </Show>
        </div>
        <Show when={sessionTotal() > 0}><StudySessionHUD class="flashcard-session-progress" completed={sessionAnswered()} total={sessionTotal()} /></Show>
        {/* Header with stats */}
        <div class="flashcard-review-header">
          <div class="flashcard-status">
            <Badge class="flashcard-stat flashcard-stat--new">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.New')}</span>
              <span class="flashcard-stat-value">{counts().new}</span>
            </Badge>
            <Badge class="flashcard-stat flashcard-stat--learning" variant="warning">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.LearningLabel')}</span>
              <span class="flashcard-stat-value">{counts().learning}</span>
            </Badge>
            <Badge class="flashcard-stat flashcard-stat--review" variant="success">
              <span class="flashcard-stat-label">{t('mlearn.Flashcards.Review.Review')}</span>
              <span class="flashcard-stat-value">{counts().review}</span>
            </Badge>
          </div>

          <div class="flashcard-header-actions">
            <Show when={ratingPersistenceState() === 'failed'}>
              <div class="flashcard-rating-write flashcard-rating-write--failed" role="alert">
                <span>{t('mlearn.Flashcards.Review.PendingRatingsSaveFailed')}</span>
                <Button size="sm" variant="primary" onClick={() => {
                  void retryRatingPersistence().catch(error => log.warn('Rating persistence retry failed:', error));
                }}>
                  {t('mlearn.Global.TryAgain')}
                </Button>
              </div>
            </Show>
            <ToggleSwitch
              checked={settings.flashcardStealthMode}
              onChange={(checked) => updateSetting('flashcardStealthMode', checked)}
              label={t('mlearn.Flashcards.Review.StealthMode')}
              title={t('mlearn.Flashcards.Review.StealthMode')}
              thumbIcon={<StealthIcon size={12} />}
            />
            <ToggleSwitch
              checked={settings.flashcardMuteAudio}
              onChange={(checked) => updateSetting('flashcardMuteAudio', checked)}
              label={t('mlearn.Flashcards.Review.MuteAudio')}
              title={t('mlearn.Flashcards.Review.MuteAudio')}
              thumbIcon={<VolumeOffIcon size={12} />}
            />
            <Show when={canUndo()}>
              <Button buttonType="default" variant="ghost" size="xs" disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())} onClick={() => { void handleUndo(); }} title={t('mlearn.Flashcards.Review.UndoTooltip')}>
                {t('mlearn.Flashcards.Review.Undo')}
              </Button>
            </Show>
            <WriteStatusBanner
              status={retractionWrite() === 'failed' ? 'failed' : null}
              savingLabelKey="mlearn.Flashcards.Review.SavingUndo"
              failedLabelKey="mlearn.Flashcards.Review.UndoSaveFailed"
              canRetry={canRetryRetraction(retractionWrite())}
              onRetry={() => { void handleUndo(); }}
              class="flashcard-rating-write"
              failedClass="flashcard-rating-write--failed"
            />
            <Show when={presentation().phase !== 'complete' && currentCard()}>
              <Button
                ref={(element) => { cardActionsAnchor = element; }}
                variant="ghost"
                size="xs"
                class="flashcard-actions-trigger"
                disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())}
                aria-haspopup="dialog"
                aria-expanded={showCardActions()}
                onClick={() => setShowCardActions((open) => !open)}
              >
                {t('mlearn.Flashcards.Review.CardActions')}
              </Button>
              <Popover
                open={showCardActions}
                anchor={() => cardActionsAnchor}
                onClose={() => setShowCardActions(false)}
                label={t('mlearn.Flashcards.Review.CardActions')}
                class="flashcard-actions-popover"
              >
                <div class="flashcard-action-buttons">
                  <Button variant="ghost" size="xs" disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())} onClick={() => { setShowCardActions(false); handleBury(); }} title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'b' })}>
                    {t('mlearn.Flashcards.Review.Bury')}
                  </Button>
                  <Button variant="danger" size="xs" disabled={ratingWrite() !== null || removalWrite() !== null || isRetractionWriteBlocking(retractionWrite())} onClick={() => { setShowCardActions(false); handleRemove(); }} title={t('mlearn.Flashcards.Review.PressKeyTooltip', { key: 'x' })}>
                    {t('mlearn.Flashcards.Review.Remove')}
                  </Button>
                  <Button variant="ghost" size="xs" icon={<EyeIcon size={14} />} onClick={() => {
                  setShowCardActions(false);
                  const card = currentCard();
                  if (!card) return;
                  const language = languageForCard(card);
                  const surface = card.content.front;
                  // R20: the SAME pinned decision that selected this card rides
                  // into the existing Inspector drawer — the learner audits the
                  // selection (brief reason + emitted trace) where the
                  // knowledge lives. No recomputation anywhere.
                  const policy = currentPolicyInspection();
                  withReferenceContent(() => openKnowledgeInspector(surfaceKnowledgeInspection(
                      language,
                      surface,
                      policy,
                  )));
                  }}>{t('mlearn.Knowledge.Popup.Inspect')}</Button>
                  <Button variant="ghost" size="xs" onClick={() => { setShowCardActions(false); withReferenceContent(handleOpenEditModal); }} title={t('mlearn.Flashcards.Modals.EditCard.EditButton')} icon={<EditIcon size={14} />}>
                    {t('mlearn.Flashcards.Modals.EditCard.EditButton')}
                  </Button>
                  <Show when={isElectron()}>
                    <Button variant="ghost" size="xs" onClick={() => { setShowCardActions(false); withReferenceContent(() => setShowTtsModal(true)); }} title={t('mlearn.CardEditor.Regenerate.Title')} icon={<MicrophoneIcon size={14} />}>
                      {t('mlearn.CardEditor.Regenerate.Title')}
                    </Button>
                  </Show>
                </div>
              </Popover>
            </Show>
          </div>
        </div>

        <div class="flashcard-review-content" ref={reviewScrollContainer}>
        {/* Card or completion screen */}
        <Show
            when={presentation().phase !== 'complete' && currentCard()}
            fallback={
              <>
              <Show when={presentation().phase === 'saving'}><p role="status">{t('mlearn.Flashcards.Review.SavingRating')}</p></Show>
              <Show when={presentation().phase === 'complete' && releaseWrite()?.phase !== 'pending'}>
              <Panel
                  variant="default"
                  rounded="xl"
                  class="flashcard-completion"
              >
                <h2 class="flashcard-completion-title">
                  {t(finiteSession() ? 'mlearn.StudyEncounter.Finished' : 'mlearn.Flashcards.Review.Complete')}
                </h2>
                <p class="flashcard-completion-text">
                  {t(finiteSession() ? 'mlearn.StudyEncounter.Finished' : 'mlearn.Flashcards.Review.CompleteDescription', { count: sessionAnswered() })}
                </p>
                <OtherLanguageDueHint />
                <Show when={releaseWrite()?.phase === 'failed'}><p role="alert">{t('mlearn.Flashcards.Review.StartNewFailed')}</p><Button onClick={() => void startNewReview()}>{t('mlearn.Knowledge.Retry')}</Button></Show>
                <div class="flashcard-completion-actions">
                  <Show when={Object.keys(store.flashcards).length > 0}>
                    <Button buttonType="default" variant="primary" onClick={handleStartOver}>
                      {t('mlearn.Flashcards.Review.ReviewMore')}
                    </Button>
                  </Show>
                  <Show when={props.onClose}>
                    <Button buttonType="default" onClick={props.onClose}>
                      {t('mlearn.Global.Close')}
                    </Button>
                  </Show>
                </div>
              </Panel>
              </Show>
              </>
            }
        >
          {/* Card state indicator */}
          <Show when={currentCard()}>
            <div class="flashcard-state-indicator">
              <Badge variant={getStateLabelVariant(currentCard()!)}>
                <span class="flashcard-stat-label">
                  {getStateLabelText(currentCard()!)}
                </span>
              </Badge>
            </div>
          </Show>
          {/* Show card - non-keyed to avoid remount delay between cards */}
          <StudyEncounter class="flashcard-study-encounter" prompt="" answer="" scheduling={true}
            instruction={currentStage()?.prompt || currentEncounter()?.activity.prompt || undefined}
            revealed={showAnswer()} onReveal={handleFlip} revealDisabled={!audioPromptReady() || (!!currentEncounter()?.activity.stages && (assistanceWrite() === 'pending' || choiceWrite()?.phase === 'pending'))}
            revealLabel={hasNextStage() ? t('mlearn.Global.Continue') : undefined}
            revealClass="flashcard-show-answer-btn" responseClass="flashcard-rating-buttons" controlsMount={reviewActionsTarget()}
            card={
          <Show when={currentCard()}>
            {(card) => (
              <Show when={currentEncounter()?.activity.kind === 'holistic' && !currentEncounter()?.activity.stages} fallback={
                <Panel class="review-activity">

                  <Show when={displayedKind() === 'holistic'}><div class="review-activity-cues"><span>{card().content.front}</span></div></Show>
                  <Show when={displayedKind() === 'written-reading-recall'}>
                    <div class="review-activity-cues"><span>{card().content.front}</span><span>{card().content.reading}</span></div>
                  </Show>
                  <Show when={displayedKind() === 'audio-recognition'}>
                    <Button class="review-activity-play" disabled={settings.flashcardMuteAudio || ttsGenerating() || assistanceWrite() !== null}
                      onClick={playActivityAudio}>{t('mlearn.Flashcards.Review.PlayPrompt')}</Button>
                    <Show when={audioFailedChoice() === currentEncounter()?.provenance.id}>
                      <p role="alert">{t('mlearn.Flashcards.Review.AudioUnavailable')}</p>
                    </Show>
                  </Show>
                  <Show when={showAnswer()}>
                    <div class="review-activity-answer">
                      <Show when={currentEncounter()?.activity.stages}><p>{card().content.back}</p></Show>
                      <Show when={displayedKind() === 'written-reading-recall'} fallback={
                        <><p>{card().content.front}</p><p>{card().content.reading}</p><p>{card().content.back}</p></>
                      }>
                        <ProsodyOverlay word={card().content.front} reading={card().content.reading} pos={card().content.pos}
                          language={languageForCard(card())} languageData={languageDataForCard(card())} mode="preview"
                          forceVisible={true} prosodyType={card().content.prosody?.type} prosodyPosition={card().content.prosody?.position} />
                        <Show when={card().content.prosody?.display}><p>{card().content.prosody?.display}</p></Show>
                      </Show>
                    </div>
                  </Show>
                </Panel>
              }>
              <FlashcardDisplay
                  flashcard={card()}
                  knowledge={currentEncounter()?.knowledge}
                  showAnswer={showAnswer()}
                  onFlip={handleFlip}
                  onPlayTts={handlePlayTts}
                  ttsPlayingField={ttsPlayingField()}
                  ttsGenerating={ttsGenerating()}
                  promptMediaOwner={currentEncounter()}
                  onOpenPromptMedia={(cardId, open) => {
                    if (currentCard()?.id === cardId) withReferenceContent(open, true);
                  }}
                  ttsMetadata={ttsMetadata()}
                  onRegenerateExample={removalWrite() ? undefined : handleRegenerateExample}
                  regeneratingExample={regeneratingExample()}
              />
              </Show>
            )}
          </Show>
            }
            rating={{ capabilities: testedAccesses(),
              capabilityLabels: Object.fromEntries(testedAccesses().map(capability => [capability,
                (currentCard() ? languageDataForCard(currentCard()!) : undefined)?.learning?.capabilities?.[capability]?.label])
                .filter((entry): entry is [string, string] => entry[1] !== undefined)),
              keyboardMode: settings.ratingKeyboardMode, armed: ratingArmed(), resetKey: currentEncounter()?.provenance.id,
              onSubmit: handleBulkRate }} />
        </Show>

        </div>

        {/* Buttons container */}
        <div class="flashcard-buttons-container" ref={element => { reviewActionsContainer = element; setReviewActionsTarget(element); }}>
          <WriteStatusBanner status={removalWrite()?.phase === 'failed' ? 'failed' : null}
            savingLabelKey="mlearn.Flashcards.Review.SavingRemoval" failedLabelKey="mlearn.Flashcards.Review.RemovalSaveFailed"
            canRetry={removalWrite()?.phase === 'failed' && removalStillMatches(removalWrite()!)}
            retryTestId="review-removal-retry"
            onRetry={() => { const failed = removalWrite(); if (failed?.phase === 'failed') void commitRemoval(failed); }} />
          <Show when={removalWrite()?.phase === 'failed'}>
            <Button size="sm" onClick={() => { setShowAnswer(false); setRemovalWrite(null); }}>
              {t('mlearn.Global.Cancel')}
            </Button>
          </Show>
          <WriteStatusBanner status={assistanceWrite() === 'failed' ? 'failed' : null}
            savingLabelKey="mlearn.WordSync.SavingAssistance" failedLabelKey="mlearn.WordSync.AssistanceSaveFailed"
            canRetry={assistanceWrite() === 'failed'} onRetry={() => retryReference?.()} />
          <Show when={currentEncounter()?.cursor?.correction}>
            <p class="flashcard-rating-write" role="status">{t('mlearn.Flashcards.Review.CorrectingReport')}</p>
          </Show>
          <Show when={!currentEncounter()?.cursor?.correction && (referenceAssistance()?.requested || !!restoredAssistance()) && (currentEncounter()?.activity.kind === 'holistic'
            || testedAccesses().some(capability => !isAccessMeasurable(capability, encounterAssistance())))}>
            <p class="flashcard-rating-write" role="status">{t((encounterAssistance().audio || encounterAssistance().media) ? 'mlearn.Flashcards.Review.AssistanceRecorded' : 'mlearn.WordSync.ReferenceConsulted')}</p>
          </Show>
          <Show when={choiceWrite()?.phase === 'failed'}>
            <WriteStatusBanner status="failed"
              savingLabelKey="mlearn.Flashcards.Review.PreparingQuestion"
              failedLabelKey="mlearn.Flashcards.Review.QuestionSaveFailed"
              canRetry={choiceWrite()?.phase === 'failed'}
              onRetry={retryChoice}
              class="flashcard-rating-write" failedClass="flashcard-rating-write--failed" />
          </Show>
          {/* Rating buttons */}
          <Show when={presentation().phase !== 'complete' && currentCard() && showAnswer()}>
            <div class="flashcard-rating-buttons">

              <WriteStatusBanner
                status={ratingWrite()?.phase === 'failed' ? 'failed' : null}
                savingLabelKey="mlearn.Flashcards.Review.SavingRating"
                failedLabelKey="mlearn.Flashcards.Review.SaveFailed"
                canRetry={ratingWrite()?.phase === 'failed'}
                onRetry={() => { const failed = ratingWrite(); if (failed) void commitRating(failed); }}
                class="flashcard-rating-write"
                failedClass="flashcard-rating-write--failed"
              />
              <Show when={capabilityQueryFailed()}>
                <div class="flashcard-rating-write flashcard-rating-write--failed" role="alert">
                  <span>{t(knowledge.projection()?.status === 'error' ? 'mlearn.Knowledge.LoadError' : 'mlearn.Knowledge.UnavailableHint')}</span>
                  <Button size="sm" variant="primary" onClick={() => knowledge.retry()}>
                    {t('mlearn.Global.TryAgain')}
                  </Button>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        {/* TTS Regenerate Modal */}
        <Show when={currentCard()}>
          <TtsGenerateModal
            isOpen={showTtsModal()}
            onClose={() => setShowTtsModal(false)}
            onGenerated={refreshAudioResources}
            cardId={currentCard()!.id}
            language={languageForCard(currentCard()!)}
            languageData={languageDataForCard(currentCard()!)}
            wordText={currentCard()!.content.front}
            exampleText={currentCard()!.content.example}
          />
        </Show>

        {/* Edit Card Modal */}
        <FlashcardEditModal
          isOpen={showEditModal()}
          flashcard={editingCard()}
          onClose={handleEditCardClose}
          onSave={handleEditCardSave}
        />

        <ConfirmDialogElement />
      </div>
  );
};
