import type { MediaStatsWordEntry, PassiveWordKnowledge, Settings } from '../types'

type PassiveHoverSettings = Partial<Pick<Settings, 'passiveHoverDelayMs' | 'passiveHoverFailCount'>>
type FailedWordEntry = Pick<MediaStatsWordEntry, 'timesHovered'> | Pick<PassiveWordKnowledge, 'timesHovered'>

export const DEFAULT_PASSIVE_HOVER_DELAY_MS = 150
export const DEFAULT_PASSIVE_HOVER_FAIL_COUNT = 1

function normalizeInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.round(value))
}

export function getPassiveHoverDelayMs(settings?: PassiveHoverSettings): number {
  return normalizeInteger(settings?.passiveHoverDelayMs, DEFAULT_PASSIVE_HOVER_DELAY_MS, 0)
}

export function getPassiveHoverFailCount(settings?: PassiveHoverSettings): number {
  return normalizeInteger(settings?.passiveHoverFailCount, DEFAULT_PASSIVE_HOVER_FAIL_COUNT, 1)
}

export function hasReachedPassiveHoverFailCount(timesHovered: number, settings?: PassiveHoverSettings): boolean {
  return normalizeInteger(timesHovered, 0, 0) >= getPassiveHoverFailCount(settings)
}

export function isWordMarkedFailed(entry: FailedWordEntry, settings?: PassiveHoverSettings): boolean {
  return hasReachedPassiveHoverFailCount(entry.timesHovered, settings)
}

export function getRemainingHoversToFail(entry: FailedWordEntry, settings?: PassiveHoverSettings): number {
  return Math.max(0, getPassiveHoverFailCount(settings) - normalizeInteger(entry.timesHovered, 0, 0))
}