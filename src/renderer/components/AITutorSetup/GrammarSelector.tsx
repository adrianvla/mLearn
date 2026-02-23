/**
 * GrammarSelector
 * Allows the user to search, filter by level, and select grammar points for AI tutor sessions.
 * Only rendered when the current language supports grammar data.
 */

import { Component, createSignal, createMemo, For, Show } from 'solid-js';
import { useLocalization } from '../../context';
import { useLanguage, type GrammarEntry } from '../../context/LanguageContext';
import { useFlashcards } from '../../context/FlashcardContext';
import { Input, SelectableCard, PillLabel, PillBtn, EmptyState, Tag, HintText } from '../common';
import type { TutorGrammarSelection } from '../../../shared/types';
import './GrammarSelector.css';

interface GrammarSelectorProps {
  selected: TutorGrammarSelection[];
  onSelectionChange: (selected: TutorGrammarSelection[]) => void;
}

const INITIAL_DISPLAY_COUNT = 80;

export const GrammarSelector: Component<GrammarSelectorProps> = (props) => {
  const { t } = useLocalization();
  const { currentLangData, supportsGrammar, getGrammarLevelName } = useLanguage();
  const flashcardCtx = useFlashcards();

  const [searchQuery, setSearchQuery] = createSignal('');
  const [levelFilter, setLevelFilter] = createSignal<number | null>(null);
  const [displayCount, setDisplayCount] = createSignal(INITIAL_DISPLAY_COUNT);

  // Collect all grammar points from the current language
  const allGrammarPoints = createMemo((): GrammarEntry[] => {
    const data = currentLangData();
    if (!data?.grammar) return [];
    const levelNames = data.grammar_level_names || {};
    return data.grammar.map((gp) => ({
      ...gp,
      levelName: levelNames[String(gp.level)] || String(gp.level),
    }));
  });

  // Available level numbers for filter pills
  const availableLevels = createMemo(() => {
    const levels = new Set<number>();
    for (const gp of allGrammarPoints()) {
      levels.add(gp.level);
    }
    return Array.from(levels).sort((a, b) => a - b);
  });

  // Selected patterns set for O(1) lookup
  const selectedPatterns = createMemo(() => new Set(props.selected.map(s => s.pattern)));

  // Filter and sort grammar points
  const filteredGrammar = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const level = levelFilter();

    let items = allGrammarPoints();

    // Filter by level
    if (level !== null) {
      items = items.filter(gp => gp.level === level);
    }

    // Filter by search
    if (query) {
      items = items.filter(gp =>
        gp.pattern.toLowerCase().includes(query) ||
        gp.meaning.toLowerCase().includes(query)
      );
    }

    // Sort: selected first, then by ease (failed first), then by level, then alphabetical
    return items.sort((a, b) => {
      const aSelected = selectedPatterns().has(a.pattern) ? 0 : 1;
      const bSelected = selectedPatterns().has(b.pattern) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;

      const aKnowledge = flashcardCtx.getGrammarKnowledge(a.pattern);
      const bKnowledge = flashcardCtx.getGrammarKnowledge(b.pattern);
      const aEase = aKnowledge?.ease ?? 2.5;
      const bEase = bKnowledge?.ease ?? 2.5;
      if (aEase !== bEase) return aEase - bEase; // Lower ease (struggling) first

      if (a.level !== b.level) return a.level - b.level;
      return a.pattern.localeCompare(b.pattern);
    });
  });

  const displayedGrammar = createMemo(() => filteredGrammar().slice(0, displayCount()));

  const toggleGrammar = (gp: GrammarEntry) => {
    const isSelected = selectedPatterns().has(gp.pattern);
    if (isSelected) {
      props.onSelectionChange(props.selected.filter(s => s.pattern !== gp.pattern));
    } else {
      props.onSelectionChange([...props.selected, {
        pattern: gp.pattern,
        meaning: gp.meaning,
        level: gp.level,
      }]);
    }
  };

  const handleShowMore = () => {
    setDisplayCount(prev => prev + INITIAL_DISPLAY_COUNT);
  };

  if (!supportsGrammar()) {
    return (
      <EmptyState
        title={t('mlearn.AITutorSetup.NoGrammarSupport')}
      />
    );
  }

  return (
    <div class="grammar-selector">
      <HintText>{t('mlearn.AITutorSetup.SelectGrammarHint')}</HintText>

      <div class="grammar-selector__filters">
        <Input
          value={searchQuery()}
          onInput={(e) => {
            setSearchQuery(e.currentTarget.value);
            setDisplayCount(INITIAL_DISPLAY_COUNT);
          }}
          placeholder={t('mlearn.AITutorSetup.SearchGrammar')}
        />
      </div>

      <Show when={availableLevels().length > 1}>
        <div class="grammar-selector__level-pills">
          <PillLabel
            variant="gray"
            clickable
            active={levelFilter() === null}
            onClick={() => {
              setLevelFilter(null);
              setDisplayCount(INITIAL_DISPLAY_COUNT);
            }}
          >
            {t('mlearn.AITutorSetup.AllLevels')}
          </PillLabel>
          <For each={availableLevels()}>
            {(level) => (
              <PillLabel
                level={level}
                clickable
                active={levelFilter() === level}
                onClick={() => {
                  setLevelFilter(level);
                  setDisplayCount(INITIAL_DISPLAY_COUNT);
                }}
              >
                {getGrammarLevelName(level)}
              </PillLabel>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.selected.length > 0}>
        <HintText>{t('mlearn.AITutorSetup.ItemsSelected', { count: String(props.selected.length) })}</HintText>
      </Show>

      <div class="grammar-selector__list">
        <For each={displayedGrammar()}>
          {(gp) => {
            const knowledge = () => flashcardCtx.getGrammarKnowledge(gp.pattern);
            return (
              <SelectableCard
                selected={selectedPatterns().has(gp.pattern)}
                onClick={() => toggleGrammar(gp)}
                title={gp.pattern}
                subtitle={gp.meaning}
                badgeElement={<PillLabel level={gp.level} size="xs">{getGrammarLevelName(gp.level)}</PillLabel>}
                size="sm"
                showCheckmark
              >
                <Show when={knowledge()}>
                  <div class="grammar-selector__card-meta">
                    <Tag size="sm" variant={knowledge()!.ease < 2.0 ? 'error' : knowledge()!.ease < 2.5 ? 'warning' : 'default'}>
                      {knowledge()!.timesEncountered > 0
                        ? `${knowledge()!.timesFailed}/${knowledge()!.timesEncountered}`
                        : ''}
                    </Tag>
                  </div>
                </Show>
              </SelectableCard>
            );
          }}
        </For>

        <Show when={displayCount() < filteredGrammar().length}>
          <PillBtn onClick={handleShowMore}>
            {t('mlearn.AITutorSetup.ShowMore')}
          </PillBtn>
        </Show>
      </div>
    </div>
  );
};
