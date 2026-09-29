// @vitest-environment happy-dom

/**
 * The spatial mode had two contracts: a short table in shared/constants that
 * nothing read, and a longer one inside the control. They agreed on the first
 * four rows and disagreed about `easy` and the 7/8/9/0 row entirely. These
 * tests pin the single contract and the invariant that would have caught the
 * drift: a cell may only advertise a key the control actually honours.
 */

import { describe, expect, it } from 'vitest';
import {
  SPATIAL_ACTION_ROWS,
  SPATIAL_MATRIX_ROWS,
  spatialMatrixAction,
  spatialMatrixKey,
  spatialMatrixRow,
  type SpatialRatingAction,
} from '../../../../shared/constants';

const ACTIONS = Object.keys(SPATIAL_ACTION_ROWS) as SpatialRatingAction[];

describe('spatial matrix contract', () => {
  it('row 0 is the All row and every action has a key there', () => {
    for (const action of ACTIONS) {
      expect(spatialMatrixKey(action, 0)).toBeDefined();
    }
  });

  it('every key resolves back to the same action and row it was read from', () => {
    for (const action of ACTIONS) {
      for (let row = 0; row < SPATIAL_MATRIX_ROWS; row += 1) {
        const key = spatialMatrixKey(action, row);
        expect(key).toBeDefined();
        expect(spatialMatrixAction(key as string, row)).toBe(action);
        expect(spatialMatrixRow(key as string)).toBe(row);
      }
    }
  });

  it('no key names two different actions or rows', () => {
    const seen = new Map<string, string>();
    for (const action of ACTIONS) {
      for (const key of SPATIAL_ACTION_ROWS[action]) {
        const label = `${key}@${SPATIAL_ACTION_ROWS[action].indexOf(key)}`;
        expect(seen.has(key)).toBe(false);
        seen.set(key, label);
      }
    }
  });

  it('rows past the table are unkeyed rather than falling back to another row', () => {
    for (const action of ACTIONS) {
      expect(spatialMatrixKey(action, SPATIAL_MATRIX_ROWS)).toBeUndefined();
      expect(spatialMatrixKey(action, -1)).toBeUndefined();
    }
  });

  it('an unknown key names no row at all', () => {
    expect(spatialMatrixRow('~')).toBeUndefined();
    expect(spatialMatrixAction('~', 0)).toBeUndefined();
  });

  it('carries the easy column the dead table was missing', () => {
    // The old short table stopped at `fluent`, so the Easy rating — the one
    // the scheduler actually treats differently — had no published key.
    expect(ACTIONS).toContain('easy');
    expect(spatialMatrixKey('easy', 0)).toBe('4');
  });
});
