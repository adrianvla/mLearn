import { createEffect, onCleanup, type Accessor } from 'solid-js'

import { normalizeReaderAppActivity, type AppActivity } from '../../../../shared/plugins/appActivity'

export const READER_ACTIVITY_SOURCE_ID = 'reader-route'

export type SourceActivityUpdatePayload = {
  sourceId: string
  isFocused: boolean
  activity: AppActivity | null
}

export function publishSourceActivityUpdate(payload: SourceActivityUpdatePayload): void {
  window.mLearnInternal?.publishSourceActivityUpdate(payload)
}

export function createReaderAppActivityPublisher(input: {
  bookTitle: Accessor<string>
  currentPage: Accessor<number>
  pages: Accessor<ArrayLike<unknown>>
  isFocused: Accessor<boolean>
  publishSourceUpdate?: (payload: SourceActivityUpdatePayload) => void
}): void {
  const publishSourceUpdate = input.publishSourceUpdate ?? publishSourceActivityUpdate

  createEffect(() => {
    const isFocused = input.isFocused()
    const activity = isFocused
      ? normalizeReaderAppActivity(
        input.bookTitle(),
        input.currentPage(),
        input.pages().length,
      )
      : null

    publishSourceUpdate({
      sourceId: READER_ACTIVITY_SOURCE_ID,
      isFocused,
      activity,
    })
  })

  onCleanup(() => {
    publishSourceUpdate({
      sourceId: READER_ACTIVITY_SOURCE_ID,
      isFocused: false,
      activity: null,
    })
  })
}
