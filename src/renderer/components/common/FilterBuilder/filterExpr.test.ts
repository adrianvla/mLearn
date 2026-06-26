import { describe, expect, it } from 'vitest';
import type {
  ComparisonOp,
  ExprNode,
  FieldResolver,
  FilterToken,
  NotToken,
  OperandToken,
  OperatorToken,
  ParenToken,
  ValidationError,
} from './filterExpr';
import {
  evaluateAst,
  evaluateFilter,
  parseTokens,
  tokensToDebugString,
  uniqueId,
  validateTokens,
} from './filterExpr';

let nextTokenId = 0;

function testId(): string {
  nextTokenId += 1;
  return `test-${nextTokenId}`;
}

function operand(field: string, value: string, op: ComparisonOp = 'eq'): OperandToken {
  return {
    instanceId: testId(),
    kind: 'operand',
    field,
    op,
    value,
  };
}

function operator(op: OperatorToken['op']): OperatorToken {
  return {
    instanceId: testId(),
    kind: 'operator',
    op,
  };
}

function notToken(): NotToken {
  return {
    instanceId: testId(),
    kind: 'not',
  };
}

function openParen(): ParenToken {
  return {
    instanceId: testId(),
    kind: 'paren',
    dir: 'open',
  };
}

function closeParen(): ParenToken {
  return {
    instanceId: testId(),
    kind: 'paren',
    dir: 'close',
  };
}

function node(field: string, value: string, op: ComparisonOp = 'eq'): ExprNode {
  return {
    kind: 'operand',
    field,
    op,
    value,
  };
}

function expectValid(tokens: FilterToken[]): void {
  expect(validateTokens(tokens)).toEqual({ ok: true });
}

function getValidationErrors(tokens: FilterToken[]): ValidationError[] {
  const result = validateTokens(tokens);

  if (result.ok) {
    throw new Error('Expected validation to fail');
  }

  return result.errors;
}

function expectValidationError(tokens: FilterToken[], error: ValidationError): void {
  expect(getValidationErrors(tokens)).toContainEqual(error);
}

interface TestRecord {
  status: string;
  level: number;
  source: string;
  recency: number;
  active: boolean;
  count: number;
  a: boolean;
  b: boolean;
  c: boolean;
}

const testRecord: TestRecord = {
  status: 'active',
  level: 5,
  source: 'anki',
  recency: 12,
  active: true,
  count: 3,
  a: false,
  b: true,
  c: true,
};

const testResolvers: Record<string, FieldResolver<TestRecord>> = {
  status: { read: record => record.status, valueLabel: value => value },
  level: { read: record => record.level, valueLabel: value => value },
  source: { read: record => record.source, valueLabel: value => value },
  recency: { read: record => record.recency, valueLabel: value => value },
  active: { read: record => record.active, valueLabel: value => value },
  count: { read: record => record.count, valueLabel: value => value },
  a: { read: record => record.a, valueLabel: value => value },
  b: { read: record => record.b, valueLabel: value => value },
  c: { read: record => record.c, valueLabel: value => value },
};

