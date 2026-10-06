import { isLearningDecision } from '../../../shared/learningDecision';
import { ReviewWorkspace } from './ReviewWorkspace';
import { flashcardAudioProvider } from '../../../shared/utils/flashcardAudioPreset';
import { FlashcardAudioPresetSelect } from '../../components/flashcard/FlashcardAudioPresetSelect';
import { FlashcardRepairOptions } from '../../components/flashcard/FlashcardRepairOptions';
import { FlashcardCreateModal } from '../../components/flashcard/FlashcardCreateModal';
import { buildDestructiveConfirmOptions, requiresDestructiveConfirmation } from './bulkDestructiveConfirm';
import { FlashcardInspectButton } from '../../components/flashcard/FlashcardInspectButton';
import { KnowledgeGate } from '../../components/common/KnowledgeGate/KnowledgeGate';
/** Routed Review admission and saved-material management share the existing card owner. */

import { Component, Show, For, createSignal, createMemo, createEffect, on, onCleanup } from 'solid-js';
import { useLocalization, useSettings, useLowPowerGate, useLanguage } from '../../context';
import { useFlashcards } from '../../context';
import { FlashcardReview, FlashcardEditModal, FlashcardSyncModal, FlashcardWordTitle } from '../../components/flashcard';
import { Button, Modal, Input, Badge, useConfirmDialog, EmptyState, SearchIcon, TabContainer, Select, BookIcon, SparklesIcon, PlusIcon, ProgressBar, ResponsiveSidebar, MicrophoneIcon, VoiceSamplePicker, CollapsibleStickyHeader, FilterBuilder, SelectableCard, TrashIcon, buildFlashcardBrowseFields, buildEmptyPreset, evaluateAst, parseTokens, validateTokens, type ExprNode, type FieldConfig, type FieldResolver, type FilterToken, type PaletteItem, type ValidationError } from '../../components/common';
import { showToast, updateToast, removeToast } from '../../components/common/Feedback/Toast';
import { getLanguageDisplayName, stripHtmlForTts } from '../../../shared/utils/textUtils';
import { getBridge } from '../../../shared/bridges';
import { resolveCloudApiUrl } from '../../../shared/backends';
import { isElectron } from '../../../shared/platform';
import { colorizeTokenizedText } from '../../utils/languageTokenization';
import { getLevelStudyLevelNames } from '../../utils/wordLevelStats';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import { useItemSelection } from '../../hooks/useItemSelection';
import { withCloudAuth } from '../../services/cloudSessionManager';
import { absorbProviderFailure, classifyProviderFailure } from '../../services/providerFailure';
import { isLLMReady } from '../../services/llmProvider';
import { DEFAULT_SETTINGS, type Flashcard, type FlashcardContent, type LanguageData, type TTSProvider, type FlashcardAudioPreset } from '../../../shared/types';
import type { TabItem } from '../../components/common/Tabs/TabContainer';
import { syncFlashcardsPluginActivity, type FlashcardsTabId } from './pluginActivity';
import { getSuggestedFlashcardBadgeCount } from './flashcardsSuggestedCount';
import { buildBulkExampleUpdates } from '../../utils/flashcardBulkExamples';
import { DEFAULT_REPAIR_SELECTION, selectRepairFindings, repairAspect, planFlashcardRepair, type ExampleFinding, type RepairFinding, type RepairSelection, type ScanOptions } from '../../utils/flashcardRepairPlan';
import { runFlashcardRepair, runMissingFlashcardRepair, type RepairRunResult } from '../../utils/flashcardRepairRunner';
import { planBulkGeneration, type BulkGenerationMode, type BulkGenerationModeFor } from './bulkGenerationPlan';
import './FlashcardsLayout.css';
import './FlashcardsBrowse.css';
import './FlashcardsGenerate.css';
import { FlashcardsSuggested } from './FlashcardsSuggested';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.flashcards.app");

type TabId = FlashcardsTabId;
type MaterialTabId = Exclude<TabId, 'review'>;

/** The bridge-backed probes the shared repair plan needs, in one place. */
const ttsScanDeps = (
  bridge: ReturnType<typeof getBridge>,
  languageDataFor: (card: Flashcard) => LanguageData | null,
) => ({
  getExistingTts: async (cardId: string, field: 'word' | 'example') =>
    Boolean(await bridge.flashcards.getFlashcardTts(cardId, field)),
  getTtsGeneratedAt: async (cardId: string, field: 'word' | 'example') => {
    const meta = await bridge.flashcards.getFlashcardTtsMeta(cardId, field);
    return meta ? new Date(meta.generatedAt).getTime() : null;
  },
  getSpeakableText: (card: Flashcard, field: 'word' | 'example') => {
    const raw = field === 'word' ? card.content.front : card.content.example;
    return raw ? stripHtmlForTts(raw, false, languageDataFor(card)) : '';
  },
});

/** Format milliseconds into a human-readable ETA string (e.g. "2m 30s") */
const formatEta = (ms: number): string => {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
};

