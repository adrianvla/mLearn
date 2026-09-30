import { Component, For } from 'solid-js';
import { CheckboxCard } from '../common';
import { useLocalization } from '../../context';
import type { RepairAspect, RepairSelection } from '../../utils/flashcardRepairPlan';
import './FlashcardRepairOptions.css';

export const FlashcardRepairOptions: Component<{
  counts: Record<RepairAspect, number>;
  selection: RepairSelection;
  onChange: (aspect: RepairAspect, enabled: boolean) => void;
}> = (props) => {
  const { t } = useLocalization();
  const aspects: RepairAspect[] = ['content', 'example', 'exampleMeaning', 'wordAudio', 'exampleAudio'];
  return (
    <div class="flashcard-repair-options">
      <For each={aspects}>{(aspect) => (
        <CheckboxCard
          title={t(`mlearn.Flashcards.Repair.Aspects.${aspect}`, { count: props.counts[aspect] })}
          checked={props.selection[aspect]}
          onChange={(enabled) => props.onChange(aspect, enabled)}
        />
      )}</For>
    </div>
  );
};
