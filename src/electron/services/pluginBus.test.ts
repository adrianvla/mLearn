import { describe, expect, it, vi } from 'vitest'
import type { AppActivity } from '../../shared/plugins/appActivity'
import {
  type PluginBusEnvelope,
  createPluginBusStore,
} from './pluginBus'

function expectEnvelope<T>(value: PluginBusEnvelope<T>, expected: PluginBusEnvelope<T>) {
  expect(value).toEqual(expected)
}

const MISSING_ENVELOPE = { hasValue: false, value: null } as const

function readerActivity(workName: string, currentPage: number): AppActivity {
  return {
    kind: 'reader',
    workName,
    currentPage,
    totalPages: 100,
  }
}

describe('pluginBus', () => {
  it('returns missing for an unset value channel', () => {
    const store = createPluginBusStore()

    expectEnvelope(store.getPluginValue('shared.theme'), MISSING_ENVELOPE)
  })

  it('distinguishes explicit null from missing values', () => {
    const store = createPluginBusStore()

    store.setPluginValue({ scope: 'app' }, 'shared.selection', null)

    expectEnvelope(store.getPluginValue('shared.selection'), {
      hasValue: true,
      value: null,
    })
  })

  it('treats structurally equal json objects as unchanged', () => {
    const store = createPluginBusStore()
    const listener = vi.fn()

    store.onPluginValue('shared.state', listener)
    listener.mockClear()

    store.setPluginValue({ scope: 'app' }, 'shared.state', {
      first: 1,
      second: 2,
    })
    store.setPluginValue({ scope: 'app' }, 'shared.state', {
      second: 2,
      first: 1,
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expectEnvelope(store.getPluginValue('shared.state'), {
      hasValue: true,
      value: { first: 1, second: 2 },
    })
  })

  it('calls value subscribers immediately with current and previous envelopes', () => {
    const store = createPluginBusStore()
    const listener = vi.fn()

    store.setPluginValue({ scope: 'app' }, 'shared.theme', 'dark')

    const unsubscribe = store.onPluginValue('shared.theme', listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expectEnvelope(listener.mock.calls[0][0], {
      hasValue: true,
      value: 'dark',
    })
    expectEnvelope(listener.mock.calls[0][1], MISSING_ENVELOPE)

    unsubscribe()
    store.setPluginValue({ scope: 'app' }, 'shared.theme', 'light')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('emits next and previous envelopes to value listeners on change', () => {
    const store = createPluginBusStore()
    const listener = vi.fn()

    store.onPluginValue('shared.theme', listener)
    listener.mockClear()

    store.setPluginValue({ scope: 'app' }, 'shared.theme', 'dark')

    expect(listener).toHaveBeenCalledTimes(1)
    expectEnvelope(listener.mock.calls[0][0], {
      hasValue: true,
      value: 'dark',
    })
    expectEnvelope(listener.mock.calls[0][1], MISSING_ENVELOPE)
  })

  it('supports event subscription and unsubscribe', () => {
    const store = createPluginBusStore()
    const listener = vi.fn()
    const unsubscribe = store.onPluginEvent('shared.command', listener)

    store.emitPluginEvent({ scope: 'app' }, 'shared.command', { action: 'refresh' })
    unsubscribe()
    store.emitPluginEvent({ scope: 'app' }, 'shared.command', { action: 'refresh-again' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ action: 'refresh' })
  })

  it('allows app writers to publish app and shared channels', () => {
    const store = createPluginBusStore()

    store.setPluginValue({ scope: 'app' }, 'app.layout.mode', 'split')
    store.setPluginValue({ scope: 'app' }, 'shared.locale', 'ja')

    expectEnvelope(store.getPluginValue('app.layout.mode'), { hasValue: true, value: 'split' })
    expectEnvelope(store.getPluginValue('shared.locale'), { hasValue: true, value: 'ja' })
  })

  it('allows a plugin writer to publish its own namespace and shared channels', () => {
    const store = createPluginBusStore()

    store.setPluginValue({ scope: 'plugin', pluginId: 'demo.plugin' }, 'plugin.demo.plugin.state', { ready: true })
    store.setPluginValue({ scope: 'plugin', pluginId: 'demo.plugin' }, 'shared.selection', 'word-1')

    expectEnvelope(store.getPluginValue('plugin.demo.plugin.state'), {
      hasValue: true,
      value: { ready: true },
    })
    expectEnvelope(store.getPluginValue('shared.selection'), { hasValue: true, value: 'word-1' })
  })

  it('rejects plugin writes to app channels', () => {
    const store = createPluginBusStore()

    expect(() => {
      store.setPluginValue({ scope: 'plugin', pluginId: 'demo.plugin' }, 'app.user.activity', { kind: 'idle' })
    }).toThrow('cannot publish to channel')
  })

  it('rejects plugin writes to another plugin namespace', () => {
    const store = createPluginBusStore()

    expect(() => {
      store.setPluginValue({ scope: 'plugin', pluginId: 'demo.plugin' }, 'plugin.other.plugin.state', true)
    }).toThrow('cannot publish to channel')
  })

  it('resolves app.user.activity from the most recently focused source', () => {
    const store = createPluginBusStore()
    const firstActivity = readerActivity('Genki', 5)
    const secondActivity = {
      kind: 'video',
      workName: 'Anime',
      currentTimeSeconds: 90,
      durationSeconds: 120,
    } satisfies AppActivity

    store.setPluginValue({ scope: 'app', sourceId: 'source-a' }, 'app.user.activity', firstActivity)
    store.setPluginValue({ scope: 'app', sourceId: 'source-b' }, 'app.user.activity', secondActivity)

    expectEnvelope(store.getPluginValue('app.user.activity'), {
      hasValue: true,
      value: secondActivity,
    })
  })

  it('clears stale app.user.activity when the active source is unfocused', () => {
    const store = createPluginBusStore()

    store.setPluginValue(
      { scope: 'app', sourceId: 'source-a' },
      'app.user.activity',
      readerActivity('Genki', 5),
    )
    store.setAppSourceFocused('source-a', false)

    expectEnvelope(store.getPluginValue('app.user.activity'), MISSING_ENVELOPE)
  })

  it('clears stale app.user.activity when the active source is removed', () => {
    const store = createPluginBusStore()

    store.setPluginValue(
      { scope: 'app', sourceId: 'source-a' },
      'app.user.activity',
      readerActivity('Genki', 5),
    )
    store.removeAppSource('source-a')

    expectEnvelope(store.getPluginValue('app.user.activity'), MISSING_ENVELOPE)
  })

  it('notifies app.user.activity subscribers immediately and suppresses structural no-ops', () => {
    const store = createPluginBusStore()
    const listener = vi.fn()

    store.onPluginValue('app.user.activity', listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expectEnvelope(listener.mock.calls[0][0], MISSING_ENVELOPE)
    expectEnvelope(listener.mock.calls[0][1], MISSING_ENVELOPE)

    store.setPluginValue(
      { scope: 'app', sourceId: 'source-a' },
      'app.user.activity',
      readerActivity('Genki', 5),
    )
    store.setPluginValue(
      { scope: 'app', sourceId: 'source-a' },
      'app.user.activity',
      {
        totalPages: 100,
        currentPage: 5,
        workName: 'Genki',
        kind: 'reader',
      } satisfies AppActivity,
    )

    expect(listener).toHaveBeenCalledTimes(2)
    expectEnvelope(listener.mock.calls[1][0], {
      hasValue: true,
      value: readerActivity('Genki', 5),
    })
    expectEnvelope(listener.mock.calls[1][1], MISSING_ENVELOPE)
  })

  it('keeps generic equality structural for app activity values', () => {
    const store = createPluginBusStore()
    const listener = vi.fn()

    store.onPluginValue('shared.activity', listener)
    listener.mockClear()

    store.setPluginValue({ scope: 'app' }, 'shared.activity', {
      kind: 'reader',
      workName: 'Genki',
      currentPage: 5,
      totalPages: 100,
    })
    store.setPluginValue({ scope: 'app' }, 'shared.activity', {
      totalPages: 100,
      currentPage: 5,
      workName: 'Genki',
      kind: 'reader',
    })

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
