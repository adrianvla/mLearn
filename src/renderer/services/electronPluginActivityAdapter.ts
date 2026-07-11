import type { PluginBusJSONValue } from '../../shared/pluginBus'
import type { createActivityHub } from './activityHub'

type ActivityHub = ReturnType<typeof createActivityHub>
type ScopedValueWriter = (payload: {
  sourceId: string
  isFocused: boolean
  channel: string
  value: PluginBusJSONValue
}) => unknown

function safeWrite(writer: ScopedValueWriter | undefined, payload: Parameters<ScopedValueWriter>[0]): void {
  if (!writer) return
  try {
    const result = writer(payload)
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => undefined)
    }
  } catch {
    // Plugin projection is best-effort and must never interrupt learning.
  }
}

export function createElectronPluginActivityAdapter(
  hub: ActivityHub,
  writer: ScopedValueWriter | undefined = globalThis.window?.mLearnInternal?.setScopedPluginValue,
): () => void {
  let projectedSourceId: string | null = null
  const unsubscribe = hub.subscribeLive(live => {
    if (projectedSourceId && projectedSourceId !== live?.sourceId) {
      safeWrite(writer, {
        sourceId: projectedSourceId,
        isFocused: false,
        channel: 'app.user.activity',
        value: null,
      })
    }
    projectedSourceId = live?.sourceId ?? null
    if (!live) return
    safeWrite(writer, {
      sourceId: live.sourceId,
      isFocused: true,
      channel: 'app.user.activity',
      value: live.activity,
    })
  })

  return () => {
    unsubscribe()
    if (!projectedSourceId) return
    safeWrite(writer, {
      sourceId: projectedSourceId,
      isFocused: false,
      channel: 'app.user.activity',
      value: null,
    })
    projectedSourceId = null
  }
}
