import { createRoot, createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

describe('syncVideoPluginActivity', () => {
  it('publishes full source changes even within the same progress bucket', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const updateSource = vi.fn()
    let setContentId!: (value: string) => void
    let setLanguage!: (value: string) => void
    let setVisible!: (value: boolean) => void
    let dispose!: () => void
    createRoot(rootDispose => {
      dispose = rootDispose
      const [contentId, updateContentId] = createSignal('video-a')
      const [language, updateLanguage] = createSignal('de')
      const [visible, updateVisible] = createSignal(true)
      setContentId = updateContentId
      setLanguage = updateLanguage
      setVisible = updateVisible
      syncVideoPluginActivity({
        workName: () => 'Lesson', currentTimeSeconds: () => 12, durationSeconds: () => 60,
        isFocused: () => true, isVisible: visible, contentId, language, updateSource,
      })
    })
    await Promise.resolve()
    updateSource.mockClear()
    setContentId('video-b')
    setLanguage('fr')
    setVisible(false)
    await Promise.resolve()
    expect(updateSource).toHaveBeenCalledTimes(3)
    expect(updateSource).toHaveBeenLastCalledWith('video-route', expect.objectContaining({
      isVisible: false,
      context: { privacy: 'title-and-progress', contentId: 'video-b', language: 'fr' },
    }))
    dispose()
  })

  it('publishes a new snapshot immediately when the work changes', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const updateSource = vi.fn()

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
        updateSource,
      })
    })

    await Promise.resolve()
    updateSource.mockClear()

    setWorkName('Princess Mononoke')
    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      isVisible: true,
      activity: {
        kind: 'video',
        workName: 'Princess Mononoke',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
      context: { privacy: 'title-and-progress' },
    })

    dispose()
  })

  it('publishes a video activity as soon as duration becomes available', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const updateSource = vi.fn()

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
        updateSource,
      })
    })

    await Promise.resolve()
    updateSource.mockClear()

    setDurationSeconds(300)
    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      isVisible: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 12,
        durationSeconds: 300,
      },
      context: { privacy: 'title-and-progress' },
    })

    dispose()
  })

  it('publishes null when duration is missing', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const updateSource = vi.fn()

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
        updateSource,
      })

      queueMicrotask(dispose)
    })

    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      isVisible: true,
      activity: { kind: 'idle' },
      context: { privacy: 'title-and-progress' },
    })
  })

  it('publishes on 15-second bucket transitions', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const updateSource = vi.fn()

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
        updateSource,
      })
    })

    await Promise.resolve()
    updateSource.mockClear()

    setCurrentTimeSeconds(15)
    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('video-route', {
      isFocused: true,
      isVisible: true,
      activity: {
        kind: 'video',
        workName: 'Spirited Away',
        currentTimeSeconds: 15,
        durationSeconds: 300,
      },
      context: { privacy: 'title-and-progress' },
    })

    dispose()
  })

  it('does not publish when playback stays in the same 15-second bucket', async () => {
    const { syncVideoPluginActivity } = await import('./videoPluginActivity')
    const updateSource = vi.fn()

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
        updateSource,
      })
    })

    await Promise.resolve()
    updateSource.mockClear()

    setCurrentTimeSeconds(13)
    await Promise.resolve()

    expect(updateSource).not.toHaveBeenCalled()

    dispose()
  })
})
