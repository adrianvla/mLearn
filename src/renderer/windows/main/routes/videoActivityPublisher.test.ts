import { createRoot, createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

import { createPluginAppActivityStore } from '../../../../electron/services/pluginAppActivity'

describe('createVideoAppActivityPublisher', () => {
  it('publishes a new snapshot immediately when the work changes', async () => {
    const { createVideoAppActivityPublisher } = await import('./videoActivityPublisher')
    const publishSourceUpdate = vi.fn()

    let setWorkName!: (value: string) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName, updateWorkName] = createSignal('Spirited Away')
      const [currentTimeSeconds] = createSignal(12)
      const [durationSeconds] = createSignal<number | null>(300)
      const [isFocused] = createSignal(true)
      setWorkName = updateWorkName

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate,
      })
    })

    await Promise.resolve()
    publishSourceUpdate.mockClear()

    setWorkName('Princess Mononoke')
    await Promise.resolve()

    expect(publishSourceUpdate).toHaveBeenCalledWith({
      sourceId: 'video-route',
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Princess Mononoke',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
    })

    dispose()
  })

  it('publishes a video activity as soon as duration becomes available', async () => {
    const { createVideoAppActivityPublisher } = await import('./videoActivityPublisher')
    const publishSourceUpdate = vi.fn()

    let setDurationSeconds!: (value: number | null) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds] = createSignal(12)
      const [durationSeconds, updateDurationSeconds] = createSignal<number | null>(null)
      const [isFocused] = createSignal(true)
      setDurationSeconds = updateDurationSeconds

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate,
      })
    })

    await Promise.resolve()
    publishSourceUpdate.mockClear()

    setDurationSeconds(300)
    await Promise.resolve()

    expect(publishSourceUpdate).toHaveBeenCalledWith({
      sourceId: 'video-route',
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
    })

    dispose()
  })

  it('keeps the canonical activity at idle until duration is known', async () => {
    const { createVideoAppActivityPublisher } = await import('./videoActivityPublisher')
    const store = createPluginAppActivityStore()

    createRoot((dispose) => {
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds] = createSignal(12)
      const [durationSeconds] = createSignal<number | null>(null)
      const [isFocused] = createSignal(true)

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate: ({ sourceId, isFocused, activity }) => {
          store.updateSource(sourceId, { isFocused, activity })
        },
      })

      queueMicrotask(dispose)
    })

    await Promise.resolve()

    expect(store.getCurrentActivity()).toEqual({ kind: 'idle' })
  })

  it('publishes when playback enters a new 15-second bucket', async () => {
    const { createVideoAppActivityPublisher } = await import('./videoActivityPublisher')
    const publishSourceUpdate = vi.fn()

    let setCurrentTimeSeconds!: (value: number) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds, updateCurrentTimeSeconds] = createSignal(14)
      const [durationSeconds] = createSignal<number | null>(300)
      const [isFocused] = createSignal(true)
      setCurrentTimeSeconds = updateCurrentTimeSeconds

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate,
      })
    })

    await Promise.resolve()
    publishSourceUpdate.mockClear()

    setCurrentTimeSeconds(15)
    await Promise.resolve()

    expect(publishSourceUpdate).toHaveBeenCalledWith({
      sourceId: 'video-route',
      isFocused: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 15,
        durationSeconds: 300,
      },
    })

    dispose()
  })

  it('does not publish when playback stays in the same 15-second bucket', async () => {
    const { createVideoAppActivityPublisher } = await import('./videoActivityPublisher')
    const publishSourceUpdate = vi.fn()

    let setCurrentTimeSeconds!: (value: number) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds, updateCurrentTimeSeconds] = createSignal(12)
      const [durationSeconds] = createSignal<number | null>(300)
      const [isFocused] = createSignal(true)
      setCurrentTimeSeconds = updateCurrentTimeSeconds

      createVideoAppActivityPublisher({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishSourceUpdate,
      })
    })

    await Promise.resolve()
    publishSourceUpdate.mockClear()

    setCurrentTimeSeconds(13)
    await Promise.resolve()

    expect(publishSourceUpdate).not.toHaveBeenCalled()

    dispose()
  })
})
