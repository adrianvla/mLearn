export type PluginBusJSONPrimitive = boolean | null | number | string

export type PluginBusJSONValue =
  | PluginBusJSONPrimitive
  | PluginBusJSONValue[]
  | { [key: string]: PluginBusJSONValue }

export type PluginBusEnvelope<T extends PluginBusJSONValue = PluginBusJSONValue> =
  | { hasValue: false; value: null }
  | { hasValue: true; value: T }

export type PluginBusAppPublisher = {
  scope: 'app'
  sourceId?: string
}

export type PluginBusPluginPublisher = {
  scope: 'plugin'
  pluginId: string
}

export type PluginBusPublisher = PluginBusAppPublisher | PluginBusPluginPublisher

export type PluginBusValueListener<T extends PluginBusJSONValue = PluginBusJSONValue> = (
  nextValue: PluginBusEnvelope<T>,
  previousValue: PluginBusEnvelope<T>,
) => void

export type PluginBusEventListener<T extends PluginBusJSONValue = PluginBusJSONValue> = (
  payload: T,
) => void
