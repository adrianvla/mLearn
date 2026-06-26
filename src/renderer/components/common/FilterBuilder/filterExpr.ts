export type ComparisonOp = 'eq' | 'neq' | 'in' | 'gte' | 'lte';

export interface OperandToken {
  instanceId: string;
  kind: 'operand';
  field: string;
  op: ComparisonOp;
  value: string;
}

export interface OperatorToken {
  instanceId: string;
  kind: 'operator';
  op: 'AND' | 'OR';
}

export interface NotToken {
  instanceId: string;
  kind: 'not';
}

export interface ParenToken {
  instanceId: string;
  kind: 'paren';
  dir: 'open' | 'close';
}

export type FilterToken = OperandToken | OperatorToken | NotToken | ParenToken;

export type ExprNode =
  | { kind: 'operand'; field: string; op: ComparisonOp; value: string }
  | { kind: 'and'; left: ExprNode; right: ExprNode }
  | { kind: 'or'; left: ExprNode; right: ExprNode }
  | { kind: 'not'; operand: ExprNode };

export interface ValidationError {
  index: number;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

export interface FieldResolver<R> {
  read: (record: R) => unknown;
  valueLabel: (value: string) => string;
}

export type EvalResult<R> = [R] extends [unknown]
  ? { ok: true; ast: ExprNode; result: boolean } | { ok: false; errors: ValidationError[] }
  : never;

let _idCounter = 0;

export function uniqueId(): string {
  _idCounter += 1;
  return `ft-${_idCounter}-${Date.now().toString(36)}`;
}

export function validateTokens(tokens: FilterToken[]): ValidationResult {
  if (tokens.length === 0) {
    return { ok: true };
  }

  const errors: ValidationError[] = [];
  let expectOperand = true;
  let depth = 0;
  let previousToken: FilterToken | undefined;

  tokens.forEach((token, index) => {
    if (token.kind === 'operand') {
      if (!expectOperand) {
        errors.push({ index, message: 'expected_operator' });
      } else {
        expectOperand = false;
      }
    } else if (token.kind === 'operator') {
      if (expectOperand) {
        errors.push({ index, message: 'expected_operand' });
      } else {
        expectOperand = true;
      }
    } else if (token.kind === 'not') {
      if (!expectOperand) {
        errors.push({ index, message: 'expected_operator' });
      }
    } else if (token.dir === 'open') {
      if (!expectOperand) {
        errors.push({ index, message: 'expected_operator' });
      } else {
        depth += 1;
      }
    } else if (depth === 0) {
      errors.push({ index, message: 'unbalanced_parens' });
    } else if (expectOperand) {
      const message = previousToken?.kind === 'paren' && previousToken.dir === 'open'
        ? 'empty_subexpression'
        : 'expected_operand';
      errors.push({ index, message });
      depth -= 1;
      expectOperand = false;
    } else {
      depth -= 1;
      expectOperand = false;
    }

    previousToken = token;
  });

  if (depth > 0) {
    errors.push({ index: tokens.length - 1, message: 'unbalanced_parens' });
  }

  if (expectOperand) {
    const lastToken = tokens[tokens.length - 1];
    const message = lastToken.kind === 'paren' && lastToken.dir === 'open'
      ? 'empty_subexpression'
      : 'trailing_operator';
    errors.push({ index: tokens.length - 1, message });
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function parseTokens(tokens: FilterToken[]): ExprNode {
  let index = 0;

  function parseExpr(): ExprNode {
    let left = parseTerm();

    while (isOperator('OR')) {
      index += 1;
      left = { kind: 'or', left, right: parseTerm() };
    }

    return left;
  }

  function parseTerm(): ExprNode {
    let left = parseFactor();

    while (isOperator('AND')) {
      index += 1;
      left = { kind: 'and', left, right: parseFactor() };
    }

    return left;
  }

  function parseFactor(): ExprNode {
    const token = tokens[index];

    if (!token) {
      throw new Error('expected_operand');
    }

    if (token.kind === 'not') {
      index += 1;
      return { kind: 'not', operand: parseFactor() };
    }

    if (token.kind === 'paren' && token.dir === 'open') {
      index += 1;
      const expression = parseExpr();
      index += 1;
      return expression;
    }

    if (token.kind === 'operand') {
      index += 1;
      return {
        kind: 'operand',
        field: token.field,
        op: token.op,
        value: token.value,
      };
    }

    throw new Error('expected_operand');
  }

  function isOperator(op: OperatorToken['op']): boolean {
    const token = tokens[index];
    return token?.kind === 'operator' && token.op === op;
  }

  if (tokens.length === 0) {
    throw new Error('expected_operand');
  }

  return parseExpr();
}

export function evaluateAst<R>(
  ast: ExprNode,
  record: R,
  resolvers: Record<string, FieldResolver<R>>,
): boolean {
  if (ast.kind === 'operand') {
    const resolver = resolvers[ast.field];

    if (!resolver) {
      return false;
    }

    const resolved = resolver.read(record);

    if (ast.op === 'eq') {
      return String(resolved) === ast.value;
    }

    if (ast.op === 'neq') {
      return String(resolved) !== ast.value;
    }

    if (ast.op === 'in') {
      return ast.value.split(',').includes(String(resolved));
    }

    if (ast.op === 'gte') {
      return Number(resolved) >= Number(ast.value);
    }

    return Number(resolved) <= Number(ast.value);
  }

  if (ast.kind === 'and') {
    return evaluateAst(ast.left, record, resolvers) && evaluateAst(ast.right, record, resolvers);
  }

  if (ast.kind === 'or') {
    return evaluateAst(ast.left, record, resolvers) || evaluateAst(ast.right, record, resolvers);
  }

  return !evaluateAst(ast.operand, record, resolvers);
}

export function evaluateFilter<R>(
  tokens: FilterToken[],
  record: R,
  resolvers: Record<string, FieldResolver<R>>,
): EvalResult<R> {
  const validation = validateTokens(tokens);

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  if (tokens.length === 0) {
    return {
      ok: true,
      ast: { kind: 'not', operand: { kind: 'operand', field: '__empty_filter__', op: 'eq', value: 'true' } },
      result: true,
    };
  }

  const ast = parseTokens(tokens);
  const result = evaluateAst(ast, record, resolvers);

  return { ok: true, ast, result };
}

export function tokensToDebugString(tokens: FilterToken[]): string {
  return tokens.map(tokenToDebugString).join(' ');
}

function tokenToDebugString(token: FilterToken): string {
  if (token.kind === 'operand') {
    if (token.op === 'eq') {
      return `${token.field}=${token.value}`;
    }

    if (token.op === 'neq') {
      return `${token.field}!=${token.value}`;
    }

    if (token.op === 'in') {
      return `${token.field} in ${token.value}`;
    }

    if (token.op === 'gte') {
      return `${token.field}>=${token.value}`;
    }

    return `${token.field}<=${token.value}`;
  }

  if (token.kind === 'operator') {
    return token.op;
  }

  if (token.kind === 'not') {
    return 'NOT';
  }

  return token.dir === 'open' ? '(' : ')';
}
