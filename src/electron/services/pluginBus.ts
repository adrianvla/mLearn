import type {
  PluginBusEnvelope,
  PluginBusEventListener,
  PluginBusJSONValue,
  PluginBusPublisher,
  PluginBusValueListener,
} from '../../shared/pluginBus'
import type { AppActivity } from '../../shared/plugins/appActivity'

type ValueListenerSet = Set<PluginBusValueListener>
type EventListenerSet = Set<PluginBusEventListener>

type AppSourceRecord = {
  isFocused: boolean
  activity: AppActivity | null
  focusSequence: number
}

export type PublishSourceInput = {
  isFocused: boolean
  activity: AppActivity | null
  updatedAt?: number
}

export type PluginBusStore = {
  emitPluginEvent: <T extends PluginBusJSONValue>(publisher: PluginBusPublisher, channel: string, payload: T) => void
  getPluginValue: <T extends PluginBusJSONValue>(channel: string) => PluginBusEnvelope<T>
  onPluginEvent: <T extends PluginBusJSONValue>(channel: string, listener: PluginBusEventListener<T>) => () => void
  onPluginValue: <T extends PluginBusJSONValue>(channel: string, listener: PluginBusValueListener<T>) => () => void
  removeAppSource: (sourceId: string) => void
  setAppScopedValue: <T extends PluginBusJSONValue>(channel: string, sourceId: string, value: T) => void
  setAppSourceFocused: (sourceId: string, isFocused: boolean) => void
  setPluginValue: <T extends PluginBusJSONValue>(publisher: PluginBusPublisher, channel: string, value: T) => void
}

export type PluginAppActivityStore = {
  updateSource: (sourceId: string, next: PublishSourceInput) => void
  getCurrentActivity: () => AppActivity
  subscribe: (listener: (activity: AppActivity) => void) => () => void
}

const APP_USER_ACTIVITY_CHANNEL = 'app.user.activity'
const IDLE_ACTIVITY: AppActivity = { kind: 'idle' }
const MISSING_ENVELOPE: PluginBusEnvelope = { hasValue: false, value: null }
const MISSING_APP_ACTIVITY_ENVELOPE: PluginBusEnvelope<AppActivity> = { hasValue: false, value: null }

function cloneJSONValue<T extends PluginBusJSONValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeJSONValue(value: PluginBusJSONValue): PluginBusJSONValue {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJSONValue(entry))
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizeJSONValue(value[key])]),
  )
}

function isStructurallyEqual(left: PluginBusJSONValue, right: PluginBusJSONValue): boolean {
  return JSON.stringify(normalizeJSONValue(left)) === JSON.stringify(normalizeJSONValue(right))
}

function asEnvelope<T extends PluginBusJSONValue>(envelope: PluginBusEnvelope): PluginBusEnvelope<T> {
  return envelope as PluginBusEnvelope<T>
}

function isSameEnvelope(left: PluginBusEnvelope, right: PluginBusEnvelope): boolean {
  if (left.hasValue !== right.hasValue) {
    return false
  }

  if (!left.hasValue || !right.hasValue) {
    return true
  }

  return isStructurallyEqual(left.value, right.value)
}

function getPluginNamespace(channel: string): string | null {
  if (!channel.startsWith('plugin.')) {
    return null
  }

  const lastDotIndex = channel.lastIndexOf('.')
  if (lastDotIndex <= 'plugin.'.length) {
    return null
  }

  return channel.slice('plugin.'.length, lastDotIndex)
}

function assertCanPublish(publisher: PluginBusPublisher, channel: string): void {
  if (publisher.scope === 'app') {
    if (channel.startsWith('app.') || channel.startsWith('shared.')) {
      return
    }

    throw new Error(`app publisher cannot publish to channel: ${channel}`)
  }

  if (channel.startsWith('shared.')) {
    return
  }

  const namespace = getPluginNamespace(channel)
  if (namespace === publisher.pluginId) {
    return
  }

  throw new Error(`plugin publisher cannot publish to channel: ${channel}`)
}