describe('validateTokens', () => {
  it('accepts an empty token array', () => {
    expectValid([]);
  });

  it('accepts a single operand', () => {
    expectValid([operand('status', 'active')]);
  });

  it('accepts A AND B', () => {
    expectValid([operand('status', 'active'), operator('AND'), operand('level', '5')]);
  });

  it('accepts A OR B', () => {
    expectValid([operand('status', 'active'), operator('OR'), operand('level', '5')]);
  });

  it('accepts NOT A', () => {
    expectValid([notToken(), operand('status', 'active')]);
  });

  it('accepts NOT NOT A', () => {
    expectValid([notToken(), notToken(), operand('status', 'active')]);
  });

  it('accepts A AND NOT B', () => {
    expectValid([operand('status', 'active'), operator('AND'), notToken(), operand('level', '5')]);
  });

  it('accepts (A OR B) AND C', () => {
    expectValid([
      openParen(),
      operand('status', 'active'),
      operator('OR'),
      operand('level', '5'),
      closeParen(),
      operator('AND'),
      operand('source', 'anki'),
    ]);
  });

  it('accepts nested parentheses', () => {
    expectValid([
      openParen(),
      openParen(),
      operand('status', 'active'),
      operator('OR'),
      operand('level', '5'),
      closeParen(),
      operator('AND'),
      openParen(),
      notToken(),
      operand('source', 'manual'),
      closeParen(),
      closeParen(),
    ]);
  });

  it('rejects A AND with trailing_operator', () => {
    expectValidationError([operand('status', 'active'), operator('AND')], { index: 1, message: 'trailing_operator' });
  });

  it('rejects AND A with expected_operand', () => {
    expectValidationError([operator('AND'), operand('status', 'active')], { index: 0, message: 'expected_operand' });
  });

  it('rejects adjacent operands with expected_operator', () => {
    expectValidationError([operand('status', 'active'), operand('level', '5')], { index: 1, message: 'expected_operator' });
  });

  it('rejects A AND AND B with expected_operand', () => {
    expectValidationError([
      operand('status', 'active'),
      operator('AND'),
      operator('AND'),
      operand('level', '5'),
    ], { index: 2, message: 'expected_operand' });
  });

  it('rejects (A OR B with unbalanced_parens', () => {
    expectValidationError([
      openParen(),
      operand('status', 'active'),
      operator('OR'),
      operand('level', '5'),
    ], { index: 3, message: 'unbalanced_parens' });
  });

  it('rejects A OR B) with unbalanced_parens', () => {
    expectValidationError([
      operand('status', 'active'),
      operator('OR'),
      operand('level', '5'),
      closeParen(),
    ], { index: 3, message: 'unbalanced_parens' });
  });

  it('rejects () with empty_subexpression', () => {
    expectValidationError([openParen(), closeParen()], { index: 1, message: 'empty_subexpression' });
  });

  it('rejects NOT alone with trailing_operator', () => {
    expectValidationError([notToken()], { index: 0, message: 'trailing_operator' });
  });

  it('rejects A NOT B with expected_operator', () => {
    expectValidationError([operand('status', 'active'), notToken(), operand('level', '5')], {
      index: 1,
      message: 'expected_operator',
    });
  });

  it('rejects )A( with unbalanced_parens and expected_operator', () => {
    const errors = getValidationErrors([closeParen(), operand('status', 'active'), openParen()]);
    expect(errors).toContainEqual({ index: 0, message: 'unbalanced_parens' });
    expect(errors).toContainEqual({ index: 2, message: 'expected_operator' });
  });

  it('rejects an open parenthesis after an operand', () => {
    expectValidationError([operand('status', 'active'), openParen(), operand('level', '5'), closeParen()], {
      index: 1,
      message: 'expected_operator',
    });
  });

  it('rejects an operator immediately after an open parenthesis', () => {
    expectValidationError([openParen(), operator('AND'), operand('status', 'active'), closeParen()], {
      index: 1,
      message: 'expected_operand',
    });
  });

  it('rejects a close parenthesis after an operator in a subexpression', () => {
    expectValidationError([openParen(), operand('status', 'active'), operator('AND'), closeParen()], {
      index: 3,
      message: 'expected_operand',
    });
  });
});

