import { createRoot, createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

describe('syncReaderPluginActivity', () => {
  it('publishes a reader snapshot for a focused qualified source', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const publishScopedValue = vi.fn()

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
        publishScopedValue,
      })

      queueMicrotask(dispose)
    })

    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'reader-route',
      isFocused: true,
      value: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 3,
        totalPages: 20,
      },
    })
  })

  it('publishes null when the reader source loses qualification', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const publishScopedValue = vi.fn()

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
        publishScopedValue,
      })
    })

    await Promise.resolve()
    publishScopedValue.mockClear()

    setBookTitle('')
    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'reader-route',
      isFocused: true,
      value: null,
    })

    dispose()
  })

  it('publishes a new snapshot immediately when page progress changes', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const publishScopedValue = vi.fn()

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
        publishScopedValue,
      })
    })

    await Promise.resolve()
    publishScopedValue.mockClear()

    setCurrentPage(3)
    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'reader-route',
      isFocused: true,
      value: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 4,
        totalPages: 20,
      },
    })

    dispose()
  })

  it('publishes null when focus changes from true to false', async () => {
    const { syncReaderPluginActivity } = await import('./readerPluginActivity')
    const publishScopedValue = vi.fn()

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
        publishScopedValue,
      })
    })

    await Promise.resolve()
    publishScopedValue.mockClear()

    setIsFocused(false)
    await Promise.resolve()

    expect(publishScopedValue).toHaveBeenCalledWith({
      sourceId: 'reader-route',
      isFocused: false,
      value: null,
    })

    dispose()
  })
})
