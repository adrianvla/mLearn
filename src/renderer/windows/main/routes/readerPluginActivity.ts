import { createEffect, onCleanup, type Accessor } from 'solid-js'

import { normalizeReaderAppActivity, type ActivityContext } from '../../../../shared/plugins/appActivity'
import { activityHub } from '../../../services/activityHubRuntime'

export const READER_ACTIVITY_SOURCE_ID = 'reader-route'

export function syncReaderPluginActivity(input: {
  bookTitle: Accessor<string>
  currentPage: Accessor<number>
  pages: Accessor<ArrayLike<unknown>>
  isFocused: Accessor<boolean>
  isVisible?: Accessor<boolean>
  contentId?: Accessor<string | undefined>
  language?: Accessor<string | undefined>
  updateSource?: typeof activityHub.updateSource
  removeSource?: typeof activityHub.removeSource
}): void {
  const updateSource = input.updateSource ?? activityHub.updateSource
  const removeSource = input.removeSource ?? activityHub.removeSource

  createEffect(() => {
    const isFocused = input.isFocused()
    const activity = normalizeReaderAppActivity(
        input.bookTitle(),
        input.currentPage(),
        input.pages().length,
      )
    const context: ActivityContext = {
      privacy: 'title-and-progress',
      ...(input.contentId?.() ? { contentId: input.contentId() } : {}),
      ...(input.language?.() ? { language: input.language() } : {}),
    }
    updateSource(READER_ACTIVITY_SOURCE_ID, {
      isFocused,
      isVisible: input.isVisible?.() ?? true,
      activity: activity ?? { kind: 'idle' },
      context,
    })
  })

  onCleanup(() => removeSource(READER_ACTIVITY_SOURCE_ID))
}
