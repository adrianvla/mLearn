import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLUGIN_IPC_CHANNELS } from '../shared/plugins/constants'

const sendMock = vi.fn()
const sendSyncMock = vi.fn()
const invokeMock = vi.fn()
const onMock = vi.fn()
const removeListenerMock = vi.fn()
const exposeInMainWorldMock = vi.fn()
const getPathForFileMock = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    send: sendMock,
    sendSync: sendSyncMock,
    invoke: invokeMock,
    on: onMock,
    removeListener: removeListenerMock,
  },
  webUtils: {
    getPathForFile: getPathForFileMock,
  },
}))

describe('preload plugin bus bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    sendMock.mockReset()
    sendSyncMock.mockReset()
    invokeMock.mockReset()
    onMock.mockReset()
    removeListenerMock.mockReset()
    exposeInMainWorldMock.mockReset()
    getPathForFileMock.mockReset()
  })

  it('exposes app-internal scoped publishing on a separate internal surface', async () => {
    await import('./preload')

    expect(exposeInMainWorldMock).toHaveBeenNthCalledWith(2, 'mLearnInternal', expect.any(Object))

    const exposedInternalApi = exposeInMainWorldMock.mock.calls[1]?.[1] as {
      setScopedPluginValue?: (payload: {
        sourceId: string
        isFocused: boolean
        channel: string
        value: { kind: 'reader'; workName: string; currentPage: number; totalPages: number } | null
      }) => void
    }

    expect(exposedInternalApi).not.toHaveProperty('publishSourceActivityUpdate')

    exposedInternalApi.setScopedPluginValue?.({
      sourceId: 'reader-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      },
    })

    expect(sendMock).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_SET_SCOPED_VALUE, {
      sourceId: 'reader-route',
      isFocused: true,
      channel: 'app.user.activity',
      value: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      },
    })
  })

  it('exposes getPluginValue on window.mLearnIPC', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as {
      getPluginValue?: (channel: string) => Promise<unknown>
    }

    exposedApi.getPluginValue?.('shared.theme')

    expect(invokeMock).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_GET_VALUE, 'shared.theme')
  })

  it('exposes setPluginValue and emitPluginEvent on window.mLearnIPC', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as {
      setPluginValue?: (channel: string, value: unknown) => Promise<unknown>
      emitPluginEvent?: (channel: string, payload: unknown) => Promise<unknown>
    }

    exposedApi.setPluginValue?.('shared.theme', 'dark')
    exposedApi.emitPluginEvent?.('shared.command', { type: 'refresh' })

    expect(invokeMock).toHaveBeenNthCalledWith(1, PLUGIN_IPC_CHANNELS.PLUGIN_BUS_SET_VALUE, 'shared.theme', 'dark')
    expect(invokeMock).toHaveBeenNthCalledWith(2, PLUGIN_IPC_CHANNELS.PLUGIN_BUS_EMIT_EVENT, 'shared.command', { type: 'refresh' })
  })

  it('exposes onPluginValue and onPluginEvent on window.mLearnIPC', async () => {
    sendSyncMock.mockReturnValue({ hasValue: false, value: null })
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as {
      onPluginValue?: (channel: string, callback: (next: unknown, previous: unknown) => void) => unknown
      onPluginEvent?: (channel: string, callback: (payload: unknown) => void) => unknown
    }
    const onValue = vi.fn()
    const onEvent = vi.fn()

    exposedApi.onPluginValue?.('shared.theme', onValue)
    exposedApi.onPluginEvent?.('shared.command', onEvent)

    expect(onMock).toHaveBeenNthCalledWith(1, PLUGIN_IPC_CHANNELS.PLUGIN_BUS_VALUE_CHANGED, expect.any(Function))
    expect(onMock).toHaveBeenNthCalledWith(2, PLUGIN_IPC_CHANNELS.PLUGIN_BUS_EVENT_EMITTED, expect.any(Function))
  })

  it('invokes onPluginValue immediately with the current envelope', async () => {
    sendSyncMock.mockReturnValue({ hasValue: true, value: 'dark' })
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as {
      onPluginValue?: (channel: string, callback: (next: unknown, previous: unknown) => void) => unknown
    }
    const callback = vi.fn()

    exposedApi.onPluginValue?.('shared.theme', callback)

    expect(sendSyncMock).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_BUS_GET_VALUE_SYNC, 'shared.theme')
    expect(callback).toHaveBeenCalledWith(
      { hasValue: true, value: 'dark' },
      { hasValue: false, value: null },
    )
  })

  it('removes getAppActivity and onAppActivity from window.mLearnIPC', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as Record<string, unknown>

    expect(exposedApi).not.toHaveProperty('getAppActivity')
    expect(exposedApi).not.toHaveProperty('onAppActivity')
  })

  it('keeps the internal scoped publishing helper off window.mLearnIPC', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as Record<string, unknown>

    expect(exposedApi).not.toHaveProperty('setScopedPluginValue')
  })

  it('does not expose mLearnInternal for plugin-host windows', async () => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/src/html/plugin-host.html' },
    })

    await import('./preload')

    expect(exposeInMainWorldMock).toHaveBeenCalledTimes(1)
    expect(exposeInMainWorldMock).toHaveBeenCalledWith('mLearnIPC', expect.any(Object))
  })
})
