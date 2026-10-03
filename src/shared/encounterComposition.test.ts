import { describe, expect, it } from 'vitest';
import { retrievalStageScaffolds, isAccessMeasurable } from './knowledgeEvents';
import { composeRetrievalStages } from './encounterComposition';
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
    expect(result).toHaveLength(1);
    expect(result[0].map(stage => stage.id)).toEqual(['first', 'later']);
    expect(result[0][0].targets).toEqual(['x-future:form', 'x-future:sense']);
  });
  it('separates contamination cycles and refuses a stage that supplies its own target', () => {
    expect(composeRetrievalStages([
      { id: 'a', cueKey: 'cue-a', targets: ['x:a'], suppliedAccesses: ['x:b'] },
      { id: 'b', cueKey: 'cue-b', targets: ['x:b'], suppliedAccesses: ['x:a'] },
    ])).toHaveLength(2);
    expect(composeRetrievalStages([{ id: 'bad', cueKey: 'self', targets: ['x:a'], suppliedAccesses: ['x:a'] }])).toEqual([]);
  });
});
