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
  it('keeps recognition of 内科 after the ないか scaffold separate from independent reading', () => {
    // Model reports lexical recognition, but overstates the cue-dependent access.
    expect(parseClaimToolCalls([
      call('set_word_claim', { status: 'known' }),
      call('set_access_claim', { capability: 'surface-reading', status: 'known', basis: 'cue-dependent' }),
    ])).toEqual([
      { op: 'setWordClaim', status: 'known' },
      { op: 'setAccessClaim', capability: 'surface-reading', status: 'learning' },
    ]);
  });

  it('parses the narrow tool set into typed claim ops', () => {
    const ops = parseClaimToolCalls([
      call('set_access_claim', { capability: 'spoken-recognition', status: 'known', basis: 'unassisted' }),
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

  it.each(['surface-reading', 'sense-recognition', 'prosodic-pattern', 'x-acme::relation'])(
    'does not promote required-cue retrieval for %s to known', (capability) => {
      expect(parseClaimToolCalls([
        call('set_access_claim', { capability, status: 'known', basis: 'cue-dependent' }),
      ])).toEqual([{ op: 'setAccessClaim', capability, status: 'learning' }]);
    },
  );

  it.each(['learning', 'unknown'] as const)('preserves explicit %s retrieval without the cue', (status) => {
    expect(parseClaimToolCalls([
      call('set_access_claim', { capability: 'surface-reading', status, basis: 'cue-dependent' }),
    ])).toEqual([{ op: 'setAccessClaim', capability: 'surface-reading', status }]);
  });

  it.each(['known', 'learning', 'unknown'])('cue-only recognition cannot establish %s independent ability', (status) => {
    expect(parseClaimToolCalls([
      call('set_access_claim', { capability: 'surface-reading', status, basis: 'cue-only' }),
    ])).toEqual([]);
  });

  it.each([undefined, null, '', 'invented', {}, []])('drops an access claim with invalid basis %j', (basis) => {
    expect(parseClaimToolCalls([
      call('set_access_claim', { capability: 'surface-reading', status: 'known', basis }),
    ])).toEqual([]);
  });

  it('keeps independently stated abilities and withdrawals alongside cue dependence', () => {
    expect(parseClaimToolCalls([
      call('set_access_claim', { capability: 'surface-reading', status: 'known', basis: 'cue-dependent' }),
      call('set_access_claim', { capability: 'spoken-recognition', status: 'known', basis: 'unassisted' }),
      call('set_access_claim', { capability: 'x-acme::relation', status: 'unknown', basis: 'unassisted' }),
      call('clear_access_claim', { capability: 'prosodic-pattern' }),
    ])).toEqual([
      { op: 'setAccessClaim', capability: 'surface-reading', status: 'learning' },
      { op: 'setAccessClaim', capability: 'spoken-recognition', status: 'known' },
      { op: 'setAccessClaim', capability: 'x-acme::relation', status: 'unknown' },
      { op: 'clearAccessClaim', capability: 'prosodic-pattern' },
    ]);
  });

  it('drops unknown tools and malformed arguments (acceptance M: zero fabricated evidence)', () => {
    const ops = parseClaimToolCalls([
      call('write_evidence', { quality: 'fluent' }),
      call('fabricate_attempt', { attemptId: 'x' }),
      call('set_access_claim', { capability: 'spoken-recognition', status: 'fluent', basis: 'unassisted' }),
      call('set_access_claim', { status: 'known', basis: 'unassisted' }),
      call('set_access_claim', { capability: '', status: 'known', basis: 'unassisted' }),
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
      call('set_access_claim', { capability: 'x-acme::classifier', status: 'learning', basis: 'unassisted' }),
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
