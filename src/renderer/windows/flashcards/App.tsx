/**
 * Flashcards Window App Component
 * SRS flashcard review interface
 */

import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import { WindowWrapper } from '../../context';
import { useFlashcards, useSettings } from '../../context';
import { FlashcardReview } from '../../components/flashcard';
import { GlassPanel, GlassButton, GlassCard, GlassModal, GlassInput } from '../../components/common';
import type { Flashcard } from '../../../shared/types';

type TabId = 'review' | 'browse' | 'stats';

const FlashcardsContent: Component = () => {
  const { store, getDueCards, removeFlashcard, addFlashcard } = useFlashcards();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { settings } = useSettings();

  const [activeTab, setActiveTab] = createSignal<TabId>('review');
  const [selectedCard, setSelectedCard] = createSignal<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [showAddModal, setShowAddModal] = createSignal(false);
  
  // Add card form state
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
      learning: cards.filter((c: Flashcard) => c.reviews > 0 && c.interval < 21).length,
      review: dueCount(),
    };
  });

  const handleDeleteCard = () => {
    const cardId = selectedCard();
    if (cardId) {
      removeFlashcard(cardId);
      setShowDeleteConfirm(false);
      setSelectedCard(null);
    }
  };

  const handleAddCard = () => {
    if (!newWord().trim() || !newMeaning().trim()) return;

    addFlashcard({
      word: newWord().trim(),
      pronunciation: newReading().trim() || newWord().trim(),
      translation: [newMeaning().trim()],
      example: '',
      exampleMeaning: '',
      pos: '',
      level: 0,
    });

    setNewWord('');
    setNewReading('');
    setNewMeaning('');
    setShowAddModal(false);
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'review', label: 'Review' },
    { id: 'browse', label: 'Browse' },
    { id: 'stats', label: 'Statistics' },
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
        'background-color': 'var(--bg-primary)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          padding: '1rem 1.5rem',
          'border-bottom': '1px solid var(--glass-border)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <For each={tabs}>
            {(tab) => (
              <button
                style={{
                  padding: '0.5rem 1rem',
                  background: activeTab() === tab.id ? 'var(--glass-bg)' : 'transparent',
                  border: 'none',
                  'border-radius': 'var(--radius-md)',
                  color: activeTab() === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                <Show when={tab.id === 'review' && dueCount() > 0}>
                  <span
                    style={{
                      'margin-left': '0.5rem',
                      padding: '0.125rem 0.5rem',
                      'background-color': 'var(--color-primary)',
                      'border-radius': 'var(--radius-full)',
                      'font-size': '0.75rem',
                    }}
                  >
                    {dueCount()}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>

        <GlassButton size="sm" onClick={() => setShowAddModal(true)}>
          + Add Card
        </GlassButton>
      </div>

      {/* Content */}
      <div style={{ flex: '1', overflow: 'auto' }}>
        {/* Review Tab */}
        <Show when={activeTab() === 'review'}>
          <Show
            when={dueCount() > 0}
            fallback={
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  'align-items': 'center',
                  'justify-content': 'center',
                  height: '100%',
                  padding: '2rem',
                }}
              >
                <GlassPanel
                  variant="dark"
                  blur="lg"
                  rounded="xl"
                  padding="xl"
                  style={{ 'text-align': 'center', 'max-width': '400px' }}
                >
                  <div style={{ 'font-size': '3rem', 'margin-bottom': '1rem' }}>✨</div>
                  <h2
                    style={{
                      'font-size': '1.5rem',
                      'font-weight': '600',
                      color: 'var(--text-primary)',
                      'margin-bottom': '0.5rem',
                    }}
                  >
                    All Caught Up!
                  </h2>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    No cards due for review right now. Keep learning!
                  </p>
                </GlassPanel>
              </div>
            }
          >
            <FlashcardReview />
          </Show>
        </Show>

        {/* Browse Tab */}
        <Show when={activeTab() === 'browse'}>
          <div style={{ padding: '1rem' }}>
            <Show
              when={flashcards.length > 0}
              fallback={
                <div style={{ 'text-align': 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  No flashcards yet. Add words while watching videos!
                </div>
              }
            >
              <div
                style={{
                  display: 'grid',
                  'grid-template-columns': 'repeat(auto-fill, minmax(250px, 1fr))',
                  gap: '1rem',
                }}
              >
                <For each={flashcards()}>
                  {(card) => (
                    <GlassCard
                      title={card.content.word}
                      subtitle={card.content.pronunciation !== card.content.word ? card.content.pronunciation : undefined}
                    >
                      <p
                        style={{
                          'font-size': '0.875rem',
                          color: 'var(--text-secondary)',
                          'margin-bottom': '0.75rem',
                        }}
                      >
                        {card.content.translation?.join(', ') || card.content.definition?.join(', ')}
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <span
                          class="pill"
                          style={{ 'font-size': '0.75rem' }}
                        >
                          {card.reviews} reviews
                        </span>
                        <button
                          style={{
                            'margin-left': 'auto',
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-danger)',
                            cursor: 'pointer',
                            'font-size': '0.75rem',
                          }}
                          onClick={() => {
                            setSelectedCard(card.id);
                            setShowDeleteConfirm(true);
                          }}
                        >
                          Delete
                        </button>
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
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              'align-items': 'center',
              gap: '1.5rem',
              padding: '2rem',
            }}
          >
            <div
              style={{
                display: 'grid',
                'grid-template-columns': 'repeat(3, 1fr)',
                gap: '1rem',
                width: '100%',
                'max-width': '600px',
              }}
            >
              <GlassCard title="Total Cards">
                <p
                  style={{
                    'font-size': '2rem',
                    'font-weight': '600',
                    color: 'var(--color-primary)',
                  }}
                >
                  {flashcards.length}
                </p>
              </GlassCard>
              <GlassCard title="Due Today">
                <p
                  style={{
                    'font-size': '2rem',
                    'font-weight': '600',
                    color: 'var(--color-warning)',
                  }}
                >
                  {dueCount()}
                </p>
              </GlassCard>
              <GlassCard title="Mature">
                <p
                  style={{
                    'font-size': '2rem',
                    'font-weight': '600',
                    color: 'var(--color-success)',
                  }}
                >
                  {flashcards().filter((c: Flashcard) => c.interval > 21).length}
                </p>
              </GlassCard>
            </div>

            <GlassCard title="Card Breakdown" style={{ width: '100%', 'max-width': '600px' }}>
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', 'justify-content': 'space-between' }}>
                  <span>New</span>
                  <span>{stats().new}</span>
                </div>
                <div style={{ display: 'flex', 'justify-content': 'space-between' }}>
                  <span>Learning</span>
                  <span>{stats().learning}</span>
                </div>
                <div style={{ display: 'flex', 'justify-content': 'space-between' }}>
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
