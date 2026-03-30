import { describe, expect, it, vi } from 'vitest'
import type { AppActivity } from '../../shared/plugins/appActivity'
import {
  createPluginAppActivityStore,
} from './pluginAppActivity'

function readerActivity(workName: string, currentPage: number): AppActivity {
  return {
    kind: 'reader',
    workName,
    currentPage,
    totalPages: 100,
  }
}

describe('pluginAppActivity', () => {
  it('returns idle when no focused supported source exists', () => {
    const store = createPluginAppActivityStore()

    store.updateSource('source-a', {
      isFocused: false,
      activity: readerActivity('Genki', 1),
    })

    expect(store.getCurrentActivity()).toEqual({ kind: 'idle' })
  })

  it('uses the focused supported source activity', () => {
    const store = createPluginAppActivityStore()
    const activity = readerActivity('Tobira', 12)

    store.updateSource('source-a', {
      isFocused: true,
      activity,
    })

    expect(store.getCurrentActivity()).toEqual(activity)
  })

  it('falls back to idle when all sources are unfocused', () => {
    const store = createPluginAppActivityStore()

    store.updateSource('source-a', {
      isFocused: true,
      activity: readerActivity('Genki', 5),
    })
    store.updateSource('source-a', {
      isFocused: false,
      activity: readerActivity('Genki', 6),
    })

    expect(store.getCurrentActivity()).toEqual({ kind: 'idle' })
  })

  it('ignores unfocused updates while another focused source is active', () => {
    const store = createPluginAppActivityStore()
    const subscriber = vi.fn()

    store.subscribe(subscriber)
    store.updateSource('source-a', {
      isFocused: true,
      activity: readerActivity('Genki', 5),
    })
    store.updateSource('source-b', {
      isFocused: false,
      activity: {
        kind: 'video',
        workName: 'Anime',
        currentTimeSeconds: 30,
        durationSeconds: 120,
      },
    })

    expect(store.getCurrentActivity()).toEqual(readerActivity('Genki', 5))
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('switches to the most recently focused supported source', () => {
    const store = createPluginAppActivityStore()
    const firstActivity = readerActivity('Genki', 5)
    const secondActivity = {
      kind: 'video',
      workName: 'Anime',
      currentTimeSeconds: 90,
      durationSeconds: 120,
    } satisfies AppActivity

    store.updateSource('source-a', {
      isFocused: true,
      activity: firstActivity,
      updatedAt: 10,
    })
    store.updateSource('source-b', {
      isFocused: true,
      activity: secondActivity,
      updatedAt: 20,
    })

    expect(store.getCurrentActivity()).toEqual(secondActivity)
  })

  it('uses updatedAt ordering when focused source updates arrive out of order', () => {
    const store = createPluginAppActivityStore()
    const newerActivity = readerActivity('Genki', 5)
    const olderActivity = {
      kind: 'video',
      workName: 'Anime',
      currentTimeSeconds: 90,
      durationSeconds: 120,
    } satisfies AppActivity

    store.updateSource('source-a', {
      isFocused: true,
      activity: newerActivity,
      updatedAt: 20,
    })
    store.updateSource('source-b', {
      isFocused: true,
      activity: olderActivity,
      updatedAt: 10,
    })

    expect(store.getCurrentActivity()).toEqual(newerActivity)
  })

  it('keeps the most recently focused source active when another focused source updates later', () => {
    const store = createPluginAppActivityStore()
    const firstActivity = readerActivity('Genki', 5)
    const secondActivity = {
      kind: 'video',
      workName: 'Anime',
      currentTimeSeconds: 90,
      durationSeconds: 120,
    } satisfies AppActivity

    store.updateSource('source-a', {
      isFocused: true,
      activity: firstActivity,
      updatedAt: 10,
    })
    store.updateSource('source-b', {
      isFocused: true,
      activity: secondActivity,
      updatedAt: 20,
    })
    store.updateSource('source-a', {
      isFocused: true,
      activity: readerActivity('Genki', 6),
      updatedAt: 30,
    })

    expect(store.getCurrentActivity()).toEqual(secondActivity)
  })

  it('uses internal focus ordering when caller-provided updatedAt is mixed with implicit updates', () => {
    const store = createPluginAppActivityStore()
    const firstActivity = readerActivity('Genki', 5)
    const secondActivity = {
      kind: 'video',
      workName: 'Anime',
      currentTimeSeconds: 90,
      durationSeconds: 120,
    } satisfies AppActivity

    store.updateSource('source-a', {
      isFocused: true,
      activity: firstActivity,
      updatedAt: 10_000,
    })
    store.updateSource('source-b', {
      isFocused: true,
      activity: secondActivity,
    })

    expect(store.getCurrentActivity()).toEqual(secondActivity)
  })

  it('emits idle once when the active activity transitions back to idle', () => {
    const store = createPluginAppActivityStore()
    const subscriber = vi.fn()

    store.subscribe(subscriber)
    store.updateSource('source-a', {
      isFocused: true,
      activity: readerActivity('Genki', 5),
    })
    store.updateSource('source-a', {
      isFocused: false,
      activity: readerActivity('Genki', 6),
    })

    expect(subscriber).toHaveBeenCalledTimes(2)
    expect(subscriber).toHaveBeenNthCalledWith(2, { kind: 'idle' })
  })

  it('stops notifying a subscriber after cleanup', () => {
    const store = createPluginAppActivityStore()
    const subscriber = vi.fn()
    const unsubscribe = store.subscribe(subscriber)

    store.updateSource('source-a', {
      isFocused: true,
      activity: readerActivity('Genki', 5),
    })
    unsubscribe()
    store.updateSource('source-a', {
      isFocused: false,
      activity: readerActivity('Genki', 6),
    })

    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(subscriber).toHaveBeenCalledWith(readerActivity('Genki', 5))
  })

  it('suppresses subscriber callbacks for semantically identical snapshots', () => {
    const store = createPluginAppActivityStore()
    const subscriber = vi.fn()

    store.subscribe(subscriber)
    store.updateSource('source-a', {
      isFocused: true,
      activity: readerActivity('Genki', 5),
      updatedAt: 10,
    })
    store.updateSource('source-a', {
      isFocused: true,
      activity: readerActivity('Genki', 5),
      updatedAt: 20,
    })

    expect(store.getCurrentActivity()).toEqual(readerActivity('Genki', 5))
    expect(subscriber).toHaveBeenCalledTimes(1)
  })
})