export function createPluginBusStore(): PluginBusStore {
  const values = new Map<string, PluginBusEnvelope>()
  const valueListeners = new Map<string, ValueListenerSet>()
  const eventListeners = new Map<string, EventListenerSet>()
  const appSources = new Map<string, AppSourceRecord>()
  let nextFocusSequence = 0

  function getAppSourceEnvelope(): PluginBusEnvelope<AppActivity> {
    let activeSource: AppSourceRecord | null = null

    for (const source of appSources.values()) {
      if (!source.isFocused || source.activity === null) {
        continue
      }

      if (activeSource === null || source.focusSequence > activeSource.focusSequence) {
        activeSource = source
      }
    }

    if (!activeSource) {
      return MISSING_APP_ACTIVITY_ENVELOPE
    }

    return {
      hasValue: true,
      value: cloneJSONValue(activeSource.activity!),
    }
  }

  function getStoredEnvelope(channel: string): PluginBusEnvelope {
    if (channel === APP_USER_ACTIVITY_CHANNEL) {
      return getAppSourceEnvelope()
    }

    return values.get(channel) ?? MISSING_ENVELOPE
  }

  function emitValueIfChanged(
    channel: string,
    nextEnvelope: PluginBusEnvelope,
    previousEnvelopeOverride?: PluginBusEnvelope,
  ): void {
    const previousEnvelope = previousEnvelopeOverride ?? getStoredEnvelope(channel)

    if (channel !== APP_USER_ACTIVITY_CHANNEL) {
      values.set(channel, nextEnvelope)
    }

    const currentEnvelope = getStoredEnvelope(channel)
    if (isSameEnvelope(previousEnvelope, currentEnvelope)) {
      return
    }

    const listeners = valueListeners.get(channel)
    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(currentEnvelope, previousEnvelope)
    }
  }

  function updateAppActivitySource(sourceId: string, activity: AppActivity | null): void {
    const previousEnvelope = getAppSourceEnvelope()
    const previous = appSources.get(sourceId)
    const isFocused = previous?.isFocused ?? true
    const focusSequence = isFocused
      ? previous?.focusSequence ?? ++nextFocusSequence
      : previous?.focusSequence ?? 0

    appSources.set(sourceId, {
      isFocused,
      activity,
      focusSequence,
    })

    emitValueIfChanged(APP_USER_ACTIVITY_CHANNEL, getAppSourceEnvelope(), previousEnvelope)
  }

  return {
    emitPluginEvent<T extends PluginBusJSONValue>(publisher: PluginBusPublisher, channel: string, payload: T) {
      assertCanPublish(publisher, channel)

      const listeners = eventListeners.get(channel)
      if (!listeners) {
        return
      }

      const clonedPayload = cloneJSONValue(payload)
      for (const listener of listeners) {
        listener(clonedPayload)
      }
    },

    getPluginValue(channel: string) {
      return asEnvelope(getStoredEnvelope(channel))
    },

    onPluginEvent<T extends PluginBusJSONValue>(channel: string, listener: PluginBusEventListener<T>) {
      const listeners = eventListeners.get(channel) ?? new Set()
      listeners.add(listener as PluginBusEventListener)
      eventListeners.set(channel, listeners)

      return () => {
        listeners.delete(listener as PluginBusEventListener)
        if (listeners.size === 0) {
          eventListeners.delete(channel)
        }
      }
    },

    onPluginValue<T extends PluginBusJSONValue>(channel: string, listener: PluginBusValueListener<T>) {
      const listeners = valueListeners.get(channel) ?? new Set()
      listeners.add(listener as PluginBusValueListener)
      valueListeners.set(channel, listeners)

      const currentEnvelope = asEnvelope<T>(getStoredEnvelope(channel))
      const previousEnvelope = asEnvelope<T>(MISSING_ENVELOPE)
      listener(currentEnvelope, previousEnvelope)

      return () => {
        listeners.delete(listener as PluginBusValueListener)
        if (listeners.size === 0) {
          valueListeners.delete(channel)
        }
      }
    },

    removeAppSource(sourceId) {
      const previousEnvelope = getAppSourceEnvelope()
      const hadSource = appSources.delete(sourceId)
      if (!hadSource) {
        return
      }

      emitValueIfChanged(APP_USER_ACTIVITY_CHANNEL, getAppSourceEnvelope(), previousEnvelope)
    },

    setAppScopedValue<T extends PluginBusJSONValue>(channel: string, sourceId: string, value: T) {
      this.setPluginValue({ scope: 'app', sourceId }, channel, value)
    },

    setAppSourceFocused(sourceId, isFocused) {
      const previousEnvelope = getAppSourceEnvelope()
      const previous = appSources.get(sourceId)
      if (!previous) {
        appSources.set(sourceId, {
          isFocused,
          activity: null,
          focusSequence: isFocused ? ++nextFocusSequence : 0,
        })
        emitValueIfChanged(APP_USER_ACTIVITY_CHANNEL, getAppSourceEnvelope(), previousEnvelope)
        return
      }

      const focusSequence = isFocused
        ? previous.isFocused
          ? previous.focusSequence
          : ++nextFocusSequence
        : previous.focusSequence

      appSources.set(sourceId, {
        ...previous,
        isFocused,
        focusSequence,
      })
      emitValueIfChanged(APP_USER_ACTIVITY_CHANNEL, getAppSourceEnvelope(), previousEnvelope)
    },

    setPluginValue<T extends PluginBusJSONValue>(publisher: PluginBusPublisher, channel: string, value: T) {
      assertCanPublish(publisher, channel)

      if (channel === APP_USER_ACTIVITY_CHANNEL && publisher.scope === 'app' && publisher.sourceId) {
        updateAppActivitySource(publisher.sourceId, value as AppActivity | null)
        return
      }

      emitValueIfChanged(channel, {
        hasValue: true,
        value: cloneJSONValue(value),
      })
    },
  }
}

export function createPluginAppActivityStore(): PluginAppActivityStore {
  const busStore = createPluginBusStore()

  return {
    updateSource(sourceId, next) {
      busStore.setAppSourceFocused(sourceId, next.isFocused)
      busStore.setAppScopedValue(APP_USER_ACTIVITY_CHANNEL, sourceId, next.activity)
    },

    getCurrentActivity() {
      const envelope = busStore.getPluginValue<AppActivity>(APP_USER_ACTIVITY_CHANNEL)
      return envelope.hasValue ? envelope.value : IDLE_ACTIVITY
    },

    subscribe(listener) {
      return busStore.onPluginValue<AppActivity>(APP_USER_ACTIVITY_CHANNEL, (envelope) => {
        listener(envelope.hasValue ? envelope.value : IDLE_ACTIVITY)
      })
    },
  }
}