describe('parseTokens', () => {
  it('parses a single operand', () => {
    expect(parseTokens([operand('status', 'active')])).toEqual(node('status', 'active'));
  });

  it('parses unary NOT', () => {
    expect(parseTokens([notToken(), operand('active', 'true')])).toEqual({
      kind: 'not',
      operand: node('active', 'true'),
    });
  });

  it('parses double NOT as nested not nodes', () => {
    expect(parseTokens([notToken(), notToken(), operand('active', 'true')])).toEqual({
      kind: 'not',
      operand: {
        kind: 'not',
        operand: node('active', 'true'),
      },
    });
  });

  it('parses AND nodes', () => {
    expect(parseTokens([operand('status', 'active'), operator('AND'), operand('level', '5')])).toEqual({
      kind: 'and',
      left: node('status', 'active'),
      right: node('level', '5'),
    });
  });

  it('parses OR nodes', () => {
    expect(parseTokens([operand('status', 'active'), operator('OR'), operand('level', '5')])).toEqual({
      kind: 'or',
      left: node('status', 'active'),
      right: node('level', '5'),
    });
  });

  it('parses A OR B AND C as A OR (B AND C)', () => {
    expect(parseTokens([
      operand('a', 'true'),
      operator('OR'),
      operand('b', 'true'),
      operator('AND'),
      operand('c', 'true'),
    ])).toEqual({
      kind: 'or',
      left: node('a', 'true'),
      right: {
        kind: 'and',
        left: node('b', 'true'),
        right: node('c', 'true'),
      },
    });
  });

  it('parses A AND B OR C as (A AND B) OR C', () => {
    expect(parseTokens([
      operand('a', 'true'),
      operator('AND'),
      operand('b', 'true'),
      operator('OR'),
      operand('c', 'true'),
    ])).toEqual({
      kind: 'or',
      left: {
        kind: 'and',
        left: node('a', 'true'),
        right: node('b', 'true'),
      },
      right: node('c', 'true'),
    });
  });

  it('lets parentheses override precedence', () => {
    expect(parseTokens([
      openParen(),
      operand('a', 'true'),
      operator('OR'),
      operand('b', 'true'),
      closeParen(),
      operator('AND'),
      operand('c', 'true'),
    ])).toEqual({
      kind: 'and',
      left: {
        kind: 'or',
        left: node('a', 'true'),
        right: node('b', 'true'),
      },
      right: node('c', 'true'),
    });
  });

  it('parses nested NOT around a parenthesized expression', () => {
    expect(parseTokens([
      notToken(),
      openParen(),
      operand('a', 'true'),
      operator('OR'),
      operand('b', 'true'),
      closeParen(),
    ])).toEqual({
      kind: 'not',
      operand: {
        kind: 'or',
        left: node('a', 'true'),
        right: node('b', 'true'),
      },
    });
  });
});

