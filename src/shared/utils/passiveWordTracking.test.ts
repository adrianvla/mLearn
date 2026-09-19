import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PASSIVE_HOVER_DELAY_MS,
  getPassiveHoverDelayMs,
  isWordMarkedFailed,
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

describe('isWordMarkedFailed (retired hover-failure attribution)', () => {
  // R10 (review 2026-09-17T011733): a hover popup must never create negative
  // epistemic evidence. The decrease-ease policy was removed from the writer
  // and the settings UI, so NO configuration — not even a persisted legacy
  // 'decrease-ease' — may label a hovered word as failed downstream.
  it('never marks a word failed, under any settings or hover count', () => {
    expect(isWordMarkedFailed({ timesHovered: 1 }, { passiveHoverFailAction: 'none' })).toBe(false)
    expect(isWordMarkedFailed({ timesHovered: 1 }, { passiveHoverFailAction: 'decrease-ease', passiveHoverEaseDecrease: 0.05 })).toBe(false)
    expect(isWordMarkedFailed({ timesHovered: 50 }, {})).toBe(false)
    expect(isWordMarkedFailed({ timesHovered: 50 })).toBe(false)
  })
})
