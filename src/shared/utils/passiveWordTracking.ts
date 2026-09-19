import type { MediaStatsWordEntry, PassiveWordKnowledge, Settings } from '../types'

type FailedWordEntry = Pick<MediaStatsWordEntry, 'timesHovered'> | Pick<PassiveWordKnowledge, 'timesHovered'>

export const DEFAULT_PASSIVE_HOVER_DELAY_MS = 300

function normalizeInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.round(value))
}

export function getPassiveHoverDelayMs(settings?: Partial<Settings>): number {
  return normalizeInteger(settings?.passiveHoverDelayMs, DEFAULT_PASSIVE_HOVER_DELAY_MS, 0)
}

/**
 * R10, retired (review 2026-09-17T011733): a hover popup must never create
 * negative epistemic evidence, so passive tracking no longer marks words as
 * failed under ANY configuration. The former decrease-ease policy
 * (passiveHoverFailAction / passiveHoverEaseDecrease / passiveHoverFailCount)
 * was removed from the writer and the settings UI; persisted values for those
 * keys are inert. The function remains as the single authority so consumers
 * (media stats, assistance sidebars, suggestions) degrade to honest
 * empty failed-word lists instead of keeping their own ease arithmetic.
 */
export function isWordMarkedFailed(_entry: FailedWordEntry, _settings?: Partial<Settings>): boolean {
  void _entry
  void _settings
  return false
}
