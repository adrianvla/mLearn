import type { PassiveHoverFailAction } from '../constants'
import type { MediaStatsWordEntry, PassiveWordKnowledge, Settings } from '../types'

type PassiveHoverSettings = Partial<Pick<Settings, 'passiveHoverDelayMs' | 'passiveHoverFailCount' | 'passiveHoverFailAction' | 'passiveHoverEaseDecrease'>>
type FailedWordEntry = Pick<MediaStatsWordEntry, 'timesHovered'> | Pick<PassiveWordKnowledge, 'timesHovered'>

export const DEFAULT_PASSIVE_HOVER_DELAY_MS = 300
export const DEFAULT_PASSIVE_HOVER_FAIL_COUNT = 1
export const DEFAULT_PASSIVE_HOVER_FAIL_ACTION: PassiveHoverFailAction = 'decrease-ease'
export const DEFAULT_PASSIVE_HOVER_EASE_DECREASE = 0.05

function normalizeInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.round(value))
}

function normalizeNumber(value: number | undefined, fallback: number, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, value)
}

export function getPassiveHoverDelayMs(settings?: PassiveHoverSettings): number {
  return normalizeInteger(settings?.passiveHoverDelayMs, DEFAULT_PASSIVE_HOVER_DELAY_MS, 0)
}

export function getPassiveHoverFailCount(settings?: PassiveHoverSettings): number {
  return normalizeInteger(settings?.passiveHoverFailCount, DEFAULT_PASSIVE_HOVER_FAIL_COUNT, 1)
}

export function getPassiveHoverFailAction(settings?: PassiveHoverSettings): PassiveHoverFailAction {
  return settings?.passiveHoverFailAction === 'none' ? 'none' : DEFAULT_PASSIVE_HOVER_FAIL_ACTION
}

export function getPassiveHoverEaseDecrease(settings?: PassiveHoverSettings): number {
  return normalizeNumber(settings?.passiveHoverEaseDecrease, DEFAULT_PASSIVE_HOVER_EASE_DECREASE, 0)
}

export function hasReachedPassiveHoverFailCount(timesHovered: number, settings?: PassiveHoverSettings): boolean {
  return normalizeInteger(timesHovered, 0, 0) >= getPassiveHoverFailCount(settings)
}

export function shouldDecreaseEaseOnPassiveFailure(settings?: PassiveHoverSettings): boolean {
  return getPassiveHoverFailAction(settings) === 'decrease-ease' && getPassiveHoverEaseDecrease(settings) > 0
}

export function isWordMarkedFailed(entry: FailedWordEntry, settings?: PassiveHoverSettings): boolean {
  return hasReachedPassiveHoverFailCount(entry.timesHovered, settings)
}

export function getRemainingHoversToFail(entry: FailedWordEntry, settings?: PassiveHoverSettings): number {
  return Math.max(0, getPassiveHoverFailCount(settings) - normalizeInteger(entry.timesHovered, 0, 0))
}