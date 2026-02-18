/**
 * Flashcards Window App Component
 * SRS flashcard review interface with Anki-like queue management
 * Modernized UI with sidebar navigation
 */

import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { useFlashcards } from '../../context';
import { FlashcardReview, FlashcardEditor, FlashcardSyncModal, FlashcardStats } from '../../components/flashcard';
import {
  Card,
  Modal,
  Input,
  Btn,
  Badge,
  EmptyState,
  SearchIcon,
  TabContainer,
  Select,
} from '../../components/common';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import type { TabItem } from '../../components/common/Tabs/TabContainer';
import './FlashcardsApp.css';

type TabId = 'review' | 'browse' | 'stats';

export const FlashcardsContent: Component = () => {
  const {
    getAllCards,
    queueCounts,
    removeFlashcard,
    addFlashcard,
    updateFlashcardContent,
    intervalToString
  } = useFlashcards();
  const { t } = useLocalization();

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

  // Get state badge variant
  const getStateBadge = (card: Flashcard) => {
    switch (card.state) {
      case 'new': return { label: t('mlearn.Flashcards.State.New'), variant: 'primary' as const };
      case 'learning': return { label: t('mlearn.Flashcards.State.Learning'), variant: 'warning' as const };
      case 'relearning': return { label: t('mlearn.Flashcards.State.Relearning'), variant: 'error' as const };
      case 'review': return { label: t('mlearn.Flashcards.State.Review'), variant: 'success' as const };
    }
  };

  // Tab items for vertical navigation
  const tabs = createMemo<TabItem[]>(() => [
    { 
      id: 'review', 
      label: t('mlearn.Flashcards.UI.Tabs.Review'),
      icon: '📝',
      badge: counts().total > 0 ? counts().total : undefined
    },
    { 
      id: 'browse', 
      label: t('mlearn.Flashcards.UI.Tabs.Browse'),
      icon: '📚'
    },
    { 
      id: 'stats', 
      label: t('mlearn.Flashcards.UI.Tabs.Statistics'),
      icon: '📊'
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
                    icon="✨"
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
                    icon="📚"
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
                      icon="🔍"
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
                            title={card.content.front}
                            subtitle={card.content.reading && card.content.reading !== card.content.front
                              ? card.content.reading : undefined}
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
