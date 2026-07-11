import { createRoot, createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

describe('syncReaderPluginActivity', () => {
  it('emits one analytics start through the hub for one publisher transition', async () => {
    const { createActivityHub } = await import('../../../services/activityHub')
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const events: string[] = []
    const hub = createActivityHub({
      getPolicyScope: () => ({ activeGroupId: 'class-a', policyVersionId: 'policy-1' }),
      emitEvent: event => events.push(event.type),
    })

    createRoot((dispose) => {
      const [bookTitle] = createSignal('Yotsuba')
      const [currentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused] = createSignal(true)
      syncReaderPluginActivity({
        bookTitle, currentPage, pages, isFocused,
        contentId: () => 'reader-1234',
        language: () => 'de',
        updateSource: hub.updateSource,
        removeSource: hub.removeSource,
      })
      queueMicrotask(dispose)
    })

    await Promise.resolve()
    expect(events.filter(type => type === 'activity.started')).toHaveLength(1)
  })

  it('stops and restarts exactly once across visibility changes while focused', async () => {
    const { createActivityHub } = await import('../../../services/activityHub')
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const events: string[] = []
    const hub = createActivityHub({
      getPolicyScope: () => ({ activeGroupId: 'class-a', policyVersionId: 'policy-1' }),
      emitEvent: event => events.push(event.type),
    })
    let setVisible!: (value: boolean) => void
    let dispose!: () => void
    createRoot(rootDispose => {
      dispose = rootDispose
      const [visible, updateVisible] = createSignal(true)
      setVisible = updateVisible
      syncReaderPluginActivity({
        bookTitle: () => 'Book', currentPage: () => 0, pages: () => [1, 2],
        isFocused: () => true, isVisible: visible, contentId: () => 'reader-hash',
        updateSource: hub.updateSource, removeSource: hub.removeSource,
      })
    })
    await Promise.resolve()
    setVisible(false)
    await Promise.resolve()
    setVisible(true)
    await Promise.resolve()
    expect(events).toEqual(['activity.started', 'activity.stopped', 'activity.started'])
    dispose()
  })

  it('publishes a reader snapshot for a focused qualified source', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const updateSource = vi.fn()

    createRoot((dispose) => {
      const [bookTitle] = createSignal('Yotsuba')
      const [currentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused] = createSignal(true)

      syncReaderPluginActivity({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        updateSource,
      })

      queueMicrotask(dispose)
    })

    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('reader-route', {
      isFocused: true,
      isVisible: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      },
      context: { privacy: 'title-and-progress' },
    })
  })

  it('publishes null when the reader source loses qualification', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const updateSource = vi.fn()

    let setBookTitle!: (value: string) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [bookTitle, updateBookTitle] = createSignal('Yotsuba')
      const [currentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused] = createSignal(true)
      setBookTitle = updateBookTitle

      syncReaderPluginActivity({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        updateSource,
      })
    })

    await Promise.resolve()
    updateSource.mockClear()

    setBookTitle('')
    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('reader-route', {
      isFocused: true,
      isVisible: true,
      activity: { kind: 'idle' },
      context: { privacy: 'title-and-progress' },
    })

    dispose()
  })

  it('publishes a new snapshot immediately when page progress changes', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const updateSource = vi.fn()

    let setCurrentPage!: (value: number) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [bookTitle] = createSignal('Yotsuba')
      const [currentPage, updateCurrentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused] = createSignal(true)
      setCurrentPage = updateCurrentPage

      syncReaderPluginActivity({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        updateSource,
      })
    })

    await Promise.resolve()
    updateSource.mockClear()

    setCurrentPage(3)
    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('reader-route', {
      isFocused: true,
      isVisible: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 4,
        totalPages: 20,
      },
      context: { privacy: 'title-and-progress' },
    })

    dispose()
  })

  it('publishes null when focus changes from true to false', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const updateSource = vi.fn()

    let setIsFocused!: (value: boolean) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [bookTitle] = createSignal('Yotsuba')
      const [currentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused, updateIsFocused] = createSignal(true)
      setIsFocused = updateIsFocused

      syncReaderPluginActivity({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        updateSource,
      })
    })

    await Promise.resolve()
    updateSource.mockClear()

    setIsFocused(false)
    await Promise.resolve()

    expect(updateSource).toHaveBeenCalledWith('reader-route', {
      isFocused: false,
      isVisible: true,
      activity: expect.objectContaining({ kind: 'reader' }),
      context: { privacy: 'title-and-progress' },
    })

    dispose()
  })
})
