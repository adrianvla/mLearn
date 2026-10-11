import { describe, expect, it } from 'vitest';
import { retrievalStageScaffolds, isAccessMeasurable } from './knowledgeEvents';
import { composeRetrievalStages } from './encounterComposition';

function oracleMinimumPartition(stages: Array<{ id: string; cueKey: string; targets: string[]; suppliedAccesses: string[] }>): number {
  const canOrder = (group: typeof stages): boolean => {
    const search = (remaining: typeof stages, ordered: typeof stages): boolean => {
      if (!remaining.length) return true;
      return remaining.some((stage, index) => {
        // A supplied answer may appear only after every stage that requests it.
        if (ordered.some(prior => prior.suppliedAccesses.some(access => stage.targets.includes(access)))) return false;
        return search([...remaining.slice(0, index), ...remaining.slice(index + 1)], [...ordered, stage]);
      });
    };
    return search(group, []);
  };
  const cover = (remaining: typeof stages, groups: Array<typeof stages[number][]>, best: number): number => {
    if (!remaining.length) return Math.min(best, groups.length);
    if (groups.length >= best) return best;
    const [next, ...tail] = remaining;
    let result = cover(tail, [[next], ...groups], best);
    for (let index = 0; index < groups.length; index++) {
      const candidate = [...groups[index], next];
      if (canOrder(candidate)) {
        const updated = groups.map((group, groupIndex) => groupIndex === index ? candidate : group);
        result = cover(tail, updated, result);
      }
    }
    return result;
  };
  return cover(stages, [], stages.length);
}

describe('encounter cue composition', () => {
  it('records only cues admitted before a target, preserving unknown future conditions', () => {
    const task = { taskTemplateId: 'future', inputModality: 'written', responseModality: 'self', supplied: [],
      requested: ['x:form', 'x:relation'], fluencyRequired: false, ratingMode: 'profile' as const, stages: [
        { id: 'first', supplied: ['x:context'], requested: ['x:form'] },
        { id: 'later', supplied: ['x:form'], requested: ['x:relation'] },
      ] };
    const first = retrievalStageScaffolds(task, 'x:form');
    const later = retrievalStageScaffolds(task, 'x:relation');
    expect(isAccessMeasurable('x:form', first)).toBe(true);
    expect(later?.['provided-access:x:form']).toBe(true);
    expect(later?.['provided-access:x:context']).toBe(true);
    expect(isAccessMeasurable('x:relation', later)).toBe(true);
    expect(retrievalStageScaffolds(task, 'x:form', { audio: true }, { first: {} })?.audio).toBeUndefined();
    expect(retrievalStageScaffolds(task, 'x:relation', { audio: true }, { first: {} })?.audio).toBe(true);
    expect(isAccessMeasurable('x:form', retrievalStageScaffolds(task, 'x:form', { 'provided-access:x:form': true }))).toBe(false);
    expect(isAccessMeasurable('x:form', retrievalStageScaffolds(task, 'x:form', { 'prior-cue-exposure': true, 'provided-access:x:form': true }, { first: {} }))).toBe(false);
  });
  it('coalesces compatible targets and orders an acyclic supplied-answer dependency', () => {
    const result = composeRetrievalStages([
      { id: 'later', cueKey: 'with-form', targets: ['x-future:discourse'], suppliedAccesses: ['x-future:form'] },
      { id: 'first', cueKey: 'written', targets: ['x-future:form'], suppliedAccesses: [] },
      { id: 'meaning', cueKey: 'written', targets: ['x-future:sense'], suppliedAccesses: [] },
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].map(stage => stage.id)).toEqual(['first', 'later']);
    expect(result.groups[0][0].targets).toEqual(['x-future:form', 'x-future:sense']);
    expect(result.groups[0][0].sourceStageIds).toEqual(['first', 'meaning']);
    expect(result.invalid).toEqual([]);
  });
  it('uses an independent stage to form the smallest safe partition around a cycle', () => {
    const stages = [
      { id: 'a', cueKey: 'cue-a', targets: ['x:a'], suppliedAccesses: ['x:b'] },
      { id: 'b', cueKey: 'cue-b', targets: ['x:b'], suppliedAccesses: ['x:a'] },
      { id: 'c', cueKey: 'cue-c', targets: ['x:c'], suppliedAccesses: [] },
    ];
    const result = composeRetrievalStages(stages);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.map(group => group.map(stage => stage.id))).toEqual([['a', 'c'], ['b']]);
    expect(result.groups.flatMap(group => group.flatMap(stage => stage.targets)).sort()).toEqual(['x:a', 'x:b', 'x:c']);
    expect(result.invalid).toEqual([]);
  });
  it('reports malformed self-supplied stages without silently treating their targets as taught', () => {
    const result = composeRetrievalStages([{ id: 'bad', cueKey: 'self', targets: ['x:a'], suppliedAccesses: ['x:a'] }]);
    expect(result.groups).toEqual([]);
    expect(result.invalid).toEqual([{ id: 'bad', reason: 'self-supplied-target' }]);
  });
  it('matches an independent exhaustive oracle for small mixed dependency graphs and input permutations', () => {
    const stages = [
      { id: 'a', cueKey: 'a', targets: ['x'], suppliedAccesses: ['y'] },
      { id: 'b', cueKey: 'b', targets: ['y'], suppliedAccesses: ['x'] },
      { id: 'c', cueKey: 'c', targets: ['z'], suppliedAccesses: [] },
      { id: 'd', cueKey: 'd', targets: ['w'], suppliedAccesses: ['z'] },
    ];
    const expected = oracleMinimumPartition(stages);
    expect(expected).toBe(2);
    for (const permutation of [stages, [...stages].reverse(), [stages[2], stages[0], stages[3], stages[1]]]) {
      const result = composeRetrievalStages(permutation);
      expect(result.method).toBe('exact');
      expect(result.groups).toHaveLength(expected);
      expect(result.groups.flatMap(group => group.flatMap(stage => stage.targets)).sort()).toEqual(['w', 'x', 'y', 'z']);
    }
  });
  it('retains compatible repeated cue declarations and reports duplicate stage identities', () => {
    const result = composeRetrievalStages([
      { id: 'same', cueKey: 'written', targets: ['a'], suppliedAccesses: [] },
      { id: 'same', cueKey: 'written', targets: ['b'], suppliedAccesses: [] },
      { id: 'other', cueKey: 'written', targets: ['c'], suppliedAccesses: [] },
    ]);
    expect(result.groups.flatMap(group => group.flatMap(stage => stage.targets)).sort()).toEqual(['a', 'c']);
    expect(result.invalid).toEqual([{ id: 'same', reason: 'duplicate-identity' }]);
  });
});
