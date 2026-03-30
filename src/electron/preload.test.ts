import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_ACTIVITY_IPC_CHANNELS } from '../shared/appActivityIpc'
import { PLUGIN_IPC_CHANNELS } from '../shared/plugins/constants'

const sendMock = vi.fn()
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
    invoke: invokeMock,
    on: onMock,
    removeListener: removeListenerMock,
  },
  webUtils: {
    getPathForFile: getPathForFileMock,
  },
}))

describe('preload app activity source update hook', () => {
  beforeEach(() => {
    vi.resetModules()
    sendMock.mockReset()
    invokeMock.mockReset()
    onMock.mockReset()
    removeListenerMock.mockReset()
    exposeInMainWorldMock.mockReset()
    getPathForFileMock.mockReset()
  })

  it('exposes an app-internal source update sender on a separate internal surface', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as {
      getAppActivity?: () => Promise<unknown>
      onAppActivity?: (callback: (activity: unknown) => void) => unknown
    }
    expect(exposeInMainWorldMock).toHaveBeenNthCalledWith(2, 'mLearnInternal', expect.any(Object))

    const exposedInternalApi = exposeInMainWorldMock.mock.calls[1]?.[1] as {
      publishSourceActivityUpdate?: (payload: {
        sourceId: string
        isFocused: boolean
        activity: { kind: 'reader'; workName: string; currentPage: number; totalPages: number } | null
      }) => void
    }

    exposedInternalApi.publishSourceActivityUpdate?.({
      sourceId: 'reader-route',
      isFocused: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      },
    })

    expect(sendMock).toHaveBeenCalledWith(APP_ACTIVITY_IPC_CHANNELS.SOURCE_UPDATE, {
      sourceId: 'reader-route',
      isFocused: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      },
    })
  })

  it('exposes getAppActivity on window.mLearnIPC', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as {
      getAppActivity?: () => Promise<unknown>
    }

    exposedApi.getAppActivity?.()

    expect(invokeMock).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_APP_ACTIVITY_GET)
  })

  it('exposes onAppActivity on window.mLearnIPC', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as {
      onAppActivity?: (callback: (activity: unknown) => void) => unknown
    }
    const callback = vi.fn()

    exposedApi.onAppActivity?.(callback)

    expect(onMock).toHaveBeenCalledWith(PLUGIN_IPC_CHANNELS.PLUGIN_APP_ACTIVITY_CHANGED, expect.any(Function))
  })

  it('keeps the internal source update sender off window.mLearnIPC', async () => {
    await import('./preload')

    const exposedApi = exposeInMainWorldMock.mock.calls[0]?.[1] as Record<string, unknown>

    expect(exposedApi).not.toHaveProperty('publishSourceActivityUpdate')
  })
})
