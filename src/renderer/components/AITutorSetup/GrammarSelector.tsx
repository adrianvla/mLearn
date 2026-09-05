/**
 * GrammarSelector
 * Allows the user to search, filter by level, and select grammar points for AI tutor sessions.
 * Only rendered when the current language supports grammar data.
 */

import { Component, createSignal, createMemo, For } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { useLanguage, type GrammarEntry } from '../../context/LanguageContext';
import { useFlashcards } from '../../context/FlashcardContext';
import { Input, SelectableCard, PillLabel, EmptyState, HintText, LevelPillsFilter, CollapsibleStickyHeader, HoverReveal } from '../common';
import type { TutorGrammarSelection } from '../../../shared/types';
import { compareGrammarLevelsForDisplay, getGrammarLevelLabel, getGrammarLevelVisualRank, sortGrammarLevelsForDisplay } from '../../../shared/languageFeatures';
import { SRS_EASE, type WordStatus } from '../../../shared/constants';
import { classifyGrammarStatus } from '../../../shared/utils/grammarPolicy';
import { knowledgeStatusLabelKey } from '../common/WordStatusPillKnowledge/knowledgeSummary';
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
            // Tier-2 read: the materialized grammar cache IS the replayed
            // grammar-recognition projection. Classification goes through the
            // tested grammar classifier (grammarPolicy) with the canonical
            // SRS anchors — exposure-only encounter bumps (1.3–1.55) stay
            // Unknown: observation alone demonstrates nothing. No entry means
            // Untracked — no measurement, not "unknown".
            const grammarStatus = () => {
              const entry = knowledge();
              if (!entry) return { status: 'unknown' as WordStatus, untracked: true, basis: 'unmeasured' as const };
              return {
                status: classifyGrammarStatus(entry.ease, { learning: SRS_EASE.DEFAULT_LEARNING, known: SRS_EASE.DEFAULT_KNOWN }),
                untracked: false,
                basis: 'evidence' as const,
              };
            };
            const statusLabel = () => t(knowledgeStatusLabelKey(grammarStatus().status, grammarStatus().basis, grammarStatus().untracked));
            const failureLabel = () => t('mlearn.AITutorSetup.GrammarFailureStats', {
              failed: String(knowledge()?.timesFailed ?? 0),
              seen: String(knowledge()?.timesEncountered ?? 0),
            });
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
                <HoverReveal
                  icon={<span class={`grammar-selector__status grammar-selector__status--${grammarStatus().untracked ? 'untracked' : grammarStatus().status}`}>{statusLabel()}</span>}
                  label={knowledge() ? `${statusLabel()} · ${failureLabel()}` : statusLabel()}
                  title={failureLabel()}
                  class="grammar-selector__card-meta"
                  onClick={(e) => e.stopPropagation()}
                />
              </SelectableCard>
            );
          }}
        </For>

      </div>
    </div>
  );
};
