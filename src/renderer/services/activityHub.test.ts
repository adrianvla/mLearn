import { describe, expect, it, vi } from 'vitest'
import type { AppActivity, ActivityContext } from '../../shared/plugins/appActivity'
import { createActivityHub } from './activityHub'

const context: ActivityContext = { contentId: 'content-1', privacy: 'title-and-progress' }
const scope = { activeGroupId: 'class-a', policyVersionId: 'policy-a' }
const reader = (name: string): AppActivity => ({ kind: 'reader', workName: name, currentPage: 1, totalPages: 10 })

describe('activity hub', () => {
  it('arbitrates visible focused sources by priority then most recent activation', () => {
    const live: Array<string | null> = []
    const hub = createActivityHub({ getPolicyScope: () => scope })
    hub.subscribeLive(value => live.push(value?.sourceId ?? null))
    hub.updateSource('a', { isFocused: true, isVisible: true, priority: 1, activity: reader('A'), context })
    hub.updateSource('b', { isFocused: true, isVisible: true, priority: 1, activity: reader('B'), context })
    hub.updateSource('c', { isFocused: true, isVisible: true, priority: 2, activity: reader('C'), context })
    hub.updateSource('c', { isFocused: true, isVisible: false, priority: 2, activity: reader('C'), context })
    expect(live).toEqual([null, 'a', 'b', 'c', 'b'])
  })

  it('stops once on focus loss/removal and suppresses structural no-ops', () => {
    const types: string[] = []
    const live = vi.fn()
    const hub = createActivityHub({ getPolicyScope: () => scope, emitEvent: event => types.push(event.type) })
    hub.subscribeLive(live)
    const update = { isFocused: true, activity: reader('A'), context }
    hub.updateSource('a', update)
    hub.updateSource('a', { ...update, activity: { ...reader('A') } })
    hub.updateSource('a', { ...update, isFocused: false })
    hub.removeSource('a')
    expect(types).toEqual(['activity.started', 'activity.stopped'])
    expect(live).toHaveBeenCalledTimes(3)
  })

  it('isolates subscribers from mutation and exceptions and unsubscribes cleanly', () => {
    const second = vi.fn()
    const hub = createActivityHub({ getPolicyScope: () => scope })
    hub.subscribeLive(value => {
      if (value && 'workName' in value.activity) value.activity.workName = 'mutated'
      throw new Error('listener failure')
    })
    const unsubscribe = hub.subscribeLive(second)
    hub.updateSource('a', { isFocused: true, activity: reader('Original'), context })
    expect(second.mock.calls.at(-1)?.[0].activity.workName).toBe('Original')
    unsubscribe()
    hub.updateSource('a', { isFocused: true, activity: { ...reader('Original'), currentPage: 2 }, context })
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('stops and restarts the active source when signed policy scope changes', () => {
    let currentScope = scope
    const types: string[] = []
    const hub = createActivityHub({ getPolicyScope: () => currentScope, emitEvent: event => types.push(`${event.type}:${event.activeGroupId}`) })
    hub.updateSource('a', { isFocused: true, activity: reader('A'), context })
    currentScope = { activeGroupId: 'class-b', policyVersionId: 'policy-b' }
    hub.refreshPolicyScope()
    expect(types).toEqual(['activity.started:class-a', 'activity.stopped:class-a', 'activity.started:class-b'])
  })

  it('stops the previous session before starting the newly active window', () => {
    const events: Array<{ type: string; sourceId: string }> = []
    const hub = createActivityHub({ getPolicyScope: () => scope, emitEvent: event => events.push(event) })
    hub.updateSource('reader', { isFocused: true, activity: reader('A'), context })
    hub.updateSource('cards', { isFocused: true, priority: 1, activity: { kind: 'flashcards' }, context: { privacy: 'progress-only' } })
    hub.removeSource('cards')
    expect(events).toEqual([
      expect.objectContaining({ type: 'activity.started', sourceId: 'reader' }),
      expect.objectContaining({ type: 'activity.stopped', sourceId: 'reader' }),
      expect.objectContaining({ type: 'activity.started', sourceId: 'cards' }),
      expect.objectContaining({ type: 'activity.stopped', sourceId: 'cards' }),
      expect.objectContaining({ type: 'activity.started', sourceId: 'reader' }),
    ])
  })

  it('isolates event subscribers and returned values from internal state', () => {
    const received = vi.fn()
    const hub = createActivityHub({
      getPolicyScope: () => scope,
      emitEvent: () => { throw new Error('queue unavailable') },
    })
    hub.subscribeEvents(event => {
      if ('workName' in event.activity) event.activity.workName = 'mutated'
      throw new Error('consumer failed')
    })
    const unsubscribe = hub.subscribeEvents(received)
    hub.updateSource('reader', { isFocused: true, activity: reader('Original'), context })
    expect(received.mock.calls[0][0].activity.workName).toBe('Original')
    const value = hub.getLive()
    if (value && 'workName' in value.activity) value.activity.workName = 'changed'
    expect(hub.getLive()?.activity).toEqual(reader('Original'))
    unsubscribe()
    hub.removeSource('reader')
    expect(received).toHaveBeenCalledTimes(1)
  })

  it('keeps live projection while holding attributed events until policy scope exists', () => {
    let currentScope: typeof scope | null = null
    const events = vi.fn()
    const live = vi.fn()
    const hub = createActivityHub({ getPolicyScope: () => currentScope, emitEvent: events })
    hub.subscribeLive(live)
    hub.updateSource('a', { isFocused: true, activity: reader('A'), context })
    expect(live.mock.calls.at(-1)?.[0].sourceId).toBe('a')
    expect(events).not.toHaveBeenCalled()
    currentScope = scope
    hub.refreshPolicyScope()
    expect(events).toHaveBeenCalledTimes(1)
  })
})
