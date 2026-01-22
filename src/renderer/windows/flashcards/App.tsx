/**
 * Flashcards Window App Component
 * SRS flashcard review interface
 */

import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useFlashcards, useSettings } from '../../context';
import { FlashcardReview, FlashcardEditor } from '../../components/flashcard';
import { 
  GlassCard, 
  GlassModal, 
  GlassInput, 
  GlassButton,
  TabButton,
  EmptyState,
  StatCard,
} from '../../components/common';
import type { Flashcard, FlashcardContent } from '../../../shared/types';
import './FlashcardsApp.css';

type TabId = 'review' | 'browse' | 'stats';

const FlashcardsContent: Component = () => {
  const { store, getDueCards, removeFlashcard, addFlashcard, updateFlashcard } = useFlashcards();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { settings } = useSettings();

  const [activeTab, setActiveTab] = createSignal<TabId>('review');
  const [selectedCard, setSelectedCard] = createSignal<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
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
    { id: 'review', label: 'Review' },
    { id: 'browse', label: 'Browse' },
    { id: 'stats', label: 'Statistics' },
  ];

  return (
    <div class="flashcards-window">
      {/* Header */}
      <div class="flashcards-header">
        <div class="flashcards-tabs">
          <For each={tabs}>
            {(tab) => (
              <TabButton
                label={tab.label}
                active={activeTab() === tab.id}
                badge={tab.id === 'review' && dueCount() > 0 ? dueCount() : undefined}
                badgeVariant="primary"
                onClick={() => setActiveTab(tab.id)}
              />
            )}
          </For>
        </div>

        <GlassButton size="sm" onClick={() => setShowAddModal(true)}>
          + Add Card
        </GlassButton>
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
                  title="All Caught Up!"
                  description="No cards due for review right now. Keep learning!"
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
                  title="No Flashcards Yet"
                  description="Add words while watching videos to start building your vocabulary!"
                  size="md"
                  action={{
                    label: 'Add Card',
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
                        <span class="pill">
                          {card.reviews} reviews
                        </span>
                        <div class="flashcard-actions">
                          <button
                            class="flashcard-edit-btn"
                            onClick={() => openEditModal(card)}
                          >
                            Edit
                          </button>
                          <button
                            class="flashcard-delete-btn"
                            onClick={() => {
                              setSelectedCard(card.id ?? card.content.word);
                              setShowDeleteConfirm(true);
                            }}
                          >
                            Delete
                          </button>
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
                  label="Total Cards"
                  value={flashcards().length}
                  icon="📚"
                  color="primary"
                  size="lg"
                />
              </GlassCard>
              <GlassCard>
                <StatCard
                  label="Due Today"
                  value={dueCount()}
                  icon="📅"
                  color="warning"
                  size="lg"
                />
              </GlassCard>
              <GlassCard>
                <StatCard
                  label="Mature"
                  value={flashcards().filter((c: Flashcard) => (c.interval ?? 0) > 21 * 24 * 60).length}
                  icon="⭐"
                  color="success"
                  size="lg"
                />
              </GlassCard>
            </div>

            <GlassCard title="Card Breakdown" class="flashcards-breakdown">
              <div class="breakdown-rows">
                <div class="breakdown-row">
                  <span>New</span>
                  <span>{stats().new}</span>
                </div>
                <div class="breakdown-row">
                  <span>Learning</span>
                  <span>{stats().learning}</span>
                </div>
                <div class="breakdown-row">
                  <span>Review</span>
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
        title="Delete Card"
        size="sm"
        footer={
          <>
            <GlassButton onClick={() => setShowDeleteConfirm(false)}>Cancel</GlassButton>
            <GlassButton variant="danger" onClick={handleDeleteCard}>Delete</GlassButton>
          </>
        }
      >
        <p>Are you sure you want to delete this flashcard? This action cannot be undone.</p>
      </GlassModal>

      {/* Add card modal */}
      <GlassModal
        isOpen={showAddModal()}
        onClose={() => setShowAddModal(false)}
        title="Add Flashcard"
        footer={
          <>
            <GlassButton onClick={() => setShowAddModal(false)}>Cancel</GlassButton>
            <GlassButton variant="primary" onClick={handleAddCard}>Add Card</GlassButton>
          </>
        }
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem' }}>
          <GlassInput
            label="Word"
            value={newWord()}
            onInput={(e) => setNewWord(e.currentTarget.value)}
            placeholder="Enter word..."
            fullWidth
          />
          <GlassInput
            label="Reading (optional)"
            value={newReading()}
            onInput={(e) => setNewReading(e.currentTarget.value)}
            placeholder="Pronunciation..."
            fullWidth
          />
          <GlassInput
            label="Meaning"
            value={newMeaning()}
            onInput={(e) => setNewMeaning(e.currentTarget.value)}
            placeholder="Definition..."
            fullWidth
          />
        </div>
      </GlassModal>

      {/* Edit card modal - uses full FlashcardEditor */}
      <GlassModal
        isOpen={showEditModal()}
        onClose={handleEditCardCancel}
        title={`Edit Flashcard – ${editingCard()?.content.word || ''}`}
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
