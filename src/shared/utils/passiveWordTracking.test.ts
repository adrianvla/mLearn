import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PASSIVE_HOVER_EASE_DECREASE,
  DEFAULT_PASSIVE_HOVER_FAIL_ACTION,
  DEFAULT_PASSIVE_HOVER_DELAY_MS,
  DEFAULT_PASSIVE_HOVER_FAIL_COUNT,
  getPassiveHoverEaseDecrease,
  getPassiveHoverFailAction,
  getPassiveHoverDelayMs,
  getPassiveHoverFailCount,
  getRemainingHoversToFail,
  hasReachedPassiveHoverFailCount,
  isWordMarkedFailed,
  shouldDecreaseEaseOnPassiveFailure,
} from '@shared/utils/passiveWordTracking'

describe('getPassiveHoverDelayMs', () => {
  it('returns the default when the setting is missing', () => {
    expect(getPassiveHoverDelayMs()).toBe(DEFAULT_PASSIVE_HOVER_DELAY_MS)
  })

  it('rounds and clamps invalid values', () => {
    expect(getPassiveHoverDelayMs({ passiveHoverDelayMs: 249.6 })).toBe(250)
    expect(getPassiveHoverDelayMs({ passiveHoverDelayMs: -10 })).toBe(0)
  })
})

describe('getPassiveHoverFailCount', () => {
  it('returns the default when the setting is missing', () => {
    expect(getPassiveHoverFailCount()).toBe(DEFAULT_PASSIVE_HOVER_FAIL_COUNT)
  })

  it('rounds and clamps invalid values', () => {
    expect(getPassiveHoverFailCount({ passiveHoverFailCount: 2.2 })).toBe(2)
    expect(getPassiveHoverFailCount({ passiveHoverFailCount: 0 })).toBe(1)
  })
})

describe('passive hover fail action', () => {
  it('returns the decrease-ease defaults when unset', () => {
    expect(getPassiveHoverFailAction()).toBe(DEFAULT_PASSIVE_HOVER_FAIL_ACTION)
    expect(getPassiveHoverEaseDecrease()).toBe(DEFAULT_PASSIVE_HOVER_EASE_DECREASE)
    expect(shouldDecreaseEaseOnPassiveFailure()).toBe(true)
  })

  it('supports disabling the ease decrease action', () => {
    expect(getPassiveHoverFailAction({ passiveHoverFailAction: 'none' })).toBe('none')
    expect(shouldDecreaseEaseOnPassiveFailure({ passiveHoverFailAction: 'none' })).toBe(false)
  })

  it('supports the decrease-ease-and-flashcard action', () => {
    expect(getPassiveHoverFailAction({ passiveHoverFailAction: 'decrease-ease-and-flashcard' })).toBe('decrease-ease-and-flashcard')
    expect(shouldDecreaseEaseOnPassiveFailure({ passiveHoverFailAction: 'decrease-ease-and-flashcard' })).toBe(true)
  })

  it('clamps invalid ease decrease values', () => {
    expect(getPassiveHoverEaseDecrease({ passiveHoverEaseDecrease: -1 })).toBe(0)
  })
})

describe('isWordMarkedFailed', () => {
  it('stays false until the configured hover count is reached', () => {
    expect(isWordMarkedFailed({ timesHovered: 1 }, { passiveHoverFailCount: 2 })).toBe(false)
    expect(hasReachedPassiveHoverFailCount(1, { passiveHoverFailCount: 2 })).toBe(false)
    expect(getRemainingHoversToFail({ timesHovered: 1 }, { passiveHoverFailCount: 2 })).toBe(1)
  })

  it('becomes true exactly at the configured hover count', () => {
    expect(isWordMarkedFailed({ timesHovered: 2 }, { passiveHoverFailCount: 2 })).toBe(true)
    expect(hasReachedPassiveHoverFailCount(2, { passiveHoverFailCount: 2 })).toBe(true)
    expect(getRemainingHoversToFail({ timesHovered: 4 }, { passiveHoverFailCount: 2 })).toBe(0)
  })
})