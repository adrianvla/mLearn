import { describe, expect, it } from 'vitest';
import {
  LEARNER_CLAIM_TOOLS,
  buildClaimPromptContext,
  capabilityLabelKey,
  parseClaimToolCalls,
} from './learnerClaimsInterpreter';
import type { LLMToolCall } from '../../shared/types';

const call = (name: string, args: Record<string, unknown>): LLMToolCall => ({
  id: `tc-${name}`,
  name,
  arguments: args,
});

describe('learner claims interpreter', () => {
  it('parses the narrow tool set into typed claim ops', () => {
    const ops = parseClaimToolCalls([
      call('set_access_claim', { capability: 'spoken-recognition', status: 'known' }),
      call('clear_access_claim', { capability: 'surface-reading' }),
      call('set_word_claim', { status: 'learning' }),
      call('clear_word_claim', {}),
    ]);
    expect(ops).toEqual([
      { op: 'setAccessClaim', capability: 'spoken-recognition', status: 'known' },
      { op: 'clearAccessClaim', capability: 'surface-reading' },
      { op: 'setWordClaim', status: 'learning' },
      { op: 'clearWordClaim' },
    ]);
  });

  it('drops unknown tools and malformed arguments (acceptance M: zero fabricated evidence)', () => {
    const ops = parseClaimToolCalls([
      call('write_evidence', { quality: 'fluent' }),
      call('fabricate_attempt', { attemptId: 'x' }),
      call('set_access_claim', { capability: 'spoken-recognition', status: 'fluent' }),
      call('set_access_claim', { status: 'known' }),
      call('set_access_claim', { capability: '' , status: 'known' }),
      call('set_word_claim', {}),
    ]);
    expect(ops).toEqual([]);
  });

  it('exposes only claim/policy tools — never evidence writers', () => {
    const names = LEARNER_CLAIM_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(['set_access_claim', 'clear_access_claim', 'set_word_claim', 'clear_word_claim']);
    for (const forbidden of ['writeEvidence', 'setKnowledge', 'recordAttempt', 'fabricateAttempt']) {
      expect(names).not.toContain(forbidden.toLowerCase());
    }
  });

  it('accepts namespaced package capability ids untouched (open world)', () => {
    const ops = parseClaimToolCalls([
      call('set_access_claim', { capability: 'x-acme::classifier', status: 'learning' }),
    ]);
    expect(ops).toEqual([{ op: 'setAccessClaim', capability: 'x-acme::classifier', status: 'learning' }]);
  });

  it('builds a compact deterministic context (no graph fetches)', () => {
    const context = buildClaimPromptContext({
      word: '苗字',
      reading: 'みょうじ',
      language: 'ja',
      accessStates: { 'sense-recognition': 'known', 'surface-reading': undefined },
      wordClaim: null,
      componentCharacters: ['苗', '字'],
    });
    expect(context).toContain('Current word: 苗字 (みょうじ)');
    expect(context).toContain('sense-recognition=known');
    expect(context).not.toContain('surface-reading='); // unmeasured stays absent
    expect(context).toContain('Whole-word claim: none');
    expect(context).toContain('苗 字');
  });

  it('maps capability ids to their localization labels', () => {
    expect(capabilityLabelKey('spoken-recognition')).toBe('mlearn.Knowledge.Capability.spoken-recognition');
    expect(capabilityLabelKey('x-acme::classifier')).toBe('mlearn.Knowledge.Capability.x-acme::classifier');
  });
});
