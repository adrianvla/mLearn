import { describe, expect, it } from 'vitest';
import { homeNextAction, type HomeWorkload } from './homeNextAction';
const empty: HomeWorkload = { due: 0, needsPractice: 0, unassessed: 0, assessed: 0, hasMaterial: false };
describe('the next learner activity', () => {
  it('prioritizes the scheduled workload over assessment and exploration', () => {
    expect(homeNextAction({ ...empty, due: 14, needsPractice: 25, assessed: 60, unassessed: 30, hasMaterial: true })).toBe('review');
  });
  it('uses recorded difficulties for practice before measuring more words', () => {
    expect(homeNextAction({ ...empty, needsPractice: 25, assessed: 60, unassessed: 30 })).toBe('practice');
  });
  it('offers a returning learner assessment when there is an actual evidence gap', () => {
    expect(homeNextAction({ ...empty, assessed: 60, unassessed: 30 })).toBe('assessment');
  });
  it('does not send a completely new learner through a placement funnel', () => {
    expect(homeNextAction({ ...empty, unassessed: 30000 })).toBe('read');
  });
  it('returns to material after the study workload is clear', () => {
    expect(homeNextAction({ ...empty, hasMaterial: true })).toBe('continue');
  });
});
