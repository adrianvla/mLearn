import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeError } from '@mlearn/runtime-client';
import { nativeControlFailure } from '../../apps/client/src/host/nativeControlFailure';

test('native control errors preserve classification without interpreting prose', () => {
  for (const code of ['busy', 'invalid_bounded_read', 'operation_failed']) {
    assert.throws(() => nativeControlFailure({ code, message: 'Native detail' }), error =>
      error instanceof RuntimeError && error.code === code && error.message === 'Native detail');
  }
  const typed = new RuntimeError('busy', 'Native detail');
  assert.throws(() => nativeControlFailure(typed), error => error === typed);
  for (const error of [
    new Error('busy'), 'busy', null, { code: 7, message: 'Native detail' },
    { code: 'busy', message: 7 }, { code: 'x'.repeat(129), message: '' },
    { code: 'busy', message: 'x'.repeat(2049) },
  ]) {
    assert.throws(() => nativeControlFailure(error), actual => actual === error);
  }
});
