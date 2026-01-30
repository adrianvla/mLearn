/**
 * Flashcards Window App Component
 * SRS flashcard review interface
 */

import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { useFlashcards } from '../../context';
import { FlashcardReview, FlashcardEditor, FlashcardSyncModal } from '../../components/flashcard';
import { 
  GlassCard, 
  GlassModal, 
  GlassInput, 
  GlassBtn,
  TabBtn,
  Badge,
  EmptyState,
  StatCard,
} from '../../components/common';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import './FlashcardsApp.css';

type TabId = 'review' | 'browse' | 'stats';

const FlashcardsContent: Component = () => {
  const { store, getDueCards, removeFlashcard, addFlashcard, updateFlashcard } = useFlashcards();
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

  // Get flashcards from store
  const flashcards = () => store.flashcards;

  const dueCount = () => getDueCards().length;
  
  // Compute stats
  const stats = createMemo(() => {
    const cards = flashcards();
    return {
      new: cards.filter((c: Flashcard) => c.reviews === 0).length,
      learning: cards.filter((c: Flashcard) => c.reviews > 0 && (c.interval ?? 0) < 21 * 24 * 60).length,
      review: dueCount(),
    };
  });

  const handleDeleteCard = async () => {
    const cardId = selectedCard();
    if (cardId) {
      // Find the card index by id
      const idx = flashcards().findIndex(c => c.id === cardId);
      if (idx !== -1) {
        await removeFlashcard(idx, false);
      }
      setShowDeleteConfirm(false);
      setSelectedCard(null);
    }
  };

  const handleAddCard = async () => {
    if (!newWord().trim() || !newMeaning().trim()) return;

    await addFlashcard({
      word: newWord().trim(),
      pronunciation: newReading().trim() || newWord().trim(),
      translation: [newMeaning().trim()],
      example: '',
      exampleMeaning: '',
      pos: '',
      level: -1,
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
    
    const idx = flashcards().findIndex(c => c.id === card.id);
    if (idx === -1) return;
    
    updateFlashcard(idx, { content });
    
    setShowEditModal(false);
    setEditingCard(null);
  };

  const handleEditCardCancel = () => {
    setShowEditModal(false);
    setEditingCard(null);
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
                badge={tab.id === 'review' && dueCount() > 0 ? dueCount() : undefined}
                badgeVariant="primary"
                onClick={() => setActiveTab(tab.id)}
              />
            )}
          </For>
        </div>

        <div class="flashcards-header-actions">
          <GlassBtn size="sm" variant="secondary" onClick={() => setShowSyncModal(true)}>
            {t('mlearn.Flashcards.UI.Sync')}
          </GlassBtn>
          <GlassBtn size="sm" onClick={() => setShowAddModal(true)}>
            {t('mlearn.Flashcards.UI.AddCard')}
          </GlassBtn>
        </div>
      </div>

      {/* Content */}
      <div class="flashcards-content">
        {/* Review Tab */}
        <Show when={activeTab() === 'review'}>
          <Show
            when={dueCount() > 0}
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
                  {(card) => (
                    <GlassCard
                      title={card.content.word}
                      subtitle={card.content.pronunciation !== card.content.word ? card.content.pronunciation : undefined}
                    >
                      <p class="flashcard-translation">
                        {card.content.translation?.join(', ') || card.content.definition?.join(', ')}
                      </p>
                      <div class="flashcard-footer">
                        <Badge>{card.reviews} reviews</Badge>
                        <div class="flashcard-actions">
                          <GlassBtn
                            variant="ghost"
                            size="xs"
                            onClick={() => openEditModal(card)}
                          >
                            {t('mlearn.Global.Edit')}
                          </GlassBtn>
                          <GlassBtn
                            variant="danger"
                            size="xs"
                            onClick={() => {
                              setSelectedCard(card.id ?? card.content.word);
                              setShowDeleteConfirm(true);
                            }}
                          >
                            {t('mlearn.Global.Delete')}
                          </GlassBtn>
                        </div>
                      </div>
                    </GlassCard>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Stats Tab */}
        <Show when={activeTab() === 'stats'}>
          <div class="flashcards-stats">
            <div class="flashcards-stats-grid">
              <GlassCard>
                <StatCard
                  label={t('mlearn.Flashcards.Statistics.TotalCards')}
                  value={flashcards().length}
                  icon="📚"
                  color="primary"
                  size="lg"
                />
              </GlassCard>
              <GlassCard>
                <StatCard
                  label={t('mlearn.Flashcards.Statistics.DueToday')}
                  value={dueCount()}
                  icon="📅"
                  color="warning"
                  size="lg"
                />
              </GlassCard>
              <GlassCard>
                <StatCard
                  label={t('mlearn.Flashcards.Statistics.Mature')}
                  value={flashcards().filter((c: Flashcard) => (c.interval ?? 0) > 21 * 24 * 60).length}
                  icon="⭐"
                  color="success"
                  size="lg"
                />
              </GlassCard>
            </div>

            <GlassCard title={t('mlearn.Flashcards.Statistics.CardBreakdown')} class="flashcards-breakdown">
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
              </div>
            </GlassCard>
          </div>
        </Show>
      </div>

      {/* Delete confirmation modal */}
      <GlassModal
        isOpen={showDeleteConfirm()}
        onClose={() => setShowDeleteConfirm(false)}
        title={t('mlearn.Flashcards.Modals.DeleteCard.Title')}
        size="sm"
        footer={
          <>
            <GlassBtn onClick={() => setShowDeleteConfirm(false)}>{t('mlearn.Global.Cancel')}</GlassBtn>
            <GlassBtn variant="danger" onClick={handleDeleteCard}>{t('mlearn.Global.Delete')}</GlassBtn>
          </>
        }
      >
        <p>{t('mlearn.Flashcards.Modals.DeleteCard.Confirm')}</p>
      </GlassModal>

      {/* Add card modal */}
      <GlassModal
        isOpen={showAddModal()}
        onClose={() => setShowAddModal(false)}
        title={t('mlearn.Flashcards.Modals.AddCard.Title')}
        footer={
          <>
            <GlassBtn onClick={() => setShowAddModal(false)}>{t('mlearn.Global.Cancel')}</GlassBtn>
            <GlassBtn variant="primary" onClick={handleAddCard}>{t('mlearn.Flashcards.Modals.AddCard.Submit')}</GlassBtn>
          </>
        }
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem' }}>
          <GlassInput
            label={t('mlearn.Flashcards.Modals.AddCard.WordLabel')}
            value={newWord()}
            onInput={(e) => setNewWord(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.WordPlaceholder')}
            fullWidth
          />
          <GlassInput
            label={t('mlearn.Flashcards.Modals.AddCard.ReadingLabel')}
            value={newReading()}
            onInput={(e) => setNewReading(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.ReadingPlaceholder')}
            fullWidth
          />
          <GlassInput
            label={t('mlearn.Flashcards.Modals.AddCard.MeaningLabel')}
            value={newMeaning()}
            onInput={(e) => setNewMeaning(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.MeaningPlaceholder')}
            fullWidth
          />
        </div>
      </GlassModal>

      {/* Edit card modal - uses full FlashcardEditor */}
      <GlassModal
        isOpen={showEditModal()}
        onClose={handleEditCardCancel}
        title={`${t('mlearn.Flashcards.Modals.EditCard.Title')} – ${editingCard()?.content.word || ''}`}
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
      </GlassModal>

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
