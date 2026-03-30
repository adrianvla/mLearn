import { createEffect, onCleanup, type Accessor } from 'solid-js'

import { normalizeReaderAppActivity, type AppActivity } from '../../../../shared/plugins/appActivity'

export const READER_ACTIVITY_SOURCE_ID = 'reader-route'

export type ScopedActivityPayload = {
  sourceId: string
  isFocused: boolean
  value: AppActivity | null
}

export function publishScopedActivityValue(payload: ScopedActivityPayload): void {
  window.mLearnInternal?.setScopedPluginValue({
    sourceId: payload.sourceId,
    isFocused: payload.isFocused,
    channel: 'app.user.activity',
    value: payload.value,
  })
}

export function syncReaderPluginActivity(input: {
  bookTitle: Accessor<string>
  currentPage: Accessor<number>
  pages: Accessor<ArrayLike<unknown>>
  isFocused: Accessor<boolean>
  publishScopedValue?: (payload: ScopedActivityPayload) => void
}): void {
  const publishScopedValue = input.publishScopedValue ?? publishScopedActivityValue

  createEffect(() => {
    const isFocused = input.isFocused()
    const value = isFocused
      ? normalizeReaderAppActivity(
        input.bookTitle(),
        input.currentPage(),
        input.pages().length,
      )
      : null

    publishScopedValue({
      sourceId: READER_ACTIVITY_SOURCE_ID,
      isFocused,
      value,
    })
  })

  onCleanup(() => {
    publishScopedValue({
      sourceId: READER_ACTIVITY_SOURCE_ID,
      isFocused: false,
      value: null,
    })
  })
}
