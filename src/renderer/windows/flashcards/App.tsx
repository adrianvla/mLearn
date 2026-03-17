/**
 * Flashcards Window App Component
 * SRS flashcard review interface with Anki-like queue management
 * Modernized UI with sidebar navigation
 */

import { Component, Show, For, createSignal, createMemo, createEffect, on, onCleanup } from 'solid-js';
import { WindowWrapper, useLocalization, useSettings } from '../../context';
import { useFlashcards } from '../../context';
import { FlashcardReview, FlashcardEditor, FlashcardSyncModal, FlashcardStats, FlashcardPitchAccent } from '../../components/flashcard';
import {
  Card,
  Modal,
  Input,
  Btn,
  Badge,
  EmptyState,
  IconBtn,
  SearchIcon,
  TabContainer,
  Select,
  EditIcon,
  BookIcon,
  BarChartIcon,
  SparklesIcon,
  ProgressBar,
  MicrophoneIcon,
  VoiceSamplePicker,
} from '../../components/common';
import { showToast, updateToast, removeToast } from '../../components/common/Feedback/Toast';
import { stripFurigana } from '../../../shared/utils/textUtils';
import { getBridge } from '../../../shared/bridges';
import { getBackend } from '../../../shared/backends';
import { isElectron } from '../../../shared/platform';
import { tokensToColoredHtml } from '../../utils/subtitleParsing';
import { useFlashcardTts } from '../../hooks/useFlashcardTts';
import type { Flashcard, FlashcardContent, TTSProvider } from '../../../shared/types';
import type { TabItem } from '../../components/common/Tabs/TabContainer';
import './FlashcardsLayout.css';
import './FlashcardsBrowse.css';
import './FlashcardsGenerate.css';

type TabId = 'review' | 'browse' | 'generate' | 'stats';

interface TtsRepairJob {
  cardId: string;
  cardFront: string;
  text: string;
  field: 'word' | 'example';
}

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

