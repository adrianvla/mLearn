/**
 * GrammarSelector
 * Allows the user to search, filter by level, and select grammar points for AI tutor sessions.
 * Only rendered when the current language supports grammar data.
 */

import { Component, createSignal, createMemo, For, Show } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { useLanguage, type GrammarEntry } from '../../context/LanguageContext';
import { useFlashcards } from '../../context/FlashcardContext';
import { Input, SelectableCard, PillLabel, EmptyState, Tag, HintText, LevelPillsFilter, CollapsibleStickyHeader } from '../common';
import type { TutorGrammarSelection } from '../../../shared/types';
import { compareGrammarLevelsForDisplay, getGrammarLevelLabel, getGrammarLevelVisualRank, sortGrammarLevelsForDisplay } from '../../../shared/languageFeatures';
import './GrammarSelector.css';

interface GrammarSelectorProps {
  selected: TutorGrammarSelection[];
  onSelectionChange: (selected: TutorGrammarSelection[]) => void;
}

export const GrammarSelector: Component<GrammarSelectorProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { currentLangData, supportsGrammar, getGrammarLevelName } = useLanguage();
  const flashcardCtx = useFlashcards();

  const [searchQuery, setSearchQuery] = createSignal('');
  const [levelFilter, setLevelFilter] = createSignal<number | null>(null);
  const [grammarListRef, setGrammarListRef] = createSignal<HTMLDivElement | undefined>(undefined);

  // Collect all grammar points from the current language
  const allGrammarPoints = createMemo((): GrammarEntry[] => {
    const data = currentLangData();
    if (!data?.grammar) return [];
    const levelNames = data.grammarLevels?.names || {};
    return data.grammar.map((gp) => ({
      ...gp,
      levelName: getGrammarLevelLabel(gp.level, levelNames, data),
      visualLevel: getGrammarLevelVisualRank(gp.level, levelNames, data),
    }));
  });

  // Available level numbers for filter pills
  const availableLevels = createMemo(() => {
    const levels = new Set<number>();
    for (const gp of allGrammarPoints()) {
      levels.add(gp.level);
    }
    return sortGrammarLevelsForDisplay(Array.from(levels), currentLangData());
  });

  // Selected patterns set for O(1) lookup
  const selectedPatterns = createMemo(() => new Set(props.selected.map(s => s.pattern)));
  const grammarPatternCollator = createMemo(
    () => new Intl.Collator(settings.language, { usage: 'sort', sensitivity: 'base', numeric: true })
  );

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

    // Sort by language-defined level first, then by pattern (locale-aware).
    // Keep this deterministic so ordering does not jump around.
    return [...items].sort((a, b) => {
      if (a.level !== b.level) return compareGrammarLevelsForDisplay(a.level, b.level, currentLangData());
      return grammarPatternCollator().compare(a.pattern, b.pattern);
    });
  });

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

  if (!supportsGrammar()) {
    return (
      <EmptyState
        title={t('mlearn.AITutorSetup.NoGrammarSupport')}
      />
    );
  }

  return (
    <div class="grammar-selector">
      <CollapsibleStickyHeader
        class="grammar-header"
        getScrollContainer={grammarListRef}
      >
        <HintText>{t('mlearn.AITutorSetup.SelectGrammarHint')}</HintText>

        <div class="grammar-selector__filters">
          <Input
              value={searchQuery()}
              onInput={(e) => {
                setSearchQuery(e.currentTarget.value);
              }}
              placeholder={t('mlearn.AITutorSetup.SearchGrammar')}
          />
        </div>

        <LevelPillsFilter
          levels={availableLevels()}
          selectedLevel={levelFilter()}
          onLevelChange={(level) => {
            setLevelFilter(level);
          }}
          getLevelLabel={getGrammarLevelName}
          getVisualLevel={(level) => getGrammarLevelVisualRank(level, currentLangData()?.grammarLevels?.names, currentLangData())}
          allLabel={t('mlearn.AITutorSetup.AllLevels')}
        />

        {/*<Show when={props.selected.length > 0}>*/}
        <HintText>{t('mlearn.AITutorSetup.ItemsSelected', { count: String(props.selected.length) })}</HintText>
        {/*</Show>*/}

      </CollapsibleStickyHeader>

      <div
        class="grammar-selector__list"
        ref={setGrammarListRef}
      >
        <For each={filteredGrammar()}>
          {(gp) => {
            const knowledge = () => flashcardCtx.getGrammarKnowledge(gp.pattern);
            return (
              <SelectableCard
                selected={selectedPatterns().has(gp.pattern)}
                onClick={() => toggleGrammar(gp)}
                title={gp.pattern}
                badgeElement={<PillLabel level={gp.level} visualLevel={gp.visualLevel} size="xs">{gp.levelName}</PillLabel>}
                size="sm"
                class="grammar-selector__card"
                showCheckmark
              >
                <p class="grammar-selector__card-meaning">{gp.meaning}</p>
                <Show when={(knowledge()?.timesFailed ?? 0) > 0}>
                  <div class="grammar-selector__card-meta">
                    <Tag size="sm" variant={knowledge()!.ease < settings.easeThresholdLearning ? 'error' : knowledge()!.ease < settings.easeThresholdKnown ? 'warning' : 'default'}>
                      {`${knowledge()!.timesFailed}/${knowledge()!.timesEncountered}`}
                    </Tag>
                  </div>
                </Show>
              </SelectableCard>
            );
          }}
        </For>

      </div>
    </div>
  );
};
