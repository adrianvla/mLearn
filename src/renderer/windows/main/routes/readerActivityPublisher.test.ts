import { createRoot, createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'

describe('createReaderAppActivityPublisher', () => {
  it('publishes a reader snapshot for a focused qualified source', async () => {
    const { createReaderAppActivityPublisher } = await import('./readerActivityPublisher')
    const publishSourceUpdate = vi.fn()

    createRoot((dispose) => {
      const [bookTitle] = createSignal('Yotsuba')
      const [currentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused] = createSignal(true)

      createReaderAppActivityPublisher({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        publishSourceUpdate,
      })

      queueMicrotask(dispose)
    })

    await Promise.resolve()

    expect(publishSourceUpdate).toHaveBeenCalledWith({
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

  it('publishes idle when the reader source loses qualification', async () => {
    const { createReaderAppActivityPublisher } = await import('./readerActivityPublisher')
    const publishSourceUpdate = vi.fn()

    let setBookTitle!: (value: string) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [bookTitle, updateBookTitle] = createSignal('Yotsuba')
      const [currentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused] = createSignal(true)
      setBookTitle = updateBookTitle

      createReaderAppActivityPublisher({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        publishSourceUpdate,
      })
    })

    await Promise.resolve()
    publishSourceUpdate.mockClear()

    setBookTitle('')
    await Promise.resolve()

    expect(publishSourceUpdate).toHaveBeenCalledWith({
      sourceId: 'reader-route',
      isFocused: true,
      activity: null,
    })

    dispose()
  })

  it('publishes a new snapshot immediately when page progress changes', async () => {
    const { createReaderAppActivityPublisher } = await import('./readerActivityPublisher')
    const publishSourceUpdate = vi.fn()

    let setCurrentPage!: (value: number) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [bookTitle] = createSignal('Yotsuba')
      const [currentPage, updateCurrentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused] = createSignal(true)
      setCurrentPage = updateCurrentPage

      createReaderAppActivityPublisher({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        publishSourceUpdate,
      })
    })

    await Promise.resolve()
    publishSourceUpdate.mockClear()

    setCurrentPage(3)
    await Promise.resolve()

    expect(publishSourceUpdate).toHaveBeenCalledWith({
      sourceId: 'reader-route',
      isFocused: true,
      activity: {
        kind: 'reader',
        workName: 'Yotsuba',
        currentPage: 4,
        totalPages: 20,
      },
    })

    dispose()
  })

  it('publishes idle when focus changes from true to false', async () => {
    const { createReaderAppActivityPublisher } = await import('./readerActivityPublisher')
    const publishSourceUpdate = vi.fn()

    let setIsFocused!: (value: boolean) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [bookTitle] = createSignal('Yotsuba')
      const [currentPage] = createSignal(2)
      const [pages] = createSignal(new Array(20).fill({}))
      const [isFocused, updateIsFocused] = createSignal(true)
      setIsFocused = updateIsFocused

      createReaderAppActivityPublisher({
        bookTitle,
        currentPage,
        pages,
        isFocused,
        publishSourceUpdate,
      })
    })

    await Promise.resolve()
    publishSourceUpdate.mockClear()

    setIsFocused(false)
    await Promise.resolve()

    expect(publishSourceUpdate).toHaveBeenCalledWith({
      sourceId: 'reader-route',
      isFocused: false,
      activity: null,
    })

    dispose()
  })
})