export const FlashcardsContent: Component = () => {
  const {
    getAllCards,
    queueCounts,
    removeFlashcard,
    addFlashcard,
    updateFlashcardContent,
    intervalToString,
    generateExampleSentenceWithLLM,
    isLoading,
  } = useFlashcards();
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();

  const [activeTab, setActiveTab] = createSignal<TabId>('review');
  const [selectedCard, setSelectedCard] = createSignal<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [showSyncModal, setShowSyncModal] = createSignal(false);
  const [editingCard, setEditingCard] = createSignal<Flashcard | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = createSignal('');

  // Sort state
  const [sortBy, setSortBy] = createSignal('default');

  // Bulk operation state
  const [bulkProgress, setBulkProgress] = createSignal<{ current: number; total: number; label: string; startTime: number } | null>(null);

  // TTS provider override for bulk generation (defaults to settings value)
  const [bulkTtsProvider, setBulkTtsProvider] = createSignal<TTSProvider>(settings.flashcardTtsProvider);

  // Bulk mode: generate only for empty fields, replace all, or regenerate older than date
  const [bulkMode, setBulkMode] = createSignal<'onlyEmpty' | 'replaceAll' | 'olderThan'>('onlyEmpty');

  // Cutoff date for 'olderThan' mode (default: today in YYYY-MM-DD)
  const [bulkOlderThanDate, setBulkOlderThanDate] = createSignal(
    new Date().toISOString().slice(0, 10)
  );

  // Browse TTS hook
  const { playTts: browseTtsPlay, playingField: browseTtsPlayingField, isGenerating: browseTtsGenerating, stop: browseTtsStop } = useFlashcardTts();
  const [browseTtsCardId, setBrowseTtsCardId] = createSignal<string | null>(null);

  // TTS repair state
  const [repairJobs, setRepairJobs] = createSignal<TtsRepairJob[]>([]);
  const [showRepairModal, setShowRepairModal] = createSignal(false);
  const [, setRepairRunning] = createSignal(false);

  // Scan for broken TTS after flashcards finish loading
  let ttsRepairScanned = false;
  createEffect(on(isLoading, (loading) => {
    if (loading || ttsRepairScanned) return;
    ttsRepairScanned = true;
    if (!isElectron()) return;

    (async () => {
      const bridge = getBridge();
      const cards = getAllCards();
      if (cards.length === 0) return;

      const jobs: TtsRepairJob[] = [];
      for (const card of cards) {
        const front = card.content.front;
        const cleanFront = front ? stripFurigana(front) : '';
        if (cleanFront && cleanFront !== '-') {
          const existing = await bridge.flashcards.getFlashcardTts(card.id, 'word');
          if (!existing) {
            jobs.push({ cardId: card.id, cardFront: front, text: cleanFront, field: 'word' });
          }
        }
        const example = card.content.example;
        const cleanExample = example ? stripFurigana(example) : '';
        if (cleanExample && cleanExample !== '-') {
          const existing = await bridge.flashcards.getFlashcardTts(card.id, 'example');
          if (!existing) {
            jobs.push({ cardId: card.id, cardFront: front, text: cleanExample, field: 'example' });
          }
        }
      }
      if (jobs.length > 0) {
        setRepairJobs(jobs);
        setShowRepairModal(true);
      }
    })();
  }));

  // Handle TTS repair
  const handleRepairTts = async () => {
    const jobs = repairJobs();
    if (jobs.length === 0) return;
    setShowRepairModal(false);
    setRepairRunning(true);

    const bridge = getBridge();
    const provider = settings.flashcardTtsProvider;
    const voiceSampleId = settings.flashcardVoiceSampleId || undefined;
    const language = settings.language;
    const cloudAuthToken = settings.cloudAuthAccessToken || undefined;
    const cloudApiUrl = settings.cloudApiUrl || undefined;
    const total = jobs.length;
    let completed = 0;
    let failed = 0;

    const toastId = showToast({
      variant: 'info',
      title: t('mlearn.Flashcards.Repair.ToastTitle'),
      content: (
        <ProgressBar value={0} size="sm" variant="primary" showPercent percentPosition="below" />
      ),
      duration: 0,
    });

    for (const job of jobs) {
      try {
        const result = await bridge.flashcards.generateFlashcardTts(
          job.cardId, job.text, language, job.field, provider,
          voiceSampleId, cloudAuthToken, cloudApiUrl
        );
        if (!result) failed++;
      } catch {
        failed++;
      }
      completed++;
      const pct = Math.round((completed / total) * 100);
      updateToast(toastId, {
        content: (
          <ProgressBar value={pct} size="sm" variant="primary" showPercent percentPosition="below" />
        ),
      });
    }

    removeToast(toastId);
    setRepairRunning(false);
    setRepairJobs([]);

    if (failed > 0) {
      showToast({
        variant: 'warning',
        title: t('mlearn.Flashcards.Repair.DoneWithErrors', { total: completed, failed }),
        duration: 5000,
      });
    } else {
      showToast({
        variant: 'success',
        title: t('mlearn.Flashcards.Repair.Done', { count: completed }),
        duration: 4000,
      });
    }
  };

  const handleBrowseTts = (cardId: string, text: string) => {
    if (browseTtsCardId() === cardId && browseTtsPlayingField() === 'word') {
      browseTtsStop();
      setBrowseTtsCardId(null);
      return;
    }
    setBrowseTtsCardId(cardId);
    browseTtsPlay(cardId, text, settings.language, 'word');
  };

  onCleanup(() => browseTtsStop());

  const sortOptions = createMemo(() => [
    { value: 'default', label: t('mlearn.Flashcards.Browse.SortDefault') },
    { value: 'ease-asc', label: t('mlearn.Flashcards.Browse.SortEaseAsc') },
    { value: 'ease-desc', label: t('mlearn.Flashcards.Browse.SortEaseDesc') },
    { value: 'due-asc', label: t('mlearn.Flashcards.Browse.SortDueDateAsc') },
    { value: 'due-desc', label: t('mlearn.Flashcards.Browse.SortDueDateDesc') },
  ]);

  // Add card form state (simple mode)
  const [newWord, setNewWord] = createSignal('');
  const [newReading, setNewReading] = createSignal('');
  const [newMeaning, setNewMeaning] = createSignal('');

  // Get flashcards from store (now it's a Record)
  const flashcards = createMemo(() => getAllCards());

  // Filtered flashcards for browse tab
  const filteredFlashcards = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    let cards = flashcards();

    if (query) {
      cards = cards.filter(card => {
        const front = card.content.front?.toLowerCase() || '';
        const back = card.content.back?.toLowerCase() || '';
        const reading = card.content.reading?.toLowerCase() || '';

        return front.includes(query) || back.includes(query) || reading.includes(query);
      });
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

  // Queue counts for UI
  const counts = createMemo(() => queueCounts());

  const handleDeleteCard = async () => {
    const cardId = selectedCard();
    if (cardId) {
      await removeFlashcard(cardId, false);
      setShowDeleteConfirm(false);
      setSelectedCard(null);
    }
  };

  const handleAddCard = async () => {
    if (!newWord().trim() || !newMeaning().trim()) return;

    await addFlashcard({
      type: 'word',
      front: newWord().trim(),
      back: newMeaning().trim(),
      reading: newReading().trim() || undefined,
    });

    setNewWord('');
    setNewReading('');
    setNewMeaning('');
    setShowAddModal(false);
  };

  const openEditModal = (card: Flashcard) => {
    setEditingCard(card);
    setShowEditModal(true);
  };

  const handleEditCardSave = (content: FlashcardContent) => {
    const card = editingCard();
    if (!card) return;

    updateFlashcardContent(card.id, content);

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
    const provider = bulkTtsProvider();
    const voiceSampleId = settings.flashcardVoiceSampleId || undefined;
    const cloudAuthToken = settings.cloudAuthAccessToken || undefined;
    const cloudApiUrl = settings.cloudApiUrl || undefined;
    const language = settings.language;

    const replaceAll = bulkMode() === 'replaceAll';
    const olderThan = bulkMode() === 'olderThan';
    const cutoffDate = olderThan ? new Date(bulkOlderThanDate() + 'T23:59:59').getTime() : 0;

    // Collect items that need TTS generation
    const items: Array<{ cardId: string; text: string; field: 'word' | 'example' }> = [];
    for (const card of cards) {
      const front = card.content.front;
      if (front && front !== '-') {
        if (replaceAll) {
          items.push({ cardId: card.id, text: front.replace(/<[^>]*>/g, ''), field: 'word' });
        } else if (olderThan) {
          const meta = await bridge.flashcards.getFlashcardTtsMeta(card.id, 'word');
          if (!meta || new Date(meta.generatedAt).getTime() < cutoffDate) {
            items.push({ cardId: card.id, text: front.replace(/<[^>]*>/g, ''), field: 'word' });
          }
        } else {
          const existing = await bridge.flashcards.getFlashcardTts(card.id, 'word');
          if (!existing) items.push({ cardId: card.id, text: front.replace(/<[^>]*>/g, ''), field: 'word' });
        }
      }
      const example = card.content.example;
      if (example && example !== '-') {
        if (replaceAll) {
          items.push({ cardId: card.id, text: example.replace(/<[^>]*>/g, ''), field: 'example' });
        } else if (olderThan) {
          const meta = await bridge.flashcards.getFlashcardTtsMeta(card.id, 'example');
          if (!meta || new Date(meta.generatedAt).getTime() < cutoffDate) {
            items.push({ cardId: card.id, text: example.replace(/<[^>]*>/g, ''), field: 'example' });
          }
        } else {
          const existing = await bridge.flashcards.getFlashcardTts(card.id, 'example');
          if (!existing) items.push({ cardId: card.id, text: example.replace(/<[^>]*>/g, ''), field: 'example' });
        }
      }
    }

    if (items.length === 0) {
      showToast({ message: t('mlearn.Flashcards.Bulk.TtsAllDone'), variant: 'success' });
      return;
    }

    const startTime = Date.now();
    setBulkProgress({ current: 0, total: items.length, label: t('mlearn.Flashcards.Bulk.TtsProgress'), startTime });

    let generated = 0;
    // Generate one-by-one so we can show progress
    for (const item of items) {
      await bridge.flashcards.generateFlashcardTts(item.cardId, item.text, language, item.field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl);
      generated++;
      setBulkProgress({ current: generated, total: items.length, label: t('mlearn.Flashcards.Bulk.TtsProgress'), startTime });
    }

    setBulkProgress(null);
    showToast({ message: t('mlearn.Flashcards.Bulk.TtsDone', { count: generated }), variant: 'success' });
  };

  /** Bulk generate LLM examples for all flashcards without examples, then tokenize */
  const handleBulkExamples = async () => {
    if (bulkProgress()) return;

    const cards = flashcards();
    const language = settings.language;
    const colourCodes = settings.colour_codes || {};

    const replaceAll = bulkMode() === 'replaceAll';

    // Find cards that need examples
    const needExamples = replaceAll
      ? cards.filter(card => card.content.front && card.content.front !== '-')
      : cards.filter(card =>
          !card.content.example || card.content.example === '-' || card.content.example.trim() === ''
        );

    if (needExamples.length === 0) {
      showToast({ message: t('mlearn.Flashcards.Bulk.ExamplesAllDone'), variant: 'success' });
      return;
    }

    const startTime = Date.now();
    setBulkProgress({ current: 0, total: needExamples.length, label: t('mlearn.Flashcards.Bulk.ExamplesProgress'), startTime });

    const backend = getBackend({
      mode: settings.backendMode,
      url: settings.backendUrl,
      authToken: settings.cloudAuthAccessToken || settings.cloudAuthToken,
    });

    let generated = 0;
    for (const card of needExamples) {
      try {
        const result = await generateExampleSentenceWithLLM(card.content.front, card.content.back, language);
        if (result.sentence) {
          // Tokenize the sentence for colored HTML
          let exampleHtml = result.sentence;
          try {
            const tokens = await backend.tokenize(result.sentence, language);
            if (tokens.length > 0) {
              exampleHtml = tokensToColoredHtml(tokens, colourCodes, card.content.front);
            }
          } catch {
            // Use plain text if tokenization fails
          }
          updateFlashcardContent(card.id, {
            example: exampleHtml,
            exampleMeaning: result.meaning || undefined,
          });
        }
      } catch (e) {
        console.warn(`Failed to generate example for "${card.content.front}":`, e);
      }
      generated++;
      setBulkProgress({ current: generated, total: needExamples.length, label: t('mlearn.Flashcards.Bulk.ExamplesProgress'), startTime });
    }

    setBulkProgress(null);
    showToast({ message: t('mlearn.Flashcards.Bulk.ExamplesDone', { count: generated }), variant: 'success' });
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

  // Bulk mode options
  const bulkModeOptions = createMemo(() => [
    { value: 'onlyEmpty', label: t('mlearn.Flashcards.Bulk.ModeOnlyEmpty') },
    { value: 'replaceAll', label: t('mlearn.Flashcards.Bulk.ModeReplaceAll') },
    { value: 'olderThan', label: t('mlearn.Flashcards.Bulk.ModeOlderThan') },
  ]);

  // Tab items for vertical navigation
  const tabs = createMemo<TabItem[]>(() => [
    { 
      id: 'review', 
      label: t('mlearn.Flashcards.UI.Tabs.Review'),
      icon: <EditIcon size={16} />,
      badge: counts().total > 0 ? counts().total : undefined
    },
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
      id: 'stats', 
      label: t('mlearn.Flashcards.UI.Tabs.Statistics'),
      icon: <BarChartIcon size={16} />
    },
  ]);

  return (
    <div class="flashcards-window">
      <div class="flashcards-layout">
        {/* Left Sidebar */}
        <aside class="flashcards-sidebar">
          <div class="flashcards-sidebar-header">
            <h1 class="flashcards-title">{t('mlearn.Flashcards.UI.Title')}</h1>
          </div>
          
          <nav class="flashcards-nav">
            <TabContainer
              tabs={tabs()}
              activeTab={activeTab()}
              onTabChange={(id) => setActiveTab(id as TabId)}
              orientation="vertical"
              variant="pills"
              size="md"
            />
          </nav>
          
          <div class="flashcards-sidebar-actions">
            <Btn 
              size="sm" 
              variant="secondary" 
              onClick={() => setShowSyncModal(true)}
              class="flashcards-sidebar-btn"
            >
              {t('mlearn.Flashcards.UI.Sync')}
            </Btn>
            <Btn 
              size="sm" 
              variant="primary"
              onClick={() => setShowAddModal(true)}
              class="flashcards-sidebar-btn"
            >
              {t('mlearn.Flashcards.UI.AddCard')}
            </Btn>
          </div>
        </aside>

        {/* Main Content */}
        <main class="flashcards-main">
          {/* Review Tab */}
          <Show when={activeTab() === 'review'}>
            <Show
              when={counts().total > 0}
              fallback={
                <div class="flashcards-empty-container">
                  <EmptyState
                    icon={<SparklesIcon size={32} />}
                    title={t('mlearn.Flashcards.EmptyState.NoCardsDueTitle')}
                    description={t('mlearn.Flashcards.EmptyState.NoCardsDueDescription')}
                    variant="card"
                    size="md"
                  />
                </div>
              }
            >
              <FlashcardReview />
            </Show>
          </Show>

          {/* Browse Tab */}
          <Show when={activeTab() === 'browse'}>
            <div class="flashcards-browse">
              {/* Search Header */}
              <div class="flashcards-browse-header">
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
                        return (
                          <Card
                            title={
                              card.content.reading && card.content.reading !== card.content.front
                                  ? <FlashcardPitchAccent content={card.content} />
                                  : card.content.front}
                            subtitle={undefined
                            }
                            headerActions={
                              <IconBtn
                                icon="volume"
                                size="sm"
                                variant="ghost"
                                class="flashcard-tts-btn"
                                classList={{ 'flashcard-tts-btn--active': browseTtsCardId() === card.id && browseTtsPlayingField() === 'word' }}
                                onClick={() => handleBrowseTts(card.id, card.content.front)}
                                disabled={browseTtsGenerating()}
                                title={t('mlearn.Flashcards.Card.PlayWord')}
                              />
                            }
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
                                <Btn
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => openEditModal(card)}
                                >
                                  {t('mlearn.Global.Edit')}
                                </Btn>
                                <Btn
                                  variant="danger"
                                  size="xs"
                                  onClick={() => {
                                    setSelectedCard(card.id);
                                    setShowDeleteConfirm(true);
                                  }}
                                >
                                  {t('mlearn.Global.Delete')}
                                </Btn>
                              </div>
                            </div>
                          </Card>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </Show>

          {/* Generate Tab */}
          <Show when={activeTab() === 'generate'}>
            <div class="flashcards-generate">
              <h2 class="flashcards-generate-title">{t('mlearn.Flashcards.UI.Tabs.Generate')}</h2>
              <p class="flashcards-generate-description">{t('mlearn.Flashcards.Bulk.GenerateDescription')}</p>

              <div class="flashcards-generate-option">
                <label class="flashcards-generate-label">{t('mlearn.Flashcards.Bulk.ModeChoice')}</label>
                <Select
                  options={bulkModeOptions()}
                  value={bulkMode()}
                  onChange={(e) => setBulkMode(e.currentTarget.value as 'onlyEmpty' | 'replaceAll' | 'olderThan')}
                  class="flashcards-generate-select"
                />
              </div>

              <Show when={bulkMode() === 'olderThan'}>
                <div class="flashcards-generate-option">
                  <label class="flashcards-generate-label">{t('mlearn.Flashcards.Bulk.OlderThanDate')}</label>
                  <Input
                    type="date"
                    value={bulkOlderThanDate()}
                    onInput={(e) => setBulkOlderThanDate(e.currentTarget.value)}
                    class="flashcards-generate-select"
                  />
                </div>
              </Show>

              <div class="flashcards-generate-actions">
                <Show when={isElectron()}>
                  <div class="flashcards-generate-section">
                    <div class="flashcards-generate-section-header">
                      <MicrophoneIcon size={18} />
                      <h3>{t('mlearn.Flashcards.Bulk.TtsButton')}</h3>
                    </div>
                    <p class="flashcards-generate-section-desc">{t('mlearn.Flashcards.Bulk.TtsTooltip')}</p>

                    <div class="flashcards-generate-option">
                      <label class="flashcards-generate-label">{t('mlearn.AI.Settings.FlashcardTTS.Provider.Label')}</label>
                      <Select
                        options={ttsProviderOptions()}
                        value={bulkTtsProvider()}
                        onChange={(e) => setBulkTtsProvider(e.currentTarget.value as TTSProvider)}
                        class="flashcards-generate-select"
                      />
                    </div>

                    <Show when={bulkTtsProvider() !== 'kokoro' && bulkTtsProvider() !== 'cloud'}>
                      <div class="flashcards-generate-option">
                        <label class="flashcards-generate-label">{t('mlearn.AI.Settings.FlashcardTTS.VoiceSample.Label')}</label>
                        <VoiceSamplePicker
                          value={settings.flashcardVoiceSampleId}
                          onChange={(id) => updateSettings({ flashcardVoiceSampleId: id })}
                          selectClass="flashcards-generate-select"
                          ttsProvider={bulkTtsProvider()}
                        />
                      </div>
                    </Show>

                    <Btn
                      size="md"
                      variant="primary"
                      onClick={handleBulkTts}
                      class="flashcards-generate-btn"
                      disabled={!!bulkProgress()}
                      icon={<MicrophoneIcon size={16} />}
                    >
                      {t('mlearn.Flashcards.Bulk.TtsButton')}
                    </Btn>
                  </div>
                </Show>

                <div class="flashcards-generate-section">
                  <div class="flashcards-generate-section-header">
                    <SparklesIcon size={18} />
                    <h3>{t('mlearn.Flashcards.Bulk.ExamplesButton')}</h3>
                  </div>
                  <p class="flashcards-generate-section-desc">{t('mlearn.Flashcards.Bulk.ExamplesTooltip')}</p>

                  <Btn
                    size="md"
                    variant="primary"
                    onClick={handleBulkExamples}
                    class="flashcards-generate-btn"
                    disabled={!!bulkProgress()}
                    icon={<SparklesIcon size={16} />}
                  >
                    {t('mlearn.Flashcards.Bulk.ExamplesButton')}
                  </Btn>
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

          {/* Stats Tab */}
          <Show when={activeTab() === 'stats'}>
            <FlashcardStats />
          </Show>
        </main>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteConfirm()}
        onClose={() => setShowDeleteConfirm(false)}
        title={t('mlearn.Flashcards.Modals.DeleteCard.Title')}
        size="sm"
        footer={
          <>
            <Btn onClick={() => setShowDeleteConfirm(false)}>{t('mlearn.Global.Cancel')}</Btn>
            <Btn variant="danger" onClick={handleDeleteCard}>{t('mlearn.Global.Delete')}</Btn>
          </>
        }
      >
        <p>{t('mlearn.Flashcards.Modals.DeleteCard.Confirm')}</p>
      </Modal>

      {/* Add card modal */}
      <Modal
        isOpen={showAddModal()}
        onClose={() => setShowAddModal(false)}
        title={t('mlearn.Flashcards.Modals.AddCard.Title')}
        footer={
          <>
            <Btn onClick={() => setShowAddModal(false)}>{t('mlearn.Global.Cancel')}</Btn>
            <Btn variant="primary" onClick={handleAddCard}>{t('mlearn.Flashcards.Modals.AddCard.Submit')}</Btn>
          </>
        }
      >
        <div class="flashcards-add-form">
          <Input
            label={t('mlearn.Flashcards.Modals.AddCard.WordLabel')}
            value={newWord()}
            onInput={(e) => setNewWord(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.WordPlaceholder')}
            fullWidth
          />
          <Input
            label={t('mlearn.Flashcards.Modals.AddCard.ReadingLabel')}
            value={newReading()}
            onInput={(e) => setNewReading(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.ReadingPlaceholder')}
            fullWidth
          />
          <Input
            label={t('mlearn.Flashcards.Modals.AddCard.MeaningLabel')}
            value={newMeaning()}
            onInput={(e) => setNewMeaning(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.MeaningPlaceholder')}
            fullWidth
          />
        </div>
      </Modal>

      {/* Edit card modal - uses full FlashcardEditor */}
      <Modal
        isOpen={showEditModal()}
        onClose={handleEditCardCancel}
        title={`${t('mlearn.Flashcards.Modals.EditCard.Title')} – ${editingCard()?.content.front || ''}`}
        size="lg"
      >
        <Show when={editingCard()}>
          <FlashcardEditor
            flashcard={editingCard()!}
            onSave={handleEditCardSave}
            onCancel={handleEditCardCancel}
            showStats={true}
          />
        </Show>
      </Modal>

      {/* Sync Modal */}
      <FlashcardSyncModal
        isOpen={showSyncModal()}
        onClose={() => setShowSyncModal(false)}
      />

      {/* TTS Repair Modal */}
      <Modal
        isOpen={showRepairModal()}
        onClose={() => setShowRepairModal(false)}
        title={t('mlearn.Flashcards.Repair.Title')}
        size="sm"
        footer={
          <>
            <Btn onClick={() => setShowRepairModal(false)}>{t('mlearn.Global.Close')}</Btn>
            <Btn variant="primary" onClick={handleRepairTts}>{t('mlearn.Flashcards.Repair.RepairButton')}</Btn>
          </>
        }
      >
        <p>{t('mlearn.Flashcards.Repair.Description', { count: repairJobs().length })}</p>
      </Modal>
    </div>
  );
};

export const FlashcardsApp: Component = () => {
  return (
    <WindowWrapper showDragRegion={false}>
      <FlashcardsContent />
    </WindowWrapper>
  );
};

export default FlashcardsApp;
