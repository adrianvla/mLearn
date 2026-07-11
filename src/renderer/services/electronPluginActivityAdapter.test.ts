import { describe, expect, it, vi } from 'vitest'

import { createActivityHub } from './activityHub'
import { createElectronPluginActivityAdapter } from './electronPluginActivityAdapter'

const context = { privacy: 'title-and-progress' as const, contentId: 'lesson-1', language: 'de' }

describe('ElectronPluginActivityAdapter', () => {
  it('mirrors exact live activity once and clears it on disposal', () => {
    const hub = createActivityHub({ getPolicyScope: () => null })
    const write = vi.fn()
    const dispose = createElectronPluginActivityAdapter(hub, write)

    hub.updateSource('video-route', {
      isFocused: true,
      activity: { kind: 'video', workName: 'Lesson', currentTimeSeconds: 15, durationSeconds: 60 },
      context,
    })
    hub.updateSource('video-route', {
      isFocused: true,
      activity: { kind: 'video', workName: 'Lesson', currentTimeSeconds: 15, durationSeconds: 60 },
      context,
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenLastCalledWith({
      sourceId: 'video-route', isFocused: true, channel: 'app.user.activity',
      value: { kind: 'video', workName: 'Lesson', currentTimeSeconds: 15, durationSeconds: 60 },
    })
    dispose()
    expect(write).toHaveBeenLastCalledWith({
      sourceId: 'video-route', isFocused: false, channel: 'app.user.activity', value: null,
    })
  })

  it('is safe when the Electron bridge is absent or rejects', () => {
    const hub = createActivityHub({ getPolicyScope: () => null })
    const disposeMissing = createElectronPluginActivityAdapter(hub)
    expect(() => hub.updateSource('reader-route', {
      isFocused: true,
      activity: { kind: 'reader', workName: 'Book', currentPage: 1, totalPages: 2 },
      context,
    })).not.toThrow()
    disposeMissing()

    const rejecting = vi.fn(() => { throw new Error('bridge unavailable') })
    const disposeRejecting = createElectronPluginActivityAdapter(hub, rejecting)
    expect(() => hub.removeSource('reader-route')).not.toThrow()
    disposeRejecting()
  })
})