export const FlashcardsContent: Component<{ initialTab?: TabId; onClose: () => void; workspace: 'review' | 'material' | 'flashcards'; launchContext?: Record<string, unknown> }> = (props) => {
  const {
    getAllCards,
    getCardById,
    removeFlashcard,
    addFlashcard,
    updateFlashcardContent,
    updateFlashcard,
    getSuggestedFlashcardsSync,
    intervalToString,
    generateExampleSentencesWithLLM,
    translateExampleSentence,
    isLoading,
    isKnowledgeReady,
  } = useFlashcards();
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const { requestAccess } = useLowPowerGate();
  const { langData, currentLangData } = useLanguage();

  const admittedTab = (tab?: string): TabId => props.workspace === 'review' ? 'review'
    : tab === 'review' && props.workspace === 'flashcards' ? 'review'
    : tab && ['browse', 'generate', 'suggested'].includes(tab) ? tab as MaterialTabId
    : props.workspace === 'flashcards' ? 'review' : 'browse';
  const [activeTab, setActiveTab] = createSignal<TabId>(admittedTab(props.initialTab));
  const [reviewContext, setReviewContext] = createSignal(props.launchContext);
  createEffect(() => {
    setReviewContext(props.launchContext);
    setActiveTab(admittedTab(typeof props.launchContext?.tab === 'string' ? props.launchContext.tab : props.initialTab));
  });
  const reviewSessionRequest = createMemo(() => {
    const context = reviewContext();
    if (context?.activity !== 'review') return undefined;
    const session = context.session as { encounterLimit?: unknown; requestId?: unknown; initialCardId?: unknown; decision?: unknown } | undefined;
    if (!session || typeof session.encounterLimit !== 'number' || !Number.isFinite(session.encounterLimit)) return undefined;
    return { encounterLimit: Math.max(1, Math.min(120, Math.floor(session.encounterLimit))),
      ...(typeof session.requestId === 'string' ? { requestId: session.requestId } : {}),
      ...(typeof session.initialCardId === 'string' ? { initialCardId: session.initialCardId } : {}),
      ...(isLearningDecision(session.decision) ? { decision: session.decision } : {}) };
  });
  const reviewContextRefused = createMemo(() => {
    const context = reviewContext();
    if (context?.activity !== 'review') return false;
    const session = context.session as { decision?: unknown; requestId?: unknown } | undefined;
    return session?.decision !== undefined && (!isLearningDecision(session.decision) || session.decision.id !== session.requestId);
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = createSignal(false);
  const [isWindowFocused, setIsWindowFocused] = createSignal(typeof document !== 'undefined' ? document.hasFocus() : false);
  const [isWindowVisible, setIsWindowVisible] = createSignal(typeof document === 'undefined' || document.visibilityState === 'visible');
  const [selectedCard, setSelectedCard] = createSignal<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [deletionPending, setDeletionPending] = createSignal(false);
  let deletionGeneration = 0;
  onCleanup(() => { deletionGeneration++; });
  createEffect(on(() => settings.language, () => {
    deletionGeneration++;
    setDeletionPending(false);
    setShowDeleteConfirm(false);
    setSelectedCard(null);
  }, { defer: true }));
  const { showConfirm, ConfirmDialogElement } = useConfirmDialog();
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [showSyncModal, setShowSyncModal] = createSignal(false);
  const [editingCard, setEditingCard] = createSignal<Flashcard | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = createSignal('');

  // Sort state
  const [sortBy, setSortBy] = createSignal('default');

  // Filter expression state
  const [filterTokens, setFilterTokens] = createSignal<FilterToken[]>(buildEmptyPreset());

  // Returns the single language the current filter scopes to, or null when the
  // browse is not restricted to exactly one language (multi-level-system safety).
  const singleLanguageScope = (tokens: FilterToken[]): string | null => {
    const langs = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== 'operand' || token.field !== 'language') continue;
      if (!token.value) return null;
      langs.add(token.value);
    }
    return langs.size === 1 ? [...langs][0] : null;
  };

  // Bulk operation state
  const [bulkProgress, setBulkProgress] = createSignal<{ current: number; total: number; label: string; startTime: number } | null>(null);

  // TTS provider override for bulk generation (defaults to settings value)
  const [bulkTtsProvider, setBulkTtsProvider] = createSignal<TTSProvider>(settings.flashcardTtsProvider);
  const [bulkAudioPreset, setBulkAudioPreset] = createSignal<FlashcardAudioPreset>(settings.flashcardRegenerationAudioPreset ?? DEFAULT_SETTINGS.flashcardRegenerationAudioPreset);
  const bulkAudioProvider = () => flashcardAudioProvider(bulkAudioPreset(), bulkTtsProvider());
  createEffect(on(() => settings.flashcardRegenerationAudioPreset, (preset) => {
    setBulkAudioPreset(preset ?? DEFAULT_SETTINGS.flashcardRegenerationAudioPreset);
  }));

  // Each bulk button picks its own mode. They used to share one "Generation
  // mode" picker above both, which is why the Examples button could offer
  // "Regenerate older than date": TTS records a generation timestamp per field
  // and can honour a cutoff, while an example is plain card content with no
  // generation stamp, so that mode was accepted by the picker and then
  // silently ignored by the run. One picker for two operations with different
  // capabilities is what made the option look available when it was not.
  const [bulkTtsMode, setBulkTtsMode] = createSignal<BulkGenerationModeFor<'tts'>>('onlyEmpty');
  const [bulkExampleMode, setBulkExampleMode] = createSignal<BulkGenerationModeFor<'examples'>>('onlyEmpty');

  // Cutoff date for the TTS 'olderThan' mode (default: today in YYYY-MM-DD)
  const [bulkOlderThanDate, setBulkOlderThanDate] = createSignal(
    new Date().toISOString().slice(0, 10)
  );

  // Browse TTS hook
  const { playTts: browseTtsPlay, playingField: browseTtsPlayingField, isGenerating: browseTtsGenerating, stop: browseTtsStop } = useFlashcardTts();
  const [browseTtsCardId, setBrowseTtsCardId] = createSignal<string | null>(null);

  // Retain the shared findings directly, including missing example sentences.
  const [repairFindings, setRepairFindings] = createSignal<RepairFinding[]>([]);
  const [showRepairModal, setShowRepairModal] = createSignal(false);
  const [repairRunning, setRepairRunning] = createSignal(false);
  const [repairSelection, setRepairSelection] = createSignal({ ...DEFAULT_REPAIR_SELECTION });
  const [repairAudioPreset, setRepairAudioPreset] = createSignal<FlashcardAudioPreset>(settings.flashcardRegenerationAudioPreset ?? DEFAULT_SETTINGS.flashcardRegenerationAudioPreset);
  const repairCounts = createMemo(() => {
    const counts: Record<keyof RepairSelection, number> = { content: 0, example: 0, wordAudio: 0, exampleAudio: 0, exampleMeaning: 0 };
    for (const finding of repairFindings()) counts[repairAspect(finding)]++;
    return counts;
  });
  const selectedRepairCount = () => Object.entries(repairCounts()).reduce(
    (count, [aspect, available]) => count + (repairSelection()[aspect as keyof typeof DEFAULT_REPAIR_SELECTION] ? available : 0), 0,
  );
  const hasSelectedRepairAudio = () => settings.flashcardAutoGenerateAudio !== false && ((repairSelection().wordAudio && repairCounts().wordAudio > 0)
    || (repairSelection().exampleAudio && (repairCounts().exampleAudio > 0 || repairSelection().example && (repairCounts().example > 0 || repairSelection().content && repairCounts().content > 0))));
  const repairAudioProvider = () => flashcardAudioProvider(repairAudioPreset(), settings.flashcardTtsProvider);
  const openRepairModal = () => {
    setRepairSelection({ ...DEFAULT_REPAIR_SELECTION });
    setRepairAudioPreset(settings.flashcardRegenerationAudioPreset ?? DEFAULT_SETTINGS.flashcardRegenerationAudioPreset);
    setShowRepairModal(true);
    void refreshRepairFindings();
  };


  const languageForCard = (card: Flashcard): string => card.language || settings.language;
  const languageDataForCard = (card: Flashcard) => {
    const language = languageForCard(card);
    return langData[language] ?? (language === settings.language ? currentLangData() : null);
  };

  createEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const syncWindowFocus = () => {
      setIsWindowFocused(document.hasFocus());
      setIsWindowVisible(document.visibilityState === 'visible');
    };

    window.addEventListener('focus', syncWindowFocus);
    window.addEventListener('blur', syncWindowFocus);
    document.addEventListener('visibilitychange', syncWindowFocus);

    onCleanup(() => {
      window.removeEventListener('focus', syncWindowFocus);
      window.removeEventListener('blur', syncWindowFocus);
      document.removeEventListener('visibilitychange', syncWindowFocus);
    });
  });

  syncFlashcardsPluginActivity({
    activeTab,
    isFocused: isWindowFocused,
    isVisible: isWindowVisible,
    language: () => settings.language,
  });

  const repairScanOptions = (): ScanOptions => ({
    scope: 'all',
    activeLanguage: settings.language,
    autoGenerateAudio: settings.flashcardAutoGenerateAudio,
    llmReady: isLLMReady(settings),
  });
  const scanRepairs = () => planFlashcardRepair(getAllCards(), repairScanOptions(), ttsScanDeps(getBridge(), languageDataForCard));
  let repairScanGeneration = 0;
  const refreshRepairFindings = async () => {
    const generation = ++repairScanGeneration;
    try {
      const findings = await scanRepairs();
      if (generation === repairScanGeneration && !repairRunning()) setRepairFindings(findings);
    } catch (error) {
      log.error('Flashcard repair scan failed', error);
    }
  };
  createEffect(on(() => [activeTab(), isLoading(), isLLMReady(settings), settings.flashcardAutoGenerateAudio], () => {
    if (activeTab() !== 'review' && !isLoading() && isElectron() && !repairRunning()) void refreshRepairFindings();
  }));

  const generateRepairExamples = async (exampleFindings: readonly ExampleFinding[]) => {
    const updates = await buildBulkExampleUpdates(exampleFindings.map((finding) => getCardById(finding.card.id) ?? finding.card), {
      activeLanguage: settings.language,
      settings,
      colourCodes: settings.colour_codes ?? {},
      getLanguageData: (language) => langData[language] ?? (language === settings.language ? currentLangData() : null),
      generateExampleSentences: generateExampleSentencesWithLLM,
      colorizeTokenizedText,
    });
    return updates.map((update) => update ? { cardId: update.cardId, content: update.content as Record<string, unknown> } : null);
  };

  // Repair missing assets with retries for transient failures
  const MAX_REPAIR_RETRIES = 3;

  const handleRepair = async () => {
    if (repairRunning()) return;
    const selection = { ...repairSelection() };
    const findings = selectRepairFindings(repairFindings(), selection);
    if (findings.length === 0) return;

    const bridge = getBridge();
    const preset = repairAudioPreset();
    const provider = repairAudioProvider();
    const voiceSampleId = settings.flashcardVoiceSampleId || undefined;
    const cloudApiUrl = resolveCloudApiUrl(settings);
    if (hasSelectedRepairAudio() && provider === 'cloud' && settings.cloudAuthStatus !== 'signed-in') {
      showToast({ message: t('mlearn.CardEditor.NoCloudAuth'), variant: 'warning', duration: 6000 });
      return;
    }
    setShowRepairModal(false);
    setRepairRunning(true);

    const toastId = showToast({
      variant: 'info',
      title: t('mlearn.Flashcards.Repair.ToastTitle'),
      content: <ProgressBar value={0} size="md" variant="primary" showPercent percentPosition="below" />,
      duration: 0,
    });

    let localTtsAllowed: boolean | undefined;

    // One runner for every kind: dictionary content, examples, translations, then
    // audio, so nothing is generated against a field that is about to change.
    let result: RepairRunResult;
    try {
      result = await runMissingFlashcardRepair(findings, {
        getCards: getAllCards,
        scanOptions: repairScanOptions(),
        tts: ttsScanDeps(bridge, languageDataForCard),
        selection,
        generateExamples: generateRepairExamples,
        activeLanguage: settings.language,
        getLanguageData: (language) => langData[language] ?? (language === settings.language ? currentLangData() : null),
        settings,
        applyContent: (cardId, content) => updateFlashcardContent(cardId, content, false),
        generateTts: async (job) => {
          if (provider !== 'cloud') {
            localTtsAllowed ??= await requestAccess('tts');
            if (!localTtsAllowed) return false;
          }
          return Boolean(provider === 'cloud'
            ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(
              job.cardId, job.text, job.language, job.field, provider, voiceSampleId, cloudToken, cloudApiUrl, preset))
            : await bridge.flashcards.generateFlashcardTts(
              job.cardId, job.text, job.language, job.field, provider, voiceSampleId, undefined, cloudApiUrl, preset));
        },
        translateExample: async (text, language) => {
          const sourceLanguage = getLanguageDisplayName(
            language,
            langData[language] ?? (language === settings.language ? currentLangData() : null),
            settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage,
          );
          return await translateExampleSentence(text, sourceLanguage, language);
        },
        abortOnError: (error) => {
          if (classifyProviderFailure(error, settings.llmProvider).yieldsNoResult) return true;
          log.error('Flashcard repair attempt failed', error);
          return false;
        },
        onProgress: (completed, total) => {
          updateToast(toastId, {
            content: (
              <ProgressBar value={total > 0 ? Math.round((completed / total) * 100) : 100} size="sm" variant="primary" showPercent percentPosition="below" />
            ),
          });
        },
        maxRetries: MAX_REPAIR_RETRIES,
      });
    } catch (error) {
      absorbProviderFailure(error, t, settings.llmProvider);
      removeToast(toastId);
      setRepairRunning(false);
      return;
    }

    removeToast(toastId);
    setRepairRunning(false);
    await refreshRepairFindings();

    if (result.failed > 0) {
      showToast({ variant: 'warning', title: t('mlearn.Flashcards.Repair.DoneWithErrors', { count: result.succeeded, failed: result.failed }), duration: 5000 });
    } else if (result.succeeded > 0) {
      showToast({ variant: 'success', title: t('mlearn.Flashcards.Repair.Done', { count: result.succeeded }), duration: 4000 });
    }
  };

  const handleBrowseTts = (cardId: string, text: string) => {
    if (browseTtsCardId() === cardId && browseTtsPlayingField() === 'word') {
      browseTtsStop();
      setBrowseTtsCardId(null);
      return;
    }
    setBrowseTtsCardId(cardId);
    const card = getAllCards().find((candidate) => candidate.id === cardId);
    browseTtsPlay(cardId, text, card ? languageForCard(card) : settings.language, 'word');
  };

  onCleanup(() => browseTtsStop());

  const sortOptions = createMemo(() => [
    { value: 'default', label: t('mlearn.Flashcards.Browse.SortDefault') },
    { value: 'ease-asc', label: t('mlearn.Flashcards.Browse.SortEaseAsc') },
    { value: 'ease-desc', label: t('mlearn.Flashcards.Browse.SortEaseDesc') },
    { value: 'due-asc', label: t('mlearn.Flashcards.Browse.SortDueDateAsc') },
    { value: 'due-desc', label: t('mlearn.Flashcards.Browse.SortDueDateDesc') },
  ]);

  // Get flashcards from store (now it's a Record)
  const flashcards = createMemo(() => getAllCards());

  // Multi-select state. The hook keeps the selection equal to the cards that
  // still exist, so a card deleted from its own row - or by another window's
  // commit - leaves the list without leaving the count behind.
  const selection = useItemSelection(() => flashcards().map((card) => card.id));
  const selected = selection.selected;

  const filterFields = createMemo<{ fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] }>(() => {
    const languageNames: Record<string, string> = {};
    for (const [code, data] of Object.entries(langData)) {
      if (!data) continue;
      languageNames[code] = getLanguageDisplayName(code, data, settings.uiLanguage);
    }

    // The Level filter only enumerates one language's level system, so it is
    // gated on the browse being scoped to exactly one language via `eq`.
    const scopedLanguage = singleLanguageScope(filterTokens());
    let levelContext: { levelNames: Record<string, string>; languageData?: LanguageData | null } | undefined;
    if (scopedLanguage) {
      const scopedData = langData[scopedLanguage] ?? (scopedLanguage === settings.language ? currentLangData() : null);
      if (scopedData) {
        levelContext = {
          levelNames: getLevelStudyLevelNames(scopedData),
          languageData: scopedData,
        };
      }
    }

    return buildFlashcardBrowseFields(languageNames, t, levelContext);
  });

  const filterResolvers = createMemo<Record<string, FieldResolver<unknown>>>(() => {
    const resolvers: Record<string, FieldResolver<unknown>> = {};
    for (const field of filterFields().fields) {
      resolvers[field.field] = field.resolver;
    }
    return resolvers;
  });

  const filterAst = createMemo<
    | { ok: true; ast: ExprNode | null }
    | { ok: false; errors: ValidationError[] }
  >(() => {
    const tokens = filterTokens();
    if (tokens.length === 0) return { ok: true, ast: null };

    const validation = validateTokens(tokens);
    if (!validation.ok) return { ok: false, errors: validation.errors };

    try {
      return { ok: true, ast: parseTokens(tokens) };
    } catch {
      return { ok: false, errors: [{ index: -1, message: 'parse_error' }] };
    }
  });

  const filterValidation = createMemo(() => {
    const result = filterAst();
    if (result.ok) return { ok: true as const };
    return { ok: false as const, errors: result.errors };
  });

  // Filtered flashcards for browse tab
  const filteredFlashcards = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const ast = filterAst();
    const activeAst = ast.ok && ast.ast ? ast.ast : null;
    const resolvers = filterResolvers();
    let cards = flashcards();

    if (query) {
      cards = cards.filter(card => {
        const front = card.content.front?.toLowerCase() || '';
        const back = card.content.back?.toLowerCase() || '';
        const reading = card.content.reading?.toLowerCase() || '';

        return front.includes(query) || back.includes(query) || reading.includes(query);
      });
    }

    if (activeAst) {
      cards = cards.filter((card) => evaluateAst(activeAst, card, resolvers));
    }

    const sort = sortBy();
    if (sort !== 'default') {
      cards = [...cards].sort((a, b) => {
        switch (sort) {
          case 'ease-asc': return a.ease - b.ease;
          case 'ease-desc': return b.ease - a.ease;
          case 'due-asc': return a.dueDate - b.dueDate;
          case 'due-desc': return b.dueDate - a.dueDate;
          default: return 0;
        }
      });
    }

    return cards;
  });

  const suggestedCount = createMemo(() => getSuggestedFlashcardBadgeCount(getSuggestedFlashcardsSync));

  const allFilteredSelected = createMemo(() => selection.allSelected(filteredFlashcards().map((card) => card.id)));

  const toggleSelect = (id: string) => selection.toggle(id);

  const toggleSelectAllFiltered = () => {
    const ids = filteredFlashcards().map((card) => card.id);
    if (allFilteredSelected()) selection.deselect(ids);
    else selection.select(ids);
  };

  /**
   * Bulk removal of a hand-built selection. Deleting a card destroys the
   * sentences and audio it was built from and there is no undo for it, so the
   * bar asks first — the same way the single-row Delete does two buttons
   * further down. This used to fire straight from the button: selecting all
   * 449 cards in the running app and pressing Delete removed all 449 with no
   * dialog, while the row action next to it asked.
   */
  const handleBulkDelete = async () => {
    if (deletionPending()) return;
    const ids = Array.from(selected());
    if (!requiresDestructiveConfirmation(ids.length)) return;
    const generation = deletionGeneration;
    setDeletionPending(true);
    let deleted = 0;
    let refused = false;
    try {
      const confirmed = await showConfirm(buildDestructiveConfirmOptions({
        count: ids.length, titleKey: 'mlearn.Flashcards.Modals.DeleteCard.Title',
        messageKey: 'mlearn.Flashcards.Modals.DeleteCard.ConfirmMany',
      }, t));
      if (!confirmed || generation !== deletionGeneration) return;
      for (const id of ids) {
        if (generation !== deletionGeneration) return;
        if (await removeFlashcard(id, false)) deleted += 1;
        else { refused = true; break; }
      }
    } catch (error) {
      log.error('Failed to remove selected flashcards:', error);
      refused = true;
    } finally { if (generation === deletionGeneration) setDeletionPending(false); }
    if (generation !== deletionGeneration) return;
    if (deleted > 0) showToast({ message: t('mlearn.Flashcards.Browse.DeletedCount', { count: String(deleted) }), variant: 'success' });
    if (refused) showToast({ message: t('mlearn.Flashcards.Review.RemovalSaveFailed'), variant: 'error' });
  };

  const handleDeleteCard = async () => {
    const cardId = selectedCard();
    if (!cardId || deletionPending()) return;
    const generation = deletionGeneration;
    setDeletionPending(true);
    try {
      const removed = await removeFlashcard(cardId, false);
      if (generation !== deletionGeneration) return;
      if (!removed) {
        showToast({ message: t('mlearn.Flashcards.Review.RemovalSaveFailed'), variant: 'error' });
        return;
      }
      if (selectedCard() === cardId) {
        setShowDeleteConfirm(false);
        setSelectedCard(null);
      }
    } catch (error) {
      log.error('Failed to remove flashcard:', error);
      if (generation === deletionGeneration) showToast({ message: t('mlearn.Flashcards.Review.RemovalSaveFailed'), variant: 'error' });
    } finally { if (generation === deletionGeneration) setDeletionPending(false); }
  };

  const openEditModal = (card: Flashcard) => {
    setEditingCard(card);
    setShowEditModal(true);
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

  const handleEditCardCancel = () => {
    setShowEditModal(false);
    setEditingCard(null);
  };

  /** Bulk generate TTS for all flashcards (word + example fields) */
  const handleBulkTts = async () => {
    if (!isElectron() || bulkProgress()) return;

    const bridge = getBridge();
    const cards = flashcards();
    const preset = bulkAudioPreset();
    const provider = bulkAudioProvider();
    const voiceSampleId = settings.flashcardVoiceSampleId || undefined;
    const cloudApiUrl = resolveCloudApiUrl(settings);
    const cutoffDate = bulkTtsMode() === 'olderThan'
      ? new Date(bulkOlderThanDate() + 'T23:59:59').getTime()
      : 0;

    // The SAME scan the repair modal uses, asked a different question: re-roll
    // existing audio (new seed / newer than a cutoff) instead of filling gaps.
    const findings = await planFlashcardRepair(cards, {
      include: ['tts'],
      scope: 'all',
      activeLanguage: settings.language,
      autoGenerateAudio: true,
      ttsMode: bulkTtsMode(),
      olderThanCutoff: cutoffDate,
    }, ttsScanDeps(bridge, languageDataForCard));

    if (findings.length === 0) {
      showToast({ message: t('mlearn.Flashcards.Bulk.TtsAllDone'), variant: 'success' });
      return;
    }

    // Same one-click-to-discard shape as the Examples button, so it asks
    // through the same owner. What is being thrown away is named per subject,
    // so the prompt cannot claim sentences are at stake when they are not.
    const plan = planBulkGeneration({ subject: 'tts', mode: bulkTtsMode(), cards }, t);
    if (plan.requiresConfirmation && plan.confirmOptions) {
      if (!await showConfirm(plan.confirmOptions)) return;
    }

    const startTime = Date.now();
    setBulkProgress({ current: 0, total: findings.length, label: t('mlearn.Flashcards.Bulk.TtsProgress'), startTime });

    if (provider !== 'cloud') {
      const allowed = await requestAccess('tts');
      if (!allowed) {
        setBulkProgress(null);
        return;
      }
    }

    const result = await runFlashcardRepair(findings, {
      activeLanguage: settings.language,
      getLanguageData: (language) => langData[language] ?? (language === settings.language ? currentLangData() : null),
      settings,
      applyContent: () => {},
      generateTts: async (job) => Boolean(provider === 'cloud'
        ? await withCloudAuth((cloudToken) => bridge.flashcards.generateFlashcardTts(
          job.cardId, job.text, job.language, job.field, provider, voiceSampleId, cloudToken, cloudApiUrl, preset))
        : await bridge.flashcards.generateFlashcardTts(
          job.cardId, job.text, job.language, job.field, provider, voiceSampleId, undefined, cloudApiUrl, preset)),
      abortOnError: (error) => {
        if (absorbProviderFailure(error, t, settings.llmProvider)) return true;
        log.error('Flashcard audio generation failed', error);
        return false;
      },
      onProgress: (completed, total) => {
        setBulkProgress({ current: completed, total, label: t('mlearn.Flashcards.Bulk.TtsProgress'), startTime });
      },
    });

    setBulkProgress(null);
    if (result.failed > 0) {
      showToast({ variant: 'warning', title: t('mlearn.Flashcards.Bulk.TtsDoneWithErrors', { count: result.succeeded, failed: result.failed }), duration: 5000 });
    } else {
      showToast({ variant: 'success', title: t('mlearn.Flashcards.Bulk.TtsDone', { count: result.succeeded }), duration: 4000 });
    }
  };

  const handleBulkExamples = async () => {
    if (bulkProgress()) return;

    const cards = flashcards();

    // The SAME scan as Repair and bulk audio, asked a different question:
    // re-roll the examples that already exist (or fill the empty ones).
    const findings = await planFlashcardRepair(cards, {
      include: ['example'],
      scope: 'all',
      activeLanguage: settings.language,
      exampleMode: bulkExampleMode() === 'replaceAll' ? 'replaceAll' : 'onlyEmpty',
    }, ttsScanDeps(getBridge(), languageDataForCard));

    if (findings.length === 0) {
      showToast({ message: t('mlearn.Flashcards.Bulk.ExamplesAllDone'), variant: 'success' });
      return;
    }

    // "Regenerate all" rewrites examples that are already there, and an
    // example is authored content: the card editor exposes it as editable rich
    // text and the store remembers which fields the learner touched. In a real
    // profile this button was one click away from overwriting 448 of 449
    // cards, 9 of which carried a hand-edited meaning, with no prompt and no
    // count on screen. The decision and its wording live in one owner so this
    // button, the TTS button and any future bulk writer cannot each invent
    // their own.
    const plan = planBulkGeneration({
      subject: 'examples',
      mode: bulkExampleMode(),
      cards: cards.filter((card) => findings.some((finding) => finding.card.id === card.id)),
    }, t);
    if (plan.requiresConfirmation && plan.confirmOptions) {
      if (!await showConfirm(plan.confirmOptions)) return;
    }

    const startTime = Date.now();
    setBulkProgress({ current: 0, total: findings.length, label: t('mlearn.Flashcards.Bulk.ExamplesProgress'), startTime });

    const result = await runFlashcardRepair(findings, {
      activeLanguage: settings.language,
      getLanguageData: (language) => langData[language] ?? (language === settings.language ? currentLangData() : null),
      settings,
      applyContent: (cardId, content) => updateFlashcardContent(cardId, content),
      generateTts: async () => false,
      generateExamples: generateRepairExamples,
      onProgress: (completed, total) => {
        setBulkProgress({ current: completed, total, label: t('mlearn.Flashcards.Bulk.ExamplesProgress'), startTime });
      },
    });

    setBulkProgress(null);
    if (result.failed > 0) {
      showToast({ message: t('mlearn.Flashcards.Bulk.ExamplesDoneWithErrors', { count: result.succeeded, failed: result.failed }), variant: 'warning' });
    } else {
      showToast({ message: t('mlearn.Flashcards.Bulk.ExamplesDone', { count: result.succeeded }), variant: 'success' });
    }
  };

  // Get state badge variant
  const getStateBadge = (card: Flashcard) => {
    switch (card.state) {
      case 'new': return { label: t('mlearn.Flashcards.State.New'), variant: 'primary' as const };
      case 'learning': return { label: t('mlearn.Flashcards.State.Learning'), variant: 'warning' as const };
      case 'relearning': return { label: t('mlearn.Flashcards.State.Relearning'), variant: 'error' as const };
      case 'review': return { label: t('mlearn.Flashcards.State.Review'), variant: 'success' as const };
    }
  };

  // TTS provider options for the Generate tab select
  const ttsProviderOptions = createMemo(() => [
    { value: 'kokoro', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Kokoro') },
    { value: 'qwen3', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Qwen3') },
    { value: 'cloud', label: t('mlearn.AI.Settings.FlashcardTTS.Provider.Cloud') },
  ]);

  // One vocabulary of modes, narrowed to the ones a subject can actually
  // honour. The label is shared so "replace everything" cannot come to mean
  // two different things in the two sections.
  const bulkModeLabel = (mode: BulkGenerationMode): string => {
    if (mode === 'onlyEmpty') return t('mlearn.Flashcards.Bulk.ModeOnlyEmpty');
    if (mode === 'replaceAll') return t('mlearn.Flashcards.Bulk.ModeReplaceAll');
    return t('mlearn.Flashcards.Bulk.ModeOlderThan');
  };
  const bulkModeOptionsFor = <M extends BulkGenerationMode>(modes: readonly M[]) =>
    modes.map((mode) => ({ value: mode as string, label: bulkModeLabel(mode) }));
  const ttsBulkModeOptions = createMemo(() =>
    bulkModeOptionsFor(['onlyEmpty', 'replaceAll', 'olderThan'] as const));
  const exampleBulkModeOptions = createMemo(() =>
    bulkModeOptionsFor(['onlyEmpty', 'replaceAll'] as const));

  // Review and card management are one workspace, backed by the same card owner.
  const tabs = createMemo<TabItem[]>(() => [
    ...(props.workspace === 'flashcards' ? [{
      id: 'review',
      label: t('mlearn.Flashcards.UI.Tabs.Review'),
      icon: <BookIcon size={16} />,
    }] : []),
    { 
      id: 'browse', 
      label: t('mlearn.Flashcards.UI.Tabs.Browse'),
      icon: <BookIcon size={16} />
    },
    { 
      id: 'generate', 
      label: t('mlearn.Flashcards.UI.Tabs.Generate'),
      icon: <SparklesIcon size={16} />
    },
    { 
      id: 'suggested', 
      label: t('mlearn.Flashcards.UI.Tabs.Suggested'),
      icon: <PlusIcon size={16} />,
      badge: isKnowledgeReady() && suggestedCount() > 0 ? suggestedCount() : undefined,
    },
  ]);

  const activeTabLabel = createMemo(() => (
    tabs().find((tab) => tab.id === activeTab())?.label ?? t('mlearn.Flashcards.UI.Title')
  ));

  const handleTabChange = (id: string) => {
    if (id === 'review') {
      // Returning from Browse resumes the current durable position. It must not
      // replay the external Start/Resume command that originally opened this window.
      setReviewContext({ returnTo: props.launchContext?.returnTo, sourceContext: props.launchContext?.sourceContext });
    }
    setActiveTab(admittedTab(id as TabId));
    setIsMobileSidebarOpen(false);
  };

  return (
    <div class="flashcards-window">
      <div class="flashcards-layout">
        {/* Left Sidebar */}
        <Show when={props.workspace !== 'review'}>
        <ResponsiveSidebar
          id="flashcards-navigation"
          label={t('mlearn.Flashcards.UI.Title')}
          title={activeTabLabel()}
          open={isMobileSidebarOpen()}
          onOpenChange={setIsMobileSidebarOpen}
          class="flashcards-sidebar"
        >
          <div class="flashcards-sidebar-header">
            <h1 class="flashcards-title">{t(props.workspace === 'flashcards' ? 'mlearn.Flashcards.UI.Title' : 'mlearn.Product.SavedMaterial')}</h1>
          </div>
          
          <nav id="flashcards-navigation" class="flashcards-nav">
            <TabContainer
              tabs={tabs()}
              activeTab={activeTab()}
              onTabChange={handleTabChange}
              orientation="vertical"
              variant="pills"
              size="md"
              idBase="flashcards-tabs"
            />
          </nav>
          
          <div class="flashcards-sidebar-actions">
            <Show when={props.workspace === 'flashcards'}>
              <Button size="sm" variant="ghost" onClick={() => getBridge().window.openWindow({ type: 'study', context: { applicationPath: '/evaluate', returnTo: 'flashcards' } })}>
                {t('mlearn.Product.Evaluate')}
              </Button>
            </Show>
            <Show when={repairFindings().length > 0}>
              <Button variant="warning" size="sm" onClick={openRepairModal} disabled={repairRunning()}>{t('mlearn.Flashcards.Repair.Title')}</Button>
            </Show>
            <Button
              size="sm" 
              variant="secondary" 
              onClick={() => setShowSyncModal(true)}
              class="flashcards-sidebar-btn"
            >
              {t('mlearn.Flashcards.UI.Sync')}
            </Button>
            <Button
              size="sm" 
              variant="primary"
              onClick={() => setShowAddModal(true)}
              class="flashcards-sidebar-btn"
            >
              {t('mlearn.Flashcards.UI.AddCard')}
            </Button>
          </div>
        </ResponsiveSidebar>
        </Show>

        {/* Main Content */}
        <main class="flashcards-main">
          <KnowledgeGate>
          <Show when={activeTab() === 'review'}>
            <section class="flashcards-review-panel" role="tabpanel" id="flashcards-tabs-panel-review" aria-label={t('mlearn.Flashcards.UI.Tabs.Review')}>
              <Show when={!reviewContextRefused()} fallback={<div role="alert"><p>{t('mlearn.WordSync.ProjectionUnavailable')}</p><Button onClick={props.onClose}>{t('mlearn.Global.Back')}</Button></div>}>
                <ReviewWorkspace launchContext={reviewContext()} onReturn={props.onClose} autoEnter={props.workspace === 'flashcards'}>
                  <FlashcardReview encounterLimit={reviewSessionRequest()?.encounterLimit}
                    resumeSessionId={reviewContext()?.intent === 'resume' && typeof reviewContext()?.sessionId === 'string' ? reviewContext()!.sessionId as string : undefined}
                    sessionRequestId={reviewSessionRequest()?.requestId}
                    initialCardId={reviewSessionRequest()?.initialCardId}
                    handoff={reviewSessionRequest()?.decision} onClose={props.onClose} />
                </ReviewWorkspace>
              </Show>
            </section>
          </Show>

          {/* Browse Tab */}
          <div role="tabpanel" id="flashcards-tabs-panel-browse" aria-labelledby="flashcards-tabs-tab-browse" hidden={activeTab() !== 'browse'}>
          <Show when={activeTab() === 'browse'}>
            {(() => {
              let browseRef: HTMLDivElement | undefined;
              return (
                <div class="flashcards-browse" ref={(el) => { browseRef = el; }}>
                  <CollapsibleStickyHeader getScrollContainer={() => browseRef} class="flashcards-browse-header">
                    <div class="flashcards-browse-controls">
                      <Input
                        placeholder={t('mlearn.Flashcards.Browse.SearchPlaceholder')}
                        value={searchQuery()}
                        onInput={(e) => setSearchQuery(e.currentTarget.value)}
                        leftIcon={<SearchIcon size={16} />}
                        size="md"
                        class="flashcards-search-input"
                      />
                      <Select
                        options={sortOptions()}
                        value={sortBy()}
                        onChange={(e) => setSortBy(e.currentTarget.value)}
                        class="flashcards-sort-select"
                      />
                      <Show when={flashcards().length > 0}>
                        <span class="flashcards-count">
                          {t('mlearn.Flashcards.Browse.ShowingCount', {
                            count: filteredFlashcards().length,
                            total: flashcards().length
                          })}
                        </span>
                      </Show>
                    </div>
                    <details class="flashcards-advanced-filters">
                      <summary>{t('mlearn.WordDbEditor.AdvancedFilters')}</summary>
                    <FilterBuilder
                      fields={filterFields().fields}
                      paletteItems={filterFields().paletteItems}
                      tokens={filterTokens()}
                      onChange={setFilterTokens}
                      evaluation={filterValidation()}
                    />
                    </details>
                    <Show when={flashcards().length > 0}>
                      <div class="flashcards-browse-bulkbar">
                        <div class="flashcards-browse-bulkbar-left">
                          <Button size="sm" variant="secondary" onClick={toggleSelectAllFiltered}>
                            {allFilteredSelected()
                              ? t('mlearn.Flashcards.Browse.DeselectAll')
                              : t('mlearn.Flashcards.Browse.SelectAll')}
                          </Button>
                          <span class="flashcards-browse-selected-count">
                            {t('mlearn.Flashcards.Browse.SelectedCount', { count: String(selected().size) })}
                          </span>
                        </div>
                        <div class="flashcards-browse-bulkbar-right">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={selected().size === 0 || deletionPending()}
                            onClick={handleBulkDelete}
                            icon={<TrashIcon size={14} />}
                            iconPosition="left"
                          >
                            {t('mlearn.Flashcards.Browse.DeleteSelected')}
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </CollapsibleStickyHeader>

              <Show
                when={flashcards().length > 0}
                fallback={
                  <EmptyState
                    icon={<BookIcon size={32} />}
                    title={t('mlearn.Flashcards.EmptyState.NoCardsTitle')}
                    description={t('mlearn.Flashcards.EmptyState.NoCardsDescription')}
                    size="md"
                    action={{
                      label: t('mlearn.Flashcards.UI.AddCard'),
                      onClick: () => setShowAddModal(true),
                      variant: 'primary',
                    }}
                  />
                }
              >
                <Show
                  when={filteredFlashcards().length > 0}
                  fallback={
                    <EmptyState
                      icon={<SearchIcon size={32} />}
                      title={t('mlearn.Flashcards.Browse.NoWordsFound')}
                      size="sm"
                    />
                  }
                >
                  <div class="flashcards-grid">
                    <For each={filteredFlashcards()}>
                      {(card) => {
                        const stateBadge = getStateBadge(card);
                        const isSelected = () => selected().has(card.id);
                        return (
                          <SelectableCard
                            selected={isSelected()}
                            onClick={() => toggleSelect(card.id)}
                            title={
                              <FlashcardWordTitle content={card.content} language={card.language} />
                            }
                            headerActions={
                              <Button buttonType="icon"
                                icon="volume"
                                size="sm"
                                variant="ghost"
                                class="flashcard-tts-btn"
                                classList={{ 'flashcard-tts-btn--active': browseTtsCardId() === card.id && browseTtsPlayingField() === 'word' }}
                                onClick={(e) => { e.stopPropagation(); handleBrowseTts(card.id, card.content.front); }}
                                disabled={browseTtsGenerating()}
                                title={t('mlearn.Flashcards.Card.PlayWord')}
                              />
                            }
                            class="flashcards-browse-card"
                          >
                            <p class="flashcard-translation">
                              {card.content.back}
                            </p>
                            <div class="flashcard-footer">
                              <div class="flashcard-state">
                                <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>
                                <Show when={card.state === 'review'}>
                                  <Badge>{intervalToString(card.interval)}</Badge>
                                </Show>
                              </div>
                              <div class="flashcard-actions">
                                <FlashcardInspectButton language={languageForCard(card)} surface={card.content.front} />
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={(e) => { e.stopPropagation(); openEditModal(card); }}
                                >
                                  {t('mlearn.Global.Edit')}
                                </Button>
                                <Button
                                  variant="danger"
                                  size="xs"
                                  disabled={deletionPending()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCard(card.id);
                                    setShowDeleteConfirm(true);
                                  }}
                                >
                                  {t('mlearn.Global.Delete')}
                                </Button>
                              </div>
                            </div>
                          </SelectableCard>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </Show>
              </div>
              );
            })()}
          </Show>
          </div>

          {/* Generate Tab */}
          <div role="tabpanel" id="flashcards-tabs-panel-generate" aria-labelledby="flashcards-tabs-tab-generate" hidden={activeTab() !== 'generate'}>
          <Show when={activeTab() === 'generate'}>
            <div class="flashcards-generate">
              <h2 class="flashcards-generate-title">{t('mlearn.Flashcards.UI.Tabs.Generate')}</h2>
              <p class="flashcards-generate-description">{t('mlearn.Flashcards.Bulk.GenerateDescription')}</p>

              <div class="flashcards-generate-actions">
                <Show when={isElectron()}>
                  <div class="flashcards-generate-section">
                    <div class="flashcards-generate-section-header">
                      <MicrophoneIcon size={18} />
                      <h3>{t('mlearn.Flashcards.Bulk.TtsButton')}</h3>
                    </div>
                    <p class="flashcards-generate-section-desc">{t('mlearn.Flashcards.Bulk.TtsTooltip')}</p>

                    <div class="flashcards-generate-option">
                      <label class="flashcards-generate-label" for="flashcards-generate-tts-mode">{t('mlearn.Flashcards.Bulk.ModeChoice')}</label>
                      <Select
                        id="flashcards-generate-tts-mode"
                        options={ttsBulkModeOptions()}
                        value={bulkTtsMode()}
                        onChange={(e) => setBulkTtsMode(e.currentTarget.value as BulkGenerationModeFor<'tts'>)}
                        class="flashcards-generate-select"
                      />
                    </div>

                    <Show when={bulkTtsMode() === 'olderThan'}>
                      <div class="flashcards-generate-option">
                        <label class="flashcards-generate-label" for="flashcards-generate-tts-older-than">{t('mlearn.Flashcards.Bulk.OlderThanDate')}</label>
                        <Input
                          id="flashcards-generate-tts-older-than"
                          type="date"
                          value={bulkOlderThanDate()}
                          onInput={(e) => setBulkOlderThanDate(e.currentTarget.value)}
                          class="flashcards-generate-select"
                        />
                      </div>
                    </Show>
                    <div class="flashcards-generate-option">
                      <label class="flashcards-generate-label" for="flashcards-generate-audio-preset">{t('mlearn.AI.Settings.FlashcardTTS.Preset.Label')}</label>
                      <FlashcardAudioPresetSelect id="flashcards-generate-audio-preset" value={bulkAudioPreset()} onChange={setBulkAudioPreset} />
                    </div>
                    <p class="flashcards-generate-section-desc">{t('mlearn.AI.Settings.FlashcardTTS.Preset.Description')}</p>

                    <div class="flashcards-generate-option">
                      <label class="flashcards-generate-label" for="flashcards-generate-tts-provider">{t('mlearn.AI.Settings.FlashcardTTS.Provider.Label')}</label>
                      <Select
                        id="flashcards-generate-tts-provider"
                        options={ttsProviderOptions()}
                        value={bulkAudioProvider()}
                        disabled={bulkAudioPreset() === 'fast'}
                        onChange={(e) => setBulkTtsProvider(e.currentTarget.value as TTSProvider)}
                        class="flashcards-generate-select"
                      />
                    </div>

                    <Show when={bulkAudioProvider() !== 'kokoro' && bulkAudioProvider() !== 'cloud'}>
                      <div class="flashcards-generate-option">
                        <span class="flashcards-generate-label">{t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Label')}</span>
                        <VoiceSamplePicker
                          value={settings.flashcardVoiceSampleId}
                          onChange={(id) => updateSettings({ flashcardVoiceSampleId: id })}
                          selectClass="flashcards-generate-select"
                          ttsProvider={bulkAudioProvider()}
                        />
                      </div>
                    </Show>

                    <Button
                      size="md"
                      variant="primary"
                      onClick={handleBulkTts}
                      class="flashcards-generate-btn"
                      disabled={!!bulkProgress()}
                      icon={<MicrophoneIcon size={16} />}
                    >
                      {t('mlearn.Flashcards.Bulk.TtsButton')}
                    </Button>
                  </div>
                </Show>

                <div class="flashcards-generate-section">
                  <div class="flashcards-generate-section-header">
                    <SparklesIcon size={18} />
                    <h3>{t('mlearn.Flashcards.Bulk.ExamplesButton')}</h3>
                  </div>
                  <p class="flashcards-generate-section-desc">
                    <Show when={bulkExampleMode() === 'replaceAll'} fallback={t('mlearn.Flashcards.Bulk.ExamplesTooltip')}>
                      {t('mlearn.Flashcards.Bulk.ExamplesReplaceAllTooltip')}
                    </Show>
                  </p>

                  <div class="flashcards-generate-option">
                    <label class="flashcards-generate-label" for="flashcards-generate-examples-mode">{t('mlearn.Flashcards.Bulk.ModeChoice')}</label>
                    <Select
                      id="flashcards-generate-examples-mode"
                      options={exampleBulkModeOptions()}
                      value={bulkExampleMode()}
                      onChange={(e) => setBulkExampleMode(e.currentTarget.value as BulkGenerationModeFor<'examples'>)}
                      class="flashcards-generate-select"
                    />
                  </div>

                  <Button
                    size="md"
                    variant="primary"
                    onClick={handleBulkExamples}
                    class="flashcards-generate-btn"
                    disabled={!!bulkProgress()}
                    icon={<SparklesIcon size={16} />}
                  >
                    {t('mlearn.Flashcards.Bulk.ExamplesButton')}
                  </Button>
                </div>
              </div>

              <Show when={bulkProgress()}>
                {(() => {
                  const p = bulkProgress()!;
                  const elapsed = Date.now() - p.startTime;
                  const avgMs = p.current > 0 ? elapsed / p.current : 0;
                  const remaining = p.current > 0 ? Math.round(avgMs * (p.total - p.current)) : 0;
                  const etaText = p.current > 0 ? formatEta(remaining) : '';
                  return (
                    <div class="flashcards-generate-progress">
                      <span class="flashcards-generate-progress-label">{p.label}</span>
                      <ProgressBar
                        value={Math.round((p.current / p.total) * 100)}
                        size="md"
                        variant="default"
                      />
                      <div class="flashcards-generate-progress-footer">
                        <span class="flashcards-generate-progress-count">
                          {p.current} / {p.total}
                        </span>
                        <Show when={etaText}>
                          <span class="flashcards-generate-progress-eta">
                            {t('mlearn.Flashcards.Bulk.EtaRemaining', { eta: etaText })}
                          </span>
                        </Show>
                      </div>
                    </div>
                  );
                })()}
              </Show>
            </div>
          </Show>
          </div>

          {/* Suggested Tab */}
          <div role="tabpanel" id="flashcards-tabs-panel-suggested" aria-labelledby="flashcards-tabs-tab-suggested" hidden={activeTab() !== 'suggested'}>
          <Show when={activeTab() === 'suggested'}>
            <FlashcardsSuggested />
          </Show>
          </div>

          </KnowledgeGate>
        </main>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm()}
        closeOnEscape={!deletionPending()}
        closeOnOverlay={!deletionPending()}
        showCloseButton={!deletionPending()}
        onClose={() => { if (!deletionPending()) setShowDeleteConfirm(false); }}
        title={t('mlearn.Flashcards.Modals.DeleteCard.Title')}
        size="sm"
        footer={
          <>
            <Button disabled={deletionPending()} onClick={() => setShowDeleteConfirm(false)}>{t('mlearn.Global.Cancel')}</Button>
            <Button variant="danger" disabled={deletionPending()} onClick={handleDeleteCard}>{t('mlearn.Global.Delete')}</Button>
          </>
        }
      >
        <p>{t(deletionPending() ? 'mlearn.Flashcards.Review.SavingRemoval' : 'mlearn.Flashcards.Modals.DeleteCard.Confirm')}</p>
      </Modal>

      <FlashcardCreateModal isOpen={showAddModal()} onClose={() => setShowAddModal(false)} onAdd={addFlashcard} />

      {/* Edit card modal - uses shared FlashcardEditModal */}
      <FlashcardEditModal
        isOpen={showEditModal()}
        flashcard={editingCard()}
        onClose={handleEditCardCancel}
        onSave={handleEditCardSave}
      />

      {/* Sync Modal */}
      <FlashcardSyncModal
        isOpen={showSyncModal()}
        onClose={() => setShowSyncModal(false)}
      />

      {/* Repair Modal */}
      <Modal
        isOpen={showRepairModal()}
        onClose={() => setShowRepairModal(false)}
        title={t('mlearn.Flashcards.Repair.Title')}
        size="sm"
        footer={
          <>
            <Button onClick={() => setShowRepairModal(false)}>{t('mlearn.Global.Close')}</Button>
            <Button variant="primary" onClick={handleRepair} disabled={selectedRepairCount() === 0 || repairRunning()}>{t('mlearn.Flashcards.Repair.RepairButton')}</Button>
          </>
        }
      >
        <div class="flashcard-repair-body">
          <FlashcardRepairOptions
            counts={repairCounts()}
            selection={repairSelection()}
            onChange={(aspect, enabled) => setRepairSelection((previous) => ({ ...previous, [aspect]: enabled }))}
          />
          <Show when={hasSelectedRepairAudio()}>
            <div class="flashcard-repair-preset">
              <label for="flashcard-repair-audio-preset">{t('mlearn.AI.Settings.FlashcardTTS.Preset.Label')}</label>
              <FlashcardAudioPresetSelect id="flashcard-repair-audio-preset" value={repairAudioPreset()} onChange={setRepairAudioPreset} />
              <p>{t('mlearn.AI.Settings.FlashcardTTS.Preset.Description')}</p>
            </div>
            <Show when={repairAudioProvider() === 'qwen3'}>
              <VoiceSamplePicker value={settings.flashcardVoiceSampleId} onChange={(id) => updateSettings({ flashcardVoiceSampleId: id })} ttsProvider="qwen3" />
            </Show>
          </Show>
          <Show when={hasSelectedRepairAudio() && repairAudioProvider() === 'cloud' && settings.cloudAuthStatus !== 'signed-in'}>
            <p role="alert">{t('mlearn.CardEditor.NoCloudAuth')}</p>
          </Show>
        </div>
      </Modal>
      <ConfirmDialogElement />
    </div>
  );
};
