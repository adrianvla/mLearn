/**
 * Flashcards Window App Component
 * SRS flashcard review interface with Anki-like queue management
 */

import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { useFlashcards } from '../../context';
import { FlashcardReview, FlashcardEditor, FlashcardSyncModal } from '../../components/flashcard';
import {
  Card,
  Modal,
  Input,
  Btn,
  TabBtn,
  Badge,
  EmptyState,
  StatCard,
} from '../../components/common';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import './FlashcardsApp.css';

type TabId = 'review' | 'browse' | 'stats';

const FlashcardsContent: Component = () => {
  const {
    store,
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

  // Add card form state (simple mode)
  const [newWord, setNewWord] = createSignal('');
  const [newReading, setNewReading] = createSignal('');
  const [newMeaning, setNewMeaning] = createSignal('');

  // Get flashcards from store (now it's a Record)
  const flashcards = createMemo(() => getAllCards());

  // Queue counts for UI
  const counts = createMemo(() => queueCounts());

  // Compute stats
  const stats = createMemo(() => {
    const cards = flashcards();
    const now = Date.now();
    return {
      total: cards.length,
      new: cards.filter(c => c.state === 'new').length,
      learning: cards.filter(c => c.state === 'learning' || c.state === 'relearning').length,
      review: cards.filter(c => c.state === 'review' && c.dueDate <= now).length,
      mature: cards.filter(c => c.state === 'review' && c.interval > 21 * 24 * 60 * 60 * 1000).length,
      suspended: cards.filter(c => c.suspended).length,
    };
  });

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

  const tabs: { id: TabId; label: string }[] = [
    { id: 'review', label: t('mlearn.Flashcards.UI.Tabs.Review') },
    { id: 'browse', label: t('mlearn.Flashcards.UI.Tabs.Browse') },
    { id: 'stats', label: t('mlearn.Flashcards.UI.Tabs.Statistics') },
  ];

  return (
      <div class="flashcards-window">
        {/* Header */}
        <div class="flashcards-header">
          <div class="flashcards-tabs">
            <For each={tabs}>
              {(tab) => (
                  <TabBtn
                      label={tab.label}
                      active={activeTab() === tab.id}
                      badge={tab.id === 'review' && counts().total > 0 ? counts().total : undefined}
                      badgeVariant="primary"
                      onClick={() => setActiveTab(tab.id)}
                  />
              )}
            </For>
          </div>

          <div class="flashcards-header-actions">
            <Btn size="sm" variant="secondary" onClick={() => setShowSyncModal(true)}>
              {t('mlearn.Flashcards.UI.Sync')}
            </Btn>
            <Btn size="sm" onClick={() => setShowAddModal(true)}>
              {t('mlearn.Flashcards.UI.AddCard')}
            </Btn>
          </div>
        </div>

        {/* Content */}
        <div class="flashcards-content">
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
                <div class="flashcards-grid">
                  <For each={flashcards()}>
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
                              <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>
                              <Show when={card.state === 'review'}>
                                <Badge>{intervalToString(card.interval)}</Badge>
                              </Show>
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
            </div>
          </Show>

          {/* Stats Tab */}
          <Show when={activeTab() === 'stats'}>
            <div class="flashcards-stats">
              <div class="flashcards-stats-grid">
                <Card>
                  <StatCard
                      label={t('mlearn.Flashcards.Statistics.TotalCards')}
                      value={stats().total}
                      icon="📚"
                      color="primary"
                      size="lg"
                  />
                </Card>
                <Card>
                  <StatCard
                      label={t('mlearn.Flashcards.Statistics.DueToday')}
                      value={counts().total}
                      icon="📅"
                      color="warning"
                      size="lg"
                  />
                </Card>
                <Card>
                  <StatCard
                      label={t('mlearn.Flashcards.Statistics.Mature')}
                      value={stats().mature}
                      icon="⭐"
                      color="success"
                      size="lg"
                  />
                </Card>
              </div>

              <Card title={t('mlearn.Flashcards.Statistics.CardBreakdown')} class="flashcards-breakdown">
                <div class="breakdown-rows">
                  <div class="breakdown-row">
                    <span>{t('mlearn.Flashcards.Statistics.New')}</span>
                    <span>{stats().new}</span>
                  </div>
                  <div class="breakdown-row">
                    <span>{t('mlearn.Flashcards.Statistics.Learning')}</span>
                    <span>{stats().learning}</span>
                  </div>
                  <div class="breakdown-row">
                    <span>{t('mlearn.Flashcards.Statistics.Review')}</span>
                    <span>{stats().review}</span>
                  </div>
                  <div class="breakdown-row">
                    <span>{t('mlearn.Flashcards.Statistics.Suspended')}</span>
                    <span>{stats().suspended}</span>
                  </div>
                </div>
              </Card>

              {/* New cards limit info */}
              <Card title={t('mlearn.Flashcards.Statistics.TodayProgress')} class="flashcards-today">
                <div class="breakdown-rows">
                  <div class="breakdown-row">
                    <span>{t('mlearn.Flashcards.Statistics.NewCardsStudied')}</span>
                    <span>{store.meta.newCardsToday} / {store.meta.maxNewCardsPerDay}</span>
                  </div>
                </div>
              </Card>
            </div>
          </Show>
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
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem' }}>
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
      <WindowWrapper>
        <FlashcardsContent />
      </WindowWrapper>
  );
};

export default FlashcardsApp;
