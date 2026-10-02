import { useKnowledgeProjections } from '../../hooks/useKnowledgeProjections';
import { projectedWordStatus } from '../../../shared/graph/targets';
/**
 * Word Database Editor Window
 * Allows editing word knowledge status, creating flashcards, and searching words
 * Ported from adjustWordsByLevel in stats.js
 */

import { Component, createSignal, For, Show, onMount, createEffect, createMemo, createResource, on, onCleanup } from 'solid-js';
import { createVirtualizer } from '../../hooks/useVirtualizer';
import { WindowWrapper, useLanguage, useFlashcards, useLocalization, useSettings } from '../../context';
import { requiresDestructiveConfirmation, buildDestructiveConfirmOptions } from '../flashcards/bulkDestructiveConfirm';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import { loadDictionaryUniverse } from '../../services/dictionaryUniverse';
import './WordDbEditorLayout.css';
import { SearchBar, EntriesHeader, WordEntryRow, EditTranslationDialog, AnkiCardPreviewModal, type WordEntry, type TranslationOverride, type AnkiExportState, type WordDbBrowseMode } from './components';
import { Button, KnowledgeLoadError, ModalLoadingOverlay, SkeletonRows, CollapsibleStickyHeader, buildEmptyPreset, buildWordDbEditorFields, useConfirmDialog, validateTokens, evaluateAst, parseTokens, type FieldResolver, type FilterToken, type ValidationError } from '../../components/common';
import { FlashcardEditModal } from '../../components/flashcard';
import { useAnki } from '../../hooks/useAnki';
import { getWordFormCandidates } from '../../utils/wordForms';
import { isAnkiCacheFetched, refreshAnkiWordsCache, findAnkiWordMatchInCache } from '../../services/ankiWordsCache';
import { buildWordHoverFlashcardContent, wordStatusToNumeric } from '../../components/subtitle/wordHoverHelpers';
import { useTokenizer, getCachedTranslation, fetchTranslation } from '../../hooks/useTranslation';
import { useDictionaryTargetLanguage } from '../../hooks/useDictionaryTargetLanguage';
import { getLogger } from '../../../shared/utils/logger';
import { showToast } from '../../components/common/Feedback/Toast';
import { reportCaptureFailure } from '../../services/wordCaptureFailure';
import { getLearningLanguageLevelForLanguage } from '../../../shared/languageFeatures';
import { sortByStudyScope } from './studyOrder';
import { queryLanguageKeys, wordEventsVersion } from '../../services/knowledgeEvents';

const log = getLogger("renderer.wordDbEditor.app");

