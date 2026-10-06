import type { LanguageData, GrammarPracticeItemSource } from '../../shared/types';
import { deriveMockBlueprints, type MockBlueprint } from './mockExam';
import { assembleContrastItem, isDeliverableItem, questionBankFromLanguageData } from './questionBank';
import { questionValidationFreshness } from './questionValidation';

export type MockBlueprintAvailabilityState =
  | 'available'
  | 'insufficient-coverage'
  | 'validation-required'
  | 'validation-stale'
  | 'validation-rejected';

export interface MockBlueprintAvailability {
  state: MockBlueprintAvailabilityState;
  blueprint: MockBlueprint;
  sourceCount: number;
  deliverableCount: number;
  availableGroups: number;
  requestedGroups: number;
  unreviewedCount: number;
  staleCount: number;
  rejectedCount: number;
  patterns: string[];
}

export type MockAvailabilityState =
  | 'missing-sources'
  | 'missing-blueprint'
  | 'requested-blueprint-unavailable'
  | MockBlueprintAvailabilityState;

export interface MockExamAvailability {
  state: MockAvailabilityState;
  sourceCount: number;
  blueprints: MockBlueprintAvailability[];
}

type SourceState = 'deliverable' | 'missing' | 'stale' | 'rejected';

function sourceState(language: string, pattern: string, source: GrammarPracticeItemSource): SourceState {
  if (questionValidationFreshness(language, pattern, source) === 'stale') return 'stale';
  const item = assembleContrastItem(source, { language, pattern });
  if (item.validation.deterministic.status === 'rejected' || item.validation.semantic?.status === 'rejected') return 'rejected';
  if (isDeliverableItem(item)) return 'deliverable';
  return 'missing';
}

function blueprintAvailability(language: string, data: LanguageData, blueprint: MockBlueprint): MockBlueprintAvailability {
  const bank = questionBankFromLanguageData(language, data);
  let sourceCount = 0;
  let deliverableCount = 0;
  let unreviewedCount = 0;
  let staleCount = 0;
  let rejectedCount = 0;
  let availableGroups = 0;

  for (const section of blueprint.sections) {
    let sectionAvailableGroups = 0;
    for (const pattern of section.patterns) {
      const sources = bank.itemsByPattern.get(pattern) ?? [];
      const states = sources.map(source => sourceState(language, pattern, source));
      sourceCount += sources.length;
      deliverableCount += states.filter(state => state === 'deliverable').length;
      unreviewedCount += states.filter(state => state === 'missing').length;
      staleCount += states.filter(state => state === 'stale').length;
      rejectedCount += states.filter(state => state === 'rejected').length;
      if (states.includes('deliverable')) sectionAvailableGroups += 1;
    }
    availableGroups += Math.min(section.requestedCount, sectionAvailableGroups);
  }

  const requestedGroups = blueprint.sections.reduce((sum, section) => sum + section.requestedCount, 0);
  let state: MockBlueprintAvailabilityState;
  if (availableGroups >= requestedGroups && requestedGroups > 0) state = 'available';
  else if (availableGroups > 0) state = 'insufficient-coverage';
  else if (staleCount > 0) state = 'validation-stale';
  else if (rejectedCount > 0) state = 'validation-rejected';
  else state = 'validation-required';

  return {
    state,
    blueprint,
    sourceCount,
    deliverableCount,
    availableGroups,
    requestedGroups,
    unreviewedCount,
    staleCount,
    rejectedCount,
    patterns: blueprint.sections.flatMap(section => section.patterns),
  };
}

/**
 * Describes package admission without loosening the independent semantic
 * validation gate used by the actual mock assembler.
 */
export function inspectMockExamAvailability(
  language: string,
  data: LanguageData,
  requestedLevel?: number,
): MockExamAvailability {
  const bank = questionBankFromLanguageData(language, data);
  const sourceCount = [...bank.itemsByPattern.values()].reduce((sum, sources) => sum + sources.length, 0);
  if (sourceCount === 0) return { state: 'missing-sources', sourceCount, blueprints: [] };

  const allBlueprints = deriveMockBlueprints(language, data);
  if (allBlueprints.length === 0) return { state: 'missing-blueprint', sourceCount, blueprints: [] };
  const selected = requestedLevel === undefined
    ? allBlueprints
    : allBlueprints.filter(blueprint => blueprint.level === requestedLevel);
  if (selected.length === 0) return { state: 'requested-blueprint-unavailable', sourceCount, blueprints: [] };

  const blueprints = selected.map(blueprint => blueprintAvailability(language, data, blueprint));
  const state = blueprints.some(entry => entry.state === 'available')
    ? 'available'
    : blueprints.some(entry => entry.state === 'insufficient-coverage')
      ? 'insufficient-coverage'
      : blueprints.some(entry => entry.state === 'validation-stale')
        ? 'validation-stale'
        : blueprints.some(entry => entry.state === 'validation-rejected')
          ? 'validation-rejected'
          : 'validation-required';
  return { state, sourceCount, blueprints };
}