describe('evaluateAst', () => {
  it('evaluates eq as true when String(resolved) matches the operand value', () => {
    expect(evaluateAst(node('status', 'active'), testRecord, testResolvers)).toBe(true);
  });

  it('evaluates eq as false when String(resolved) does not match the operand value', () => {
    expect(evaluateAst(node('status', 'unknown'), testRecord, testResolvers)).toBe(false);
  });

  it('evaluates neq with strict string inequality', () => {
    expect(evaluateAst(node('status', 'unknown', 'neq'), testRecord, testResolvers)).toBe(true);
    expect(evaluateAst(node('status', 'active', 'neq'), testRecord, testResolvers)).toBe(false);
  });

  it('evaluates in using comma-separated membership', () => {
    expect(evaluateAst(node('source', 'anki,manual', 'in'), testRecord, testResolvers)).toBe(true);
    expect(evaluateAst(node('source', 'manual,cloud', 'in'), testRecord, testResolvers)).toBe(false);
  });

  it('evaluates gte and lte numerically', () => {
    expect(evaluateAst(node('level', '4', 'gte'), testRecord, testResolvers)).toBe(true);
    expect(evaluateAst(node('level', '5', 'lte'), testRecord, testResolvers)).toBe(true);
    expect(evaluateAst(node('level', '6', 'gte'), testRecord, testResolvers)).toBe(false);
    expect(evaluateAst(node('level', '4', 'lte'), testRecord, testResolvers)).toBe(false);
  });

  it('returns false when an operand field has no resolver', () => {
    expect(evaluateAst(node('missing', 'value'), testRecord, testResolvers)).toBe(false);
  });

  it('returns false for non-numeric gte and lte comparisons', () => {
    expect(evaluateAst(node('status', '4', 'gte'), testRecord, testResolvers)).toBe(false);
    expect(evaluateAst(node('status', '4', 'lte'), testRecord, testResolvers)).toBe(false);
  });

  it('evaluates NOT A where A is true as false', () => {
    expect(evaluateAst({ kind: 'not', operand: node('active', 'true') }, testRecord, testResolvers)).toBe(false);
  });

  it('evaluates (A OR B) AND C with A=false, B=true, C=true as true', () => {
    const ast: ExprNode = {
      kind: 'and',
      left: {
        kind: 'or',
        left: node('a', 'true'),
        right: node('b', 'true'),
      },
      right: node('c', 'true'),
    };

    expect(evaluateAst(ast, testRecord, testResolvers)).toBe(true);
  });

  it('short-circuits AND when the left side is false', () => {
    const ast: ExprNode = {
      kind: 'and',
      left: node('missing', 'value'),
      right: node('throws', 'value'),
    };
    const resolvers: Record<string, FieldResolver<TestRecord>> = {
      throws: {
        read: () => {
          throw new Error('AND should short-circuit');
        },
        valueLabel: value => value,
      },
    };

    expect(evaluateAst(ast, testRecord, resolvers)).toBe(false);
  });

  it('short-circuits OR when the left side is true', () => {
    const ast: ExprNode = {
      kind: 'or',
      left: node('active', 'true'),
      right: node('throws', 'value'),
    };
    const resolvers: Record<string, FieldResolver<TestRecord>> = {
      active: testResolvers.active,
      throws: {
        read: () => {
          throw new Error('OR should short-circuit');
        },
        valueLabel: value => value,
      },
    };

    expect(evaluateAst(ast, testRecord, resolvers)).toBe(true);
  });
});

describe('evaluateFilter', () => {
  it('returns ok:false for invalid tokens', () => {
    const result = evaluateFilter([operand('status', 'active'), operator('AND')], testRecord, testResolvers);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({ index: 1, message: 'trailing_operator' });
    }
  });

  it('returns ok:true with an AST and result for valid tokens', () => {
    const result = evaluateFilter([
      operand('status', 'active'),
      operator('AND'),
      operand('level', '5'),
    ], testRecord, testResolvers);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected evaluateFilter to succeed');
    }
    expect(result.result).toBe(true);
    expect(result.ast).toEqual({
      kind: 'and',
      left: node('status', 'active'),
      right: node('level', '5'),
    });
  });

  it('treats empty tokens as match all', () => {
    const result = evaluateFilter([], testRecord, testResolvers);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected evaluateFilter to succeed');
    }
    expect(result.result).toBe(true);
  });
});

describe('tokensToDebugString', () => {
  it('formats a readable token stream', () => {
    expect(tokensToDebugString([
      operand('status', 'unknown'),
      operator('AND'),
      openParen(),
      operand('level', '5'),
      operator('OR'),
      operand('level', '4'),
      closeParen(),
    ])).toBe('status=unknown AND ( level=5 OR level=4 )');
  });

  it('formats every comparison operator', () => {
    expect(tokensToDebugString([
      operand('status', 'active', 'neq'),
      operator('AND'),
      operand('source', 'anki,manual', 'in'),
      operator('AND'),
      operand('level', '4', 'gte'),
      operator('AND'),
      operand('recency', '30', 'lte'),
    ])).toBe('status!=active AND source in anki,manual AND level>=4 AND recency<=30');
  });
});

describe('uniqueId', () => {
  it('returns prefixed unique ids', () => {
    const first = uniqueId();
    const second = uniqueId();

    expect(first).toMatch(/^ft-\d+-[a-z0-9]+$/);
    expect(second).toMatch(/^ft-\d+-[a-z0-9]+$/);
    expect(first).not.toBe(second);
  });
});