export const WordDbEditorContent: Component = () => {
  const { getWordFrequency, currentLangData, getFreqLevelNames, getCanonicalForm, getWordVariants, getReadingVariants } = useLanguage();
  const { addFlashcard, removeFlashcard, getCardByWord, getCardByWordSync, updateFlashcardContent, updateFlashcard, isLoading: flashcardsLoading, getIgnoredWordsSync, unignoreWordForLanguage, getComprehensiveWordStatusWithSourceSync, store: flashcardStore } = useFlashcards();
  const { t } = useLocalization();
  const { showConfirm, ConfirmDialogElement } = useConfirmDialog();
  const { settings } = useSettings();
  const dictionaryTargetLanguage = useDictionaryTargetLanguage();
  const { tokenize } = useTokenizer({ language: settings.language, languageData: currentLangData });
  const wordLookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };
  const anki = useAnki();
  const [searchQuery, setSearchQuery] = createSignal('');
  const [entries, setEntries] = createSignal<WordEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = createSignal<WordEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [loadProgress, setLoadProgress] = createSignal(0);
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [dictionaryUnavailable, setDictionaryUnavailable] = createSignal(false);
  let loadGeneration = 0;
  onCleanup(() => { loadGeneration++; });
  const [filterTokens, setFilterTokens] = createSignal<FilterToken[]>(buildEmptyPreset());
  const [browseMode, setBrowseMode] = createSignal<WordDbBrowseMode>('all');
  const [showManagement, setShowManagement] = createSignal(false);
  const [sortKey, setSortKey] = createSignal<string>('study');
  const [sortDir, setSortDir] = createSignal<1 | -1>(1);
  const wordCollator = createMemo(() => {
    const options = { usage: 'sort' as const, sensitivity: 'base' as const, numeric: true };
    try { return new Intl.Collator(settings.language, options); }
    catch { return new Intl.Collator(undefined, options); }
  });
  const needsKnowledgeQuery = () => sortKey() === 'status' || filterTokens().some(token => token.kind === 'operand' && token.field === 'status');
  const matchesSearch = (entry: WordEntry): boolean => {
    const query = searchQuery().toLowerCase().trim();
    return !query || entry.word.toLowerCase().includes(query) || entry.translation.toLowerCase().includes(query)
      || entry.reading.toLowerCase().includes(query) || !!entry.alternateReadings?.some(reading => reading.toLowerCase().includes(query));
  };
  const [journalKeys, { refetch: retryJournalKeys }] = createResource(
    () => needsKnowledgeQuery() ? { language: settings.language, version: wordEventsVersion() } : undefined,
    async (source: { language: string; version: number }) => await queryLanguageKeys(source.language),
  );
  const evidenceKeys = createMemo(() => {
    const keys = new Set(journalKeys.state === 'ready' ? journalKeys() ?? [] : []);
    for (const key of Object.keys(flashcardStore?.wordKnowledge ?? {})) keys.add(key);
    return [...keys];
  });
  // Ordinary browsing projects only visible rows through WordStatusPill.
  // An explicit status query selects graph-linked evidence before fan-out.
  const projected = useKnowledgeProjections(() => needsKnowledgeQuery() && journalKeys.state === 'ready'
    ? { language: settings.language, surfaces: (browseMode() === 'ignored' ? ignoredEntries() : entries()).filter(matchesSearch).map(entry => entry.word), evidenceKeys: evidenceKeys() }
    : undefined);
  const knowledgeQueryReady = () => !needsKnowledgeQuery() || (journalKeys.state === 'ready' && projected.ready());
  const [isInitialized, setIsInitialized] = createSignal(false);
  // Track if we've already loaded words (prevent re-loading on every frequency change)
  const [hasLoadedWords, setHasLoadedWords] = createSignal(false);
  const ankiEnabled = createMemo(() => settings.use_anki);

  const [pendingCardAdds, setPendingCardAdds] = createSignal<ReadonlySet<string>>(new Set());
  const pendingCardRemovals = new Map<string, symbol>();
  let removalDisposed = false;
  let removalGeneration = 0;
  onCleanup(() => { removalDisposed = true; removalGeneration++; });
  createEffect(on(() => settings.language, () => {
    removalGeneration++;
    pendingCardRemovals.clear();
  }, { defer: true }));
  const [editDialogOpen, setEditDialogOpen] = createSignal(false);
  const [editingEntry, setEditingEntry] = createSignal<WordEntry | null>(null);

  const [ankiExportStates, setAnkiExportStates] = createSignal<Record<string, AnkiExportState>>({});
  const ankiCacheOptions = createMemo(() => ({
    language: settings.language,
    languageData: currentLangData(),
  }));

  // Anki card preview state
  const [ankiPreviewOpen, setAnkiPreviewOpen] = createSignal(false);
  const [ankiPreviewEntry, setAnkiPreviewEntry] = createSignal<WordEntry | null>(null);

  // Flashcard edit modal state
  const [editFlashcardOpen, setEditFlashcardOpen] = createSignal(false);
  const [editingFlashcard, setEditingFlashcard] = createSignal<Flashcard | null>(null);

  // Level names come from the active language metadata.
  const getLevelNames = (): Record<number, string> => {
    const langLevelNames = getFreqLevelNames();
    const result: Record<number, string> = {};
    
    // Add language-specific level names
    for (const [key, value] of Object.entries(langLevelNames)) {
      result[Number(key)] = value;
    }
    
    return result;
  };

  const liveEntryResolver = (read: (entry: WordEntry) => unknown): FieldResolver<unknown> => ({
    read: (record) => read(record as WordEntry),
    valueLabel: (value) => value,
  });

  const filterContext = createMemo(() => buildWordDbEditorFields(getLevelNames(), t, currentLangData(), {
    status: liveEntryResolver((entry) => wordStatusToNumeric(projectedWordStatus(projected.projections().get(entry.word)).status)),
    source: liveEntryResolver((entry) => getComprehensiveWordStatusWithSourceSync(entry.word, settings.language).source),
  }));

  const filterAst = createMemo<
    | { ok: true; ast: ReturnType<typeof parseTokens> | null }
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

  const filterResolvers = createMemo(() => {
    const resolvers: Record<string, FieldResolver<unknown>> = {};
    for (const field of filterContext().fields) {
      resolvers[field.field] = field.resolver;
    }
    return resolvers;
  });

  // Load words from storage on mount
  onMount(async () => {
    const onWindowFocus = () => {
      if (ankiEnabled() && !isAnkiCacheFetched(ankiCacheOptions())) {
        void refreshAnkiWordsCache(ankiCacheOptions());
      }
    };
    window.addEventListener('focus', onWindowFocus);
    onCleanup(() => window.removeEventListener('focus', onWindowFocus));

    setIsInitialized(true);
  });

  createEffect(on(() => settings.language, () => {
    loadGeneration++;
    setEntries([]);
    setFilteredEntries([]);
    setHasLoadedWords(false);
    setIsLoading(false);
    setLoadFailed(false);
    setDictionaryUnavailable(false);
  }));

  createEffect(() => {
    getWordFrequency();
    if (!isInitialized() || flashcardsLoading() || hasLoadedWords() || isLoading() || loadFailed()) return;
    void loadAllWords();
  });

  const buildFilteredEntries = (sourceEntries: WordEntry[]): WordEntry[] => {
    if (!knowledgeQueryReady()) return [];
    const ast = filterAst();
    const resolvers = filterResolvers();
    const filtered = sourceEntries.filter(entry => matchesSearch(entry) && (!ast.ok || !ast.ast || evaluateAst(ast.ast, entry, resolvers)));
    const wordCategory = (entry: WordEntry): number => {
      const headword = entry.word.trim();
      const firstCharacter = Array.from(headword)[0];
      if (!firstCharacter) return 3;
      if (/\p{L}/u.test(firstCharacter)
        && (!/\p{Lm}/u.test(firstCharacter) || /[\p{Lu}\p{Ll}\p{Lt}\p{Lo}]/u.test(headword.slice(firstCharacter.length)))) return 0;
      return /\p{N}/u.test(firstCharacter) ? 1 : 2;
    };
    const compareWords = (left: WordEntry, right: WordEntry): number =>
      wordCategory(left) - wordCategory(right) || wordCollator().compare(left.word, right.word);
    if (sortKey() === 'study' && browseMode() === 'all') {
      return sortByStudyScope(
        filtered,
        getLearningLanguageLevelForLanguage(settings, settings.language),
        currentLangData(),
        compareWords,
      );
    }
    // A package's dictionary can contain punctuation and empty headwords.
    // Keep them searchable, but begin ordinary browsing with actual words.
    if (sortKey() === 'word' && sortDir() === 1) {
      const words: WordEntry[] = [];
      const numbers: WordEntry[] = [];
      const symbols: WordEntry[] = [];
      const empty: WordEntry[] = [];
      for (const entry of filtered) {
        const headword = entry.word.trim();
        const firstCharacter = Array.from(headword)[0];
        if (!firstCharacter) empty.push(entry);
        else if (/\p{L}/u.test(firstCharacter)
          && (!/\p{Lm}/u.test(firstCharacter) || /[\p{Lu}\p{Ll}\p{Lt}\p{Lo}]/u.test(headword.slice(firstCharacter.length)))) words.push(entry);
        else if (/\p{N}/u.test(firstCharacter)) numbers.push(entry);
        else symbols.push(entry);
      }
      const byWord = (a: WordEntry, b: WordEntry) => wordCollator().compare(a.word, b.word);
      return [...words.sort(byWord), ...numbers.sort(byWord), ...symbols.sort(byWord), ...empty];
    }
    return filtered.sort((a, b) => {
        let comparison = 0;
        switch (sortKey()) {
          case 'word': comparison = wordCollator().compare(a.word, b.word); break;
          case 'translation': comparison = a.translation.localeCompare(b.translation); break;
          case 'level': comparison = (a.level ?? -1) - (b.level ?? -1); break;
          case 'status': comparison = knowledgeStatusToNumeric(a.word) - knowledgeStatusToNumeric(b.word); break;
        }
        return comparison * sortDir();
      });
  };

  const knowledgeStatusToNumeric = (word: string): number => {
    return wordStatusToNumeric(projectedWordStatus(projected.projections().get(word)).status);
  };

  const mergeReadings = (...groups: Array<string | undefined | null | readonly string[]>): string[] => {
    const readings: string[] = [];
    const addReading = (reading: string | undefined | null) => {
      if (!reading || readings.includes(reading)) return;
      readings.push(reading);
    };

    for (const group of groups) {
      if (Array.isArray(group)) {
        for (const reading of group) addReading(reading);
      } else if (typeof group === 'string') {
        addReading(group);
      }
    }

    return readings;
  };

  const ignoredEntries = createMemo<WordEntry[]>(() => {
    const wordFrequency = getWordFrequency();
    return getIgnoredWordsSync()
      .map((ignored) => {
        const freqEntry = wordFrequency[ignored.word];
        return {
          uuid: `ignored:${ignored.word}`,
          word: ignored.word,
          translation: '',
          reading: ignored.reading || freqEntry?.reading || '',
          level: freqEntry?.raw_level ?? null,
          alternateReadings: freqEntry?.alternateReadings,
          ignoredAt: ignored.ignoredAt,
        };
      })
      .sort((a, b) => (b.ignoredAt ?? 0) - (a.ignoredAt ?? 0) || a.word.localeCompare(b.word));
  });

  createEffect(on([entries, ignoredEntries, filterTokens, browseMode, hasLoadedWords, projected.projections, knowledgeQueryReady, sortKey, sortDir], () => {
    if (browseMode() === 'all' && !hasLoadedWords()) {
      return;
    }
    const sourceEntries = browseMode() === 'ignored' ? ignoredEntries() : entries();
    setFilteredEntries(buildFilteredEntries(sourceEntries));
  }, { defer: true }));

  // Load all words: the FULL vocabulary universe — frequency list ∪ dictionary
  // headwords ∪ store-tracked words. Never frequency alone: a tracked word
  // outside the frequency file (or the dictionary) must still be browsable.
  const loadAllWords = async () => {
    const generation = ++loadGeneration;
    const language = settings.language;
    setLoadFailed(false);
    setDictionaryUnavailable(false);
    setIsLoading(true);
    setLoadProgress(0);
    setHasLoadedWords(true);

    try {
      const wordEntries: WordEntry[] = [];
      const seen = new Set<string>();
      const wordFrequency = getWordFrequency();
      const freqWords = Object.entries(wordFrequency);
      const totalWords = freqWords.length;

      for (let i = 0; i < totalWords; i++) {
        const [word, freqEntry] = freqWords[i];
        seen.add(word);
        const uuid = word; // Use word as UUID for consistency
        const trackedCard = getCardByWordSync(word, settings.language);
        const primaryReading = trackedCard?.content?.reading || freqEntry.reading || '';

        wordEntries.push({
          uuid,
          word,
          translation: trackedCard?.content?.back || '',
          reading: primaryReading,
          level: freqEntry.raw_level ?? null,
          fullTranslation: trackedCard?.content?.back,
          prosodyPosition: trackedCard?.content?.prosody?.position ?? null,
          prosody: trackedCard?.content?.prosody,
          alternateReadings: mergeReadings(freqEntry.reading, freqEntry.alternateReadings, trackedCard?.content?.reading)
            .filter((reading) => reading !== primaryReading),
        });

        // Update progress every 100 words
        if (i % 100 === 0) {
          setLoadProgress(Math.floor((i / totalWords) * 90));
        }
      }

      // Dictionary universe: every headword the dictionary serves, beyond the
      // frequency file. Translations lazy-load when rows scroll into view.
      try {
        const dictionaryPairs = await loadDictionaryUniverse(language);
        if (generation !== loadGeneration) return;
        const CHUNK = 5000;
        for (let i = 0; i < dictionaryPairs.length; i += 1) {
          const [word, reading] = dictionaryPairs[i];
          if (seen.has(word)) continue;
          seen.add(word);
          wordEntries.push({
            uuid: word,
            word,
            translation: '',
            reading,
            level: null,
            fullTranslation: '',
            prosodyPosition: null,
            alternateReadings: [],
          });
          if (i % CHUNK === 0) {
            if (generation !== loadGeneration) return;
            setLoadProgress(90 + Math.floor((i / dictionaryPairs.length) * 8));
            // Yield so the loader keeps painting over the ~300k-entry merge.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      } catch (e) {
        if (generation !== loadGeneration) return;
        setDictionaryUnavailable(true);
        log.warn('Dictionary universe unavailable; browsing frequency + tracked words only:', e);
      }
      // Store-tracked words: tracked knowledge entries and card fronts that
      // exist in neither the frequency list nor the dictionary (custom words,
      // names) still get rows — their knowledge state is inspectable.
      const trackedWords = new Set<string>();
      for (const [key, entry] of Object.entries(flashcardStore?.wordKnowledge ?? {})) {
        const ownerLanguage = entry.language ?? key.split(':')[0];
        if (entry.word && ownerLanguage === language) trackedWords.add(entry.word);
      }
      for (const card of Object.values(flashcardStore?.flashcards ?? {})) {
        if (card?.content?.front && card.language === language) trackedWords.add(card.content.front);
      }
      for (const word of trackedWords) {
        if (seen.has(word)) continue;
        seen.add(word);
        const trackedCard = getCardByWordSync(word, settings.language);
        wordEntries.push({
          uuid: word,
          word,
          translation: trackedCard?.content.back ?? '',
          reading: trackedCard?.content.reading ?? '',
          level: null,
          fullTranslation: trackedCard?.content.back,
          prosodyPosition: null,
          alternateReadings: [],
        });
      }

      if (generation !== loadGeneration) return;
      setEntries(wordEntries);
      setFilteredEntries(buildFilteredEntries(wordEntries));
      setLoadProgress(100);
    } catch (e) {
      if (generation === loadGeneration) setLoadFailed(true);
      log.error('Failed to load words:', e);
    } finally {
      if (generation === loadGeneration) setIsLoading(false);
    }
  };

  const [isSearching, setIsSearching] = createSignal(false);

  // Search words — show a loader while filtering large datasets
  const handleSearch = () => {
    const sourceEntries = browseMode() === 'ignored' ? ignoredEntries() : entries();

    setIsSearching(true);
    // Yield to the event loop so the loader overlay paints before the sync work
    requestAnimationFrame(() => {
      setFilteredEntries(buildFilteredEntries(sourceEntries));
      setIsSearching(false);
    });
  };

  // Sort entries
  const handleSort = (key: string) => {
    if (sortKey() === key) {
      setSortDir(prev => prev === 1 ? -1 : 1);
    } else {
      setSortKey(key);
      setSortDir(1);
    }


  };

  // Add flashcard for word.
  // The card is built by the same owner every other word surface uses, so a
  // word added from here gets the translation, reading, prosody and initial
  // ease that the row it was added from is already displaying. Reading
  // entry.translation alone silently produced untranslated cards here,
  // because rows display a lazily cached translation instead.
  //
  // The build awaits a translation fetch before it writes, so a second click
  // used to start while the first was still in flight and both wrote a card
  // for the same word. The other capture surfaces refuse a repeat request
  // while one is pending; this row now does the same, keyed per word so
  // adding two different rows at once is still allowed.
  const handleAddFlashcard = async (entry: WordEntry) => {
    if (pendingCardAdds().has(entry.word)) return;
    setPendingCardAdds((previous) => new Set(previous).add(entry.word));
    try {
      const translationData = getCachedTranslation(entry.word, settings.language, wordLookupOptions)
        ?? await fetchTranslation(entry.word, settings.language, wordLookupOptions);

      const { content, ease } = await buildWordHoverFlashcardContent({
        token: { word: entry.word, surface: entry.word, actual_word: entry.word, type: '' },
        word: entry.word,
        translationData,
        contextPhrase: undefined,
        isOcr: false,
        wordUuid: entry.uuid,
        level: entry.level,
        wordStatus: projectedWordStatus(projected.projections().get(entry.word)).status,
        colourCodes: settings.colour_codes || {},
        languageData: currentLangData(),
        tokenize,
        srsLearningEase: settings.srsLearningThreshold / 1000,
        srsKnownEase: settings.known_ease_threshold / 1000,
      });

      await addFlashcard(content, ease, undefined, settings.language);

      log.info(`%cAdded flashcard for word "${entry.word}"`, 'color: cyan;');
    } catch (e) {
      // The vocabulary browser used to swallow this: the row simply returned to
      // offering "Add mLearn card", so a word that never became a card looked
      // like it had. Five sibling capture surfaces report it, and the decision
      // now belongs to one owner.
      reportCaptureFailure(e, { word: entry.word }, { translate: t, log: log.error });
    } finally {
      setPendingCardAdds((previous) => {
        const next = new Set(previous);
        next.delete(entry.word);
        return next;
      });
    }
  };

  // Remove flashcard for word
  const handleRemoveFlashcard = async (entry: WordEntry) => {
    const language = settings.language;
    const scope = JSON.stringify([language, entry.word]);
    if (pendingCardRemovals.has(scope)) return;
    const owner = Symbol('card-removal');
    const generation = removalGeneration;
    pendingCardRemovals.set(scope, owner);
    const stillOwned = () => !removalDisposed && generation === removalGeneration && settings.language === language;
    try {
      // Find flashcard by word (async now)
      const card = await getCardByWord(entry.word, language);

      if (!card || !stillOwned()) return;

      // Same irreversible act, same prompt: the danger button here used to
      // destroy the card outright while the equivalent control in Browse and
      // Review asked first.
      if (requiresDestructiveConfirmation(1)) {
        const confirmed = await showConfirm(buildDestructiveConfirmOptions({
          count: 1,
          titleKey: 'mlearn.Flashcards.Modals.DeleteCard.Title',
          messageKey: 'mlearn.Flashcards.Modals.DeleteCard.Confirm',
        }, t));
        if (!confirmed || !stillOwned()) return;
      }

      const removed = await removeFlashcard(card.id, true);
      if (!stillOwned()) return;
      if (!removed) {
        showToast({ message: t('mlearn.Flashcards.Review.RemovalSaveFailed'), variant: 'error' });
        return;
      }

      log.info(`%cRemoved flashcard for word "${entry.word}"`, 'color: orange;');
    } catch (e) {
      log.error('Failed to remove flashcard:', e);
      if (stillOwned()) showToast({ message: t('mlearn.Flashcards.Review.RemovalSaveFailed'), variant: 'error' });
    } finally { if (pendingCardRemovals.get(scope) === owner) pendingCardRemovals.delete(scope); }
  };

  const handleUnignore = async (entry: WordEntry) => {
    try {
      await unignoreWordForLanguage(entry.word, settings.language);
    } catch (e) {
      log.error('Failed to unignore word:', e);
      showToast({ message: t('mlearn.Knowledge.StudyPreferenceSaveFailed'), variant: 'error' });
    }
  };

  // Reactive level names from langData - uses createMemo for reactivity
  // This ensures the level names update when langData loads asynchronously
  const levelNames = createMemo(() => getLevelNames());

  // Edit entry handler
  const handleEdit = (entry: WordEntry) => {
    setEditingEntry(entry);
    setEditDialogOpen(true);
  };

  // Handle save from edit dialog
  const handleEditSave = async (data: TranslationOverride) => {
    const entry = editingEntry();
    if (!entry) return;

    // Update local state with new data
    const updatedEntry: WordEntry = {
      ...entry,
      reading: data.reading || entry.reading,
      prosodyPosition: data.prosodyPosition,
      prosody: data.prosody,
      translation: data.definitions.slice(0, 3).join(', '),
      fullTranslation: data.definitions.join('\n'),
    };

    setEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? updatedEntry : e
    ));
    setFilteredEntries(prev => prev.map(e =>
        e.uuid === entry.uuid ? updatedEntry : e
    ));

    setEditDialogOpen(false);
    setEditingEntry(null);
    log.info(`%cUpdated translation data for word "${entry.word}"`, 'color: lime;');
  };

  const handleAnkiPreview = (entry: WordEntry) => {
    setAnkiPreviewEntry(entry);
    setAnkiPreviewOpen(true);
  };

  const getEditInitialData = (entry: WordEntry): TranslationOverride | null => {
    const definitions = entry.fullTranslation?.split('\n').filter(Boolean) ?? [];
    const hasSavedDefinitions = definitions.length > 0;
    const hasSavedProsody = Boolean(entry.prosody?.type && entry.prosody.type !== 'none')
      || entry.prosodyPosition !== null
      || Boolean(getCardByWordSync(entry.word, settings.language));

    if (!hasSavedDefinitions && !hasSavedProsody) {
      return null;
    }

    return {
      reading: entry.reading || '',
      prosodyPosition: entry.prosodyPosition ?? null,
      prosody: entry.prosody,
      definitions,
    };
  };

  // Open flashcard editor for a tracked word
  const handleEditFlashcard = (entry: WordEntry) => {
    const card = getCardByWordSync(entry.word, settings.language);
    if (!card) return;
    setEditingFlashcard(card);
    setEditFlashcardOpen(true);
  };

  const handleEditFlashcardSave = (content: FlashcardContent, metadataUpdates?: Partial<Flashcard>) => {
    const card = editingFlashcard();
    if (!card) return;
    if (metadataUpdates && Object.keys(metadataUpdates).length > 0) {
      updateFlashcard(card.id, { content: { ...card.content, ...content }, ...metadataUpdates });
    } else {
      updateFlashcardContent(card.id, content);
    }
    setEditFlashcardOpen(false);
    setEditingFlashcard(null);
  };

  const handleEditFlashcardCancel = () => {
    setEditFlashcardOpen(false);
    setEditingFlashcard(null);
  };

  const handleExportToAnki = async (entry: WordEntry) => {
    const uuid = entry.uuid;
    setAnkiExportStates(prev => ({ ...prev, [uuid]: 'exporting' }));

    try {
      const isConnected = await anki.checkConnection();
      if (!isConnected) {
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'error' }));
        log.warn('Anki is not connected');
        return;
      }

      const isDuplicate = await anki.checkDuplicate(entry.word);
      if (isDuplicate) {
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'duplicate' }));
        return;
      }

      const meaning = entry.translation || entry.fullTranslation || entry.word;
      // Pull example sentence from flashcard if available
      const card = getCardByWordSync(entry.word, settings.language);
      const noteId = await anki.addNote({
        word: entry.word,
        reading: entry.reading || undefined,
        meaning,
        sentence: card?.content?.example || undefined,
        sentenceMeaning: card?.content?.exampleMeaning || undefined,
      });

      if (noteId) {
        await refreshAnkiWordsCache(ankiCacheOptions());
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'exported' }));
        log.info(`%cExported "${entry.word}" to Anki (noteId: ${noteId})`, 'color: cyan;');
      } else {
        setAnkiExportStates(prev => ({ ...prev, [uuid]: 'error' }));
      }
    } catch (e) {
      log.error('Failed to export to Anki:', e);
      setAnkiExportStates(prev => ({ ...prev, [uuid]: 'error' }));
    }
  };

  const [entriesListRef, setEntriesListRef] = createSignal<HTMLDivElement | undefined>(undefined);
  const [headerRef, setHeaderRef] = createSignal<HTMLDivElement | undefined>(undefined);
  const ROW_HEIGHT = 56;

  const virtualizer = createMemo(() => {
    const entries = filteredEntries();
    return createVirtualizer({
      count: entries.length,
      getScrollElement: () => entriesListRef(),
      estimateSize: () => ROW_HEIGHT,
      overscan: 5,
      measureDynamic: true,
    });
  });

  createEffect(() => {
    const header = headerRef();
    if (!header) return;

    const container = header.parentElement as HTMLElement | null;
    if (!container) return;

    const updateHeight = () => {
      container.style.setProperty('--word-db-editor-header-height', `${header.offsetHeight}px`);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : null;
    if (ro) ro.observe(header);
    updateHeight();

    onCleanup(() => { if (ro) ro.disconnect(); });
  });

  return (
      <div class="word-db-editor" classList={{ 'managing-words': showManagement() }}>
        <Show when={loadFailed() || dictionaryUnavailable()}>
          <div role="alert" class="word-db-load-error">
            <p>{t(loadFailed() ? 'mlearn.WordDbEditor.LoadError' : 'mlearn.WordDbEditor.DictionaryUnavailable')}</p>
            <Button onClick={() => void loadAllWords()} disabled={isLoading()}>{t('mlearn.Knowledge.Retry')}</Button>
          </div>
        </Show>
        {/* While initializing or waiting for word frequency data, keep the
            list's geometry with placeholder rows instead of a blank page —
            the window opens as a stable shell, never as an empty table. */}
        <Show when={!isInitialized() || (browseMode() === 'all' && !hasLoadedWords() && !isLoading())}>
          <div class="init-loading" aria-busy="true">
            <SkeletonRows rows={9} />
          </div>
        </Show>

        <Show when={isInitialized() && (browseMode() === 'ignored' || hasLoadedWords() || isLoading())}>
          <CollapsibleStickyHeader ref={setHeaderRef} getScrollContainer={entriesListRef} class="word-db-editor-header">
            {/* Search Bar */}
            <SearchBar
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                browseMode={browseMode}
                setBrowseMode={setBrowseMode}
                isLoading={isLoading}
                loadProgress={loadProgress}
                levelNames={levelNames()}
                onSearch={handleSearch}
                filterTokens={filterTokens}
                setFilterTokens={setFilterTokens}
                filterFields={filterContext().fields}
                filterPaletteItems={filterContext().paletteItems}
                filterEvaluation={filterValidation()}
                studyOrderSelected={sortKey() === 'study'}
                onStudyOrder={() => { setSortKey('study'); setSortDir(1); }}
                showManagement={showManagement()}
                onToggleManagement={() => setShowManagement(value => !value)}
            />

            {/* Table Header */}
            <EntriesHeader
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                showIntegrations={showManagement()}
            />
          </CollapsibleStickyHeader>

          <Show when={needsKnowledgeQuery() && (journalKeys.state === 'errored' || projected.failed())}>
            <KnowledgeLoadError onRetry={() => { if (journalKeys.state === 'errored') void retryJournalKeys(); else projected.retry(); }} />
          </Show>
          <Show when={!knowledgeQueryReady() && journalKeys.state !== 'errored' && !projected.failed()}><div aria-busy="true"><SkeletonRows rows={9} /></div></Show>
          {/* Entries List */}
          <div class="entries-list" ref={setEntriesListRef}>
            <Show when={knowledgeQueryReady() && !loadFailed() && !dictionaryUnavailable() && !isLoading() && filteredEntries().length === 0 && (browseMode() === 'ignored' || hasLoadedWords())}>
              <div class="empty-state">
                <p>{browseMode() === 'ignored' ? t('mlearn.WordDbEditor.EmptyIgnoredState') : t('mlearn.WordDbEditor.EmptyState')}</p>
              </div>
            </Show>

            <Show when={knowledgeQueryReady() && filteredEntries().length > 0}>
              <div style={{ position: 'relative', width: '100%', height: `${virtualizer().getTotalSize()}px` }}>
                <For each={virtualizer().getVirtualItems()}>
                  {(item) => {
                    const entry = filteredEntries()[item.index];
                    return (
                      <div
                        class="virtual-row"
                        data-index={item.index}
                        ref={(el) => virtualizer().measureElement(el, item.index)}
                        style={{
                          position: 'absolute',
                          top: '0',
                          left: '0',
                          width: '100%',
                          transform: `translateY(${item.start}px)`,
                        }}
                      >
                        <WordEntryRow
                            entry={entry}
                            showManagement={showManagement()}
                            levelNames={levelNames()}
                            onAddFlashcard={handleAddFlashcard}
                            isAddingFlashcard={pendingCardAdds().has(entry.word)}
                            onRemoveFlashcard={handleRemoveFlashcard}
                            onUnignore={handleUnignore}
                            onEditFlashcard={handleEditFlashcard}
                            onEdit={handleEdit}
                            onExportToAnki={ankiEnabled() ? handleExportToAnki : undefined}
                            onAnkiPreview={ankiEnabled() ? handleAnkiPreview : undefined}
                            ankiExportState={ankiExportStates()[entry.uuid] || 'idle'}
                        />
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>

          {/* Loading Overlay */}
          <ModalLoadingOverlay
            isOpen={isLoading()}
            message={`${t('mlearn.WordDbEditor.LoadingMore')} ${loadProgress()}%`}
            progress={loadProgress()}
            showProgress={true}
            showPercent={false}
          />

          {/* Search Overlay */}
          <ModalLoadingOverlay
            isOpen={isSearching()}
            message={t('mlearn.WordDbEditor.Searching')}
          />

          {/* Anki Card Preview Modal */}
          <Show when={ankiPreviewOpen() && ankiPreviewEntry()}>
            <AnkiCardPreviewModal
                word={findAnkiWordMatchInCache(getWordFormCandidates(ankiPreviewEntry()!.word, getCanonicalForm, getWordVariants, { language: settings.language, languageData: currentLangData() }), { language: settings.language, languageData: currentLangData() })?.word || ankiPreviewEntry()!.word}
                isOpen={ankiPreviewOpen()}
                onClose={() => {
                  setAnkiPreviewOpen(false);
                  setAnkiPreviewEntry(null);
                }}
                onExport={() => {
                  const entry = ankiPreviewEntry();
                  if (entry) handleExportToAnki(entry);
                  setAnkiPreviewOpen(false);
                  setAnkiPreviewEntry(null);
                }}
            />
          </Show>

          {/* Edit Translation Dialog */}
          <Show when={editDialogOpen() && editingEntry()}>
            <EditTranslationDialog
                word={editingEntry()!.word}
                isOpen={editDialogOpen()}
                onClose={() => {
                  setEditDialogOpen(false);
                  setEditingEntry(null);
                }}
                onSave={handleEditSave}
                initialData={getEditInitialData(editingEntry()!)}
            />
          </Show>

          {/* Edit Flashcard Modal */}
          <FlashcardEditModal
            isOpen={editFlashcardOpen()}
            flashcard={editingFlashcard()}
            onClose={handleEditFlashcardCancel}
            onSave={handleEditFlashcardSave}
          />
        </Show>

        <ConfirmDialogElement />
      </div>
  );
};

// Main App with providers
export const WordDbEditorApp: Component = () => {
  return (
      <WindowWrapper showDragRegion={false}>
        <WordDbEditorContent />
      </WindowWrapper>
  );
};

export default WordDbEditorApp;
