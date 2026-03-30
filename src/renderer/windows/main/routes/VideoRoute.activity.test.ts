import { createRoot, createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

describe('syncVideoPluginActivity', () => {
  it('publishes a new snapshot immediately when the work changes', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const publishScopedValue = vi.fn()

    let setWorkName!: (value: string) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName, updateWorkName] = createSignal('Spirited Away')
      const [currentTimeSeconds] = createSignal(12)
      const [durationSeconds] = createSignal<number | null>(300)
      const [isFocused] = createSignal(true)
      setWorkName = updateWorkName

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue,
      })
    })

    await Promise.resolve()
    publishScopedValue.mockClear()

    setWorkName('Princess Mononoke')
    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'video-route',
      isFocused: true,
      value: {
        kind: 'video',
        workName: 'Princess Mononoke',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
    })

    dispose()
  })

  it('publishes a video activity as soon as duration becomes available', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const publishScopedValue = vi.fn()

    let setDurationSeconds!: (value: number | null) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds] = createSignal(12)
      const [durationSeconds, updateDurationSeconds] = createSignal<number | null>(null)
      const [isFocused] = createSignal(true)
      setDurationSeconds = updateDurationSeconds

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue,
      })
    })

    await Promise.resolve()
    publishScopedValue.mockClear()

    setDurationSeconds(300)
    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'video-route',
      isFocused: true,
      value: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
    })

    dispose()
  })

  it('publishes null when duration is missing', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const publishScopedValue = vi.fn()

    createRoot((dispose) => {
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds] = createSignal(12)
      const [durationSeconds] = createSignal<number | null>(null)
      const [isFocused] = createSignal(true)

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue,
      })

      queueMicrotask(dispose)
    })

    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'video-route',
      isFocused: true,
      value: null,
    })
  })

  it('publishes on 15-second bucket transitions', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const publishScopedValue = vi.fn()

    let setCurrentTimeSeconds!: (value: number) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds, updateCurrentTimeSeconds] = createSignal(14)
      const [durationSeconds] = createSignal<number | null>(300)
      const [isFocused] = createSignal(true)
      setCurrentTimeSeconds = updateCurrentTimeSeconds

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue,
      })
    })

    await Promise.resolve()
    publishScopedValue.mockClear()

    setCurrentTimeSeconds(15)
    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'video-route',
      isFocused: true,
      value: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 15,
        durationSeconds: 300,
      },
    })

    dispose()
  })

  it('does not publish when playback stays in the same 15-second bucket', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const publishScopedValue = vi.fn()

    let setCurrentTimeSeconds!: (value: number) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [workName] = createSignal('Spirited Away')
      const [currentTimeSeconds, updateCurrentTimeSeconds] = createSignal(12)
      const [durationSeconds] = createSignal<number | null>(300)
      const [isFocused] = createSignal(true)
      setCurrentTimeSeconds = updateCurrentTimeSeconds

      syncVideoPluginActivity({
        workName,
        currentTimeSeconds,
        durationSeconds,
        isFocused,
        publishScopedValue,
      })
    })

    await Promise.resolve()
    publishScopedValue.mockClear()

    setCurrentTimeSeconds(13)
    await Promise.resolve()

    expect(publishScopedValue).not.toHaveBeenCalled()

    dispose()
  })
})
