import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { LevelPillsFilter } from './LevelPillsFilter';

describe('LevelPillsFilter', () => {
  it('uses caller-provided visual levels for pill colors while preserving raw levels', () => {
    const container = document.createElement('div');
    const dispose = render(() => (
      <LevelPillsFilter
        allLabel="All"
        levels={[1, 2]}
        selectedLevel={null}
        onLevelChange={() => {}}
        getLevelLabel={(level) => `Band ${level}`}
        getVisualLevel={(level) => 6 - level}
      />
    ), container);

    const pills = Array.from(container.querySelectorAll('.label-pill'));
    const firstLevelPill = pills.find((pill) => pill.textContent?.includes('Band 1'));

    expect(firstLevelPill?.getAttribute('data-raw-level')).toBe('1');
    expect(firstLevelPill?.getAttribute('data-level')).toBe('5');

    dispose();
  });
});
