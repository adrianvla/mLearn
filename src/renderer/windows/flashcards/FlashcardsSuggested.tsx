/**
 * FlashcardsSuggested
 * UI for browsing / filtering / promoting automatically captured suggestions.
 *
 * Suggestions are "lightweight" flashcards (screenshot + context phrase only)
 * produced whenever the learner sees a new word during playback/reading. When
 * promoted they go through the normal translation/LLM/TTS pipeline before
 * being saved as real flashcards.
 */

import { Component, For, Show, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import {
  Btn,
  Input,
  Select,
  EmptyState,
  PillLabel,
  ProgressBar,
  ToggleSwitch,
  SparklesIcon,
  SearchIcon,
  TrashIcon,
  PlusIcon,
  CheckIcon,
  EyeOffIcon,
  Tooltip,
  SelectableCard,
  CollapsibleStickyHeader,
} from '../../components/common';
import { WordStatusPill } from '../../components/common/Smart';
import { FlashcardPitchAccent } from '../../components/flashcard';
import { useFlashcards, useLocalization, useLanguage, useSettings } from '../../context';
import { showToast } from '../../components/common/Feedback/Toast';
import { cacheVersion, getCachedReading, getCachedTranslation, warmTranslationCache } from '../../hooks/useTranslation';
import { extractPitchPosition } from '../../utils/translationCacheParsers';
import { isWordMarkedFailed } from '@shared/utils/passiveWordTracking';
import { createVirtualizer } from '../../hooks/useVirtualizer';
import type { WordStatus } from '../../components/subtitle/wordHoverHelpers';
import type { FlashcardContent, SuggestedFlashcard } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import './FlashcardsSuggested.css';
import { getLogger } from '@shared/utils/logger';

const log = getLogger("renderer.flashcards.flashcardsSuggested");

type QuickFilter = 'all' | 'failed' | 'dict';

export const FlashcardsSuggested: Component = () => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const langCtx = useLanguage();
  const {
    getSuggestedFlashcardsSync,
    removeSuggestedFlashcard,
    removeSuggestedFlashcards,
    promoteSuggestedFlashcards,
    ignoreWordForLanguage,
    store,
  } = useFlashcards();

  const [search, setSearch] = createSignal('');
  const [quickFilter, setQuickFilter] = createSignal<QuickFilter>('all');
  const [levelFilter, setLevelFilter] = createSignal<string>('all');
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [useLLM, setUseLLM] = createSignal(settings.flashcardLLMExamples ?? DEFAULT_SETTINGS.flashcardLLMExamples);
  const [useTts, setUseTts] = createSignal(settings.flashcardAutoGenerateAudio ?? DEFAULT_SETTINGS.flashcardAutoGenerateAudio);
  const [promoting, setPromoting] = createSignal<{ current: number; total: number } | null>(null);

  let suggestedRef: HTMLDivElement | undefined;
  let virtualScrollRef: HTMLDivElement | undefined;

  // Keyed by the per-language suggestion list so Solid re-reads on store update.
  const suggestions = createMemo(() => getSuggestedFlashcardsSync());

  const levelNames = createMemo(() => langCtx.getFreqLevelNames());
  const hasLevelData = createMemo(() => Object.keys(levelNames()).length > 0);

  const levelOptions = createMemo(() => {
    const base = [{ value: 'all', label: t('mlearn.Flashcards.Suggested.Filter.AllLevels') }];
    const names = levelNames();
    // Sorted descending by numeric level (hardest first)
    const levels = Object.keys(names).map(Number).sort((a, b) => a - b);
    for (const lvl of levels) {
      base.push({ value: String(lvl), label: names[String(lvl)] });
    }
    base.push({ value: 'unknown', label: t('mlearn.Flashcards.Suggested.Filter.Unknown') });
    return base;
  });

  const quickFilterOptions = createMemo(() => [
    { value: 'all', label: t('mlearn.Flashcards.Suggested.Filter.AllWords') },
    { value: 'failed', label: t('mlearn.Flashcards.Suggested.Filter.FailedOnly') },
    { value: 'dict', label: t('mlearn.Flashcards.Suggested.Filter.DictionaryOnly') },
  ]);

  const filtered = createMemo<SuggestedFlashcard[]>(() => {
    const q = search().trim().toLowerCase();
    const qf = quickFilter();
    const lvl = levelFilter();

    return suggestions().filter((s) => {
      if (q && !s.word.toLowerCase().includes(q) && !(s.reading || '').toLowerCase().includes(q)) {
        return false;
      }

      if (lvl !== 'all') {
        if (lvl === 'unknown') {
          if (s.level != null) return false;
        } else {
          if (s.level == null || String(s.level) !== lvl) return false;
        }
      }

      if (qf === 'dict') {
        if (s.level == null) return false;
      }

      if (qf === 'failed') {
        const lk = settings.language + ':';
        const matches = Object.entries(store.wordKnowledge).find(([k, entry]) =>
          k.startsWith(lk) && entry.word === s.word
        );
        if (!matches) return false;
        const [, entry] = matches;
        if (!isWordMarkedFailed(entry, settings)) return false;
      }

      return true;
    });
  });

  const [containerWidth, setContainerWidth] = createSignal(0);
  const CARD_MIN_WIDTH = 300;
  const CARD_GAP = 16;

  const columns = createMemo(() => {
    const w = containerWidth();
    if (w === 0) return 1;
    return Math.max(1, Math.floor((w + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
  });

  const rowCount = createMemo(() => {
    const c = columns();
    return Math.ceil(filtered().length / c);
  });

  const CARD_HEIGHT = 220;

  const virtualizer = createMemo(() => {
    const rows = rowCount();
    return createVirtualizer({
      count: rows,
      getScrollElement: () => virtualScrollRef,
      estimateSize: () => CARD_HEIGHT + CARD_GAP,
      overscan: 3,
    });
  });

  createEffect(() => {
    const el = virtualScrollRef;
    if (!el) return;

    const updateWidth = () => setContainerWidth(el.clientWidth);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateWidth) : null;
    if (ro) ro.observe(el);
    updateWidth();

    onCleanup(() => { if (ro) ro.disconnect(); });
  });

  createEffect(() => {
    const words = filtered().map((suggestion) => suggestion.word).filter((word) => word.trim().length > 0);
    if (words.length === 0) return;
    void warmTranslationCache(words, undefined, undefined, settings.language);
  });

  const previewContentById = createMemo(() => {
    cacheVersion();

    const content = new Map<string, FlashcardContent>();
    for (const suggestion of filtered()) {
      const cachedTranslation = getCachedTranslation(suggestion.word, settings.language);
      const pitchAccent = cachedTranslation?.data
        ? extractPitchPosition(cachedTranslation.data[2]) ?? undefined
        : undefined;
      const cachedReading = getCachedReading(suggestion.word, settings.language) || undefined;

      content.set(suggestion.id, {
        front: suggestion.word,
        reading: suggestion.reading || cachedReading,
        back: '',
        type: 'word',
        pitchAccent,
        pos: suggestion.pos,
      });
    }

    return content;
  });

  const allFilteredSelected = createMemo(() => {
    const ids = filtered().map((s) => s.id);
    if (ids.length === 0) return false;
    const sel = selected();
    return ids.every((id) => sel.has(id));
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const ids = filtered().map((s) => s.id);
    if (allFilteredSelected()) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    }
  };

  const clearSelection = () => setSelected(new Set<string>());

  const promoteSelected = async () => {
    const ids = Array.from(selected());
    if (ids.length === 0) return;
    setPromoting({ current: 0, total: ids.length });
    try {
      const created = await promoteSuggestedFlashcards(ids, {
        useLLM: useLLM(),
        useTts: useTts(),
        onProgress: (current, total) => setPromoting({ current, total }),
      });
      if (created > 0) {
        showToast({
          message: t('mlearn.Flashcards.Suggested.Promoted', { count: String(created) }),
          variant: 'success',
        });
      } else {
        showToast({ message: t('mlearn.Flashcards.Suggested.PromoteFailed'), variant: 'warning' });
      }
      clearSelection();
    } finally {
      setPromoting(null);
    }
  };

  const removeSelected = () => {
    const ids = Array.from(selected());
    removeSuggestedFlashcards(ids);
    clearSelection();
    showToast({ message: t('mlearn.Flashcards.Suggested.Removed', { count: String(ids.length) }), variant: 'info' });
  };

  const formatLevel = (s: SuggestedFlashcard): string | null => {
    if (s.level == null) return null;
    const names = levelNames();
    return names[String(s.level)] || null;
  };

  const handleDelete = (id: string) => {
    removeSuggestedFlashcard(id);
  };

  const handleSuggestedStatusChange = (suggestion: SuggestedFlashcard, status: WordStatus) => {
    if (status !== 'known') return;
    removeSuggestedFlashcard(suggestion.id);
  };

  const handlePromoteOne = async (id: string) => {
    setPromoting({ current: 0, total: 1 });
    try {
      const created = await promoteSuggestedFlashcards([id], {
        useLLM: useLLM(),
        useTts: useTts(),
        onProgress: (current, total) => setPromoting({ current, total }),
      });
      if (created > 0) {
        showToast({ message: t('mlearn.Flashcards.Suggested.Promoted', { count: '1' }), variant: 'success' });
      } else {
        showToast({ message: t('mlearn.Flashcards.Suggested.PromoteFailed'), variant: 'warning' });
      }
    } finally {
      setPromoting(null);
    }
  };

  const handleIgnoreOne = async (s: SuggestedFlashcard) => {
    try {
      await ignoreWordForLanguage(s.word, s.reading);
      removeSuggestedFlashcard(s.id);
      showToast({ message: t('mlearn.Global.Ignore'), variant: 'info' });
    } catch (e) {
      log.error("error", e);
      showToast({ message: t('mlearn.Global.Error'), variant: 'error' });
    }
  };

  return (
    <div class="flashcards-suggested" ref={(el) => { suggestedRef = el; }}>
      <div class="flashcards-suggested-header">
        <div class="flashcards-suggested-title-row">
          <h2 class="flashcards-suggested-title">
            {t('mlearn.Flashcards.Suggested.Title')}
          </h2>
          <span class="flashcards-suggested-count">
            {t('mlearn.Flashcards.Suggested.CountLabel', {
              shown: String(filtered().length),
              total: String(suggestions().length),
            })}
          </span>
        </div>
        <p class="flashcards-suggested-desc">{t('mlearn.Flashcards.Suggested.Description')}</p>
      </div>

      <Show when={suggestions().length > 0} fallback={
        <div class="flashcards-suggested-empty">
          <EmptyState
            icon={<SparklesIcon size={32} />}
            title={t('mlearn.Flashcards.Suggested.EmptyTitle')}
            description={t('mlearn.Flashcards.Suggested.EmptyDescription')}
            variant="card"
          />
        </div>
      }>
        <CollapsibleStickyHeader getScrollContainer={() => suggestedRef} class="flashcards-suggested-sticky-controls">
          <div class="flashcards-suggested-controls">
            <Input
              class="flashcards-suggested-search"
              placeholder={t('mlearn.Flashcards.Suggested.SearchPlaceholder')}
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              leftIcon={<SearchIcon size={16} />}
              size="md"
            />
            <Select
              options={quickFilterOptions()}
              value={quickFilter()}
              onChange={(e) => setQuickFilter(e.currentTarget.value as QuickFilter)}
              class="flashcards-suggested-filter"
            />
            <Show when={hasLevelData()}>
              <Select
                options={levelOptions()}
                value={levelFilter()}
                onChange={(e) => setLevelFilter(e.currentTarget.value)}
                class="flashcards-suggested-filter"
              />
            </Show>
          </div>

          <div class="flashcards-suggested-bulkbar">
            <div class="flashcards-suggested-bulkbar-left">
              <Btn size="sm" variant="secondary" onClick={toggleSelectAllFiltered}>
                {allFilteredSelected()
                  ? t('mlearn.Flashcards.Suggested.DeselectAll')
                  : t('mlearn.Flashcards.Suggested.SelectAll')}
              </Btn>
              <span class="flashcards-suggested-selected-count">
                {t('mlearn.Flashcards.Suggested.SelectedCount', { count: String(selected().size) })}
              </span>
            </div>
            <div class="flashcards-suggested-bulkbar-right">
              <label class="flashcards-suggested-toggle">
                <ToggleSwitch
                  checked={useLLM()}
                  onChange={(v) => setUseLLM(v)}
                  label={t('mlearn.Flashcards.Suggested.UseLLM')}
                />
              </label>
              <label class="flashcards-suggested-toggle">
                <ToggleSwitch
                  checked={useTts()}
                  onChange={(v) => setUseTts(v)}
                  label={t('mlearn.Flashcards.Suggested.UseTTS')}
                />
              </label>
              <Btn
                size="sm"
                variant="secondary"
                disabled={selected().size === 0 || !!promoting()}
                onClick={removeSelected}
                icon={<TrashIcon size={14} />}
                iconPosition="left"
              >
                {t('mlearn.Flashcards.Suggested.DeleteSelected')}
              </Btn>
              <Btn
                size="sm"
                variant="primary"
                disabled={selected().size === 0 || !!promoting()}
                onClick={promoteSelected}
                icon={<CheckIcon size={14} />}
                iconPosition="left"
              >
                {t('mlearn.Flashcards.Suggested.PromoteSelected')}
              </Btn>
            </div>
          </div>
        </CollapsibleStickyHeader>

        <Show when={promoting()}>
          {(p) => (
            <div class="flashcards-suggested-progress">
              <div class="flashcards-suggested-progress-label">
                {t('mlearn.Flashcards.Suggested.Promoting', {
                  current: String(p().current),
                  total: String(p().total),
                })}
              </div>
              <ProgressBar
                value={p().total > 0 ? (p().current / p().total) * 100 : 0}
                variant="primary"
                size="sm"
              />
            </div>
          )}
        </Show>

        <div class="flashcards-suggested-scroll" ref={(el) => { virtualScrollRef = el; }}>
          <div class="flashcards-suggested-virtual-container" style={{ height: `${virtualizer().getTotalSize()}px` }}>
            <For each={virtualizer().getVirtualItems()}>
              {(item) => {
                const colCount = columns();
                const startIdx = item.index * colCount;
                const endIdx = Math.min(startIdx + colCount, filtered().length);
                const rowItems = filtered().slice(startIdx, endIdx);

                return (
                  <div
                    class="flashcards-suggested-grid-row"
                    style={{
                      position: 'absolute',
                      top: '0',
                      left: '0',
                      width: '100%',
                      height: `${CARD_HEIGHT}px`,
                      'margin-bottom': `${CARD_GAP}px`,
                      transform: `translateY(${item.start}px)`,
                      'grid-template-columns': `repeat(${colCount}, minmax(0, 1fr))`,
                    }}
                  >
                    <For each={rowItems}>
                      {(s) => {
                        const checked = () => selected().has(s.id);
                        const levelLabel = formatLevel(s);
                        const previewContent = () => previewContentById().get(s.id) ?? {
                          front: s.word,
                          reading: s.reading,
                          back: '',
                          type: 'word' as const,
                          pos: s.pos,
                        };
                        return (
                          <Tooltip
                            delay={200}
                            position="top"
                            class="flashcards-suggested-tooltip-wrapper"
                            content={
                              <div class="flashcards-suggested-preview">
                                <Show when={s.imageUrl}>
                                  <img src={s.imageUrl} alt="" class="flashcards-suggested-image" loading="lazy" />
                                </Show>
                                <Show when={!s.imageUrl}>
                                  <div class="flashcards-suggested-no-image">{t('mlearn.Flashcards.Suggested.NoPreviewImage')}</div>
                                </Show>
                              </div>
                            }
                          >
                            <SelectableCard
                              selected={checked()}
                              onClick={() => toggleSelect(s.id)}
                              title={<FlashcardPitchAccent content={previewContent()} />}
                              headerActions={
                                <Show when={levelLabel}>
                                  <PillLabel level={s.level ?? undefined}>{levelLabel}</PillLabel>
                                </Show>
                              }
                              class="flashcards-suggested-card"
                            >
                              <div class="flashcard-translation">
                                <Show when={s.contextPhrase}>
                                  <div class="flashcards-suggested-context">{s.contextPhrase}</div>
                                </Show>
                                <div class="flashcards-suggested-meta">
                                  <span>{t('mlearn.Flashcards.Suggested.SeenCount', { count: String(s.count) })}</span>
                                  <Show when={s.source}>
                                    <span class="flashcards-suggested-source" title={s.source}>• {s.source}</span>
                                  </Show>
                                </div>
                              </div>
                              <div class="flashcard-footer">
                                <div class="flashcard-state" onClick={(e) => e.stopPropagation()}>
                                  <WordStatusPill word={s.word} onStatusChange={(status) => handleSuggestedStatusChange(s, status)} />
                                </div>
                                <div class="flashcard-actions">
                                  <Btn
                                    size="xs"
                                    variant="ghost"
                                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                                    icon={<TrashIcon size={14} />}
                                    title={t('mlearn.Global.Delete')}
                                  />
                                  <Btn
                                    size="xs"
                                    variant="ghost"
                                    onClick={(e) => { e.stopPropagation(); handleIgnoreOne(s); }}
                                    icon={<EyeOffIcon size={14} />}
                                    title={t('mlearn.Global.Ignore')}
                                  />
                                  <Btn
                                    size="xs"
                                    variant="primary"
                                    onClick={(e) => { e.stopPropagation(); handlePromoteOne(s.id); }}
                                    icon={<PlusIcon size={14} />}
                                    disabled={!!promoting()}
                                    title={t('mlearn.Flashcards.Suggested.Promote')}
                                  >
                                    {t('mlearn.Flashcards.Suggested.Promote')}
                                  </Btn>
                                </div>
                              </div>
                            </SelectableCard>
                          </Tooltip>
                        );
                      }}
                    </For>
                  </div>
                );
              }}
            </For>
          </div>
          <Show when={filtered().length === 0}>
            <div class="flashcards-suggested-nomatch">
              <EmptyState
                title={t('mlearn.Flashcards.Suggested.NoMatchTitle')}
                description={t('mlearn.Flashcards.Suggested.NoMatchDescription')}
                size="sm"
                variant="minimal"
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
