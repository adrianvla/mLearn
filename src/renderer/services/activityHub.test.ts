import { describe, expect, it, vi } from 'vitest'
import type { AppActivity, ActivityContext } from '../../shared/plugins/appActivity'
import { compareActivitySourceCandidates, createActivityHub } from './activityHub'

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

  it('projects exact per-kind schemas and strips malicious extra text', () => {
    const emitted: unknown[] = []
    const hub = createActivityHub({ getPolicyScope: () => scope, emitEvent: event => emitted.push(event) })
    const cases = [
      { sourceId: 'idle', activity: { kind: 'idle', prompt: 'secret' }, context: { privacy: 'title-and-progress', userText: 'secret' } },
      { sourceId: 'reader', activity: { kind: 'reader', workName: 'Book', currentPage: 1, totalPages: 2, documentText: 'secret', nested: { prompt: 'secret' } }, context: { contentId: 'book-1', language: 'de', privacy: 'title-and-progress', ocrText: 'secret' } },
      { sourceId: 'video', activity: { kind: 'video', workName: 'Film', currentTimeSeconds: 1, durationSeconds: 20, subtitleText: 'secret' }, context: { contentId: 'film-1', privacy: 'title-and-progress', prompt: 'secret' } },
      { sourceId: 'cards', activity: { kind: 'flashcards', answerText: 'secret' }, context: { privacy: 'progress-only', cardText: 'secret' } },
    ] as const
    for (const item of cases) {
      hub.updateSource(item.sourceId, { isFocused: true, priority: 1, activity: item.activity as unknown as AppActivity, context: item.context as unknown as ActivityContext })
      const live = hub.getLive()
      expect(JSON.stringify(live)).not.toContain('secret')
    }
    expect(JSON.stringify(emitted)).not.toContain('secret')
  })

  it('rejects malformed activity and attribution without poisoning safe live state', () => {
    let currentScope: typeof scope | null = scope
    const events = vi.fn()
    const live = vi.fn()
    const hub = createActivityHub({ getPolicyScope: () => currentScope, emitEvent: events })
    hub.subscribeLive(live)
    const invalidActivities = [
      { kind: 'reader', workName: 'Book', currentPage: 0, totalPages: 2 },
      { kind: 'reader', workName: 'Book', currentPage: 3, totalPages: 2 },
      { kind: 'video', workName: 'Film', currentTimeSeconds: Number.NaN, durationSeconds: 10 },
      { kind: 'video', workName: 'Film', currentTimeSeconds: 1, durationSeconds: Number.POSITIVE_INFINITY },
      { kind: 'unknown' },
    ]
    for (const activity of invalidActivities) {
      hub.updateSource('bad', { isFocused: true, activity: activity as AppActivity, context })
    }
    expect(events).not.toHaveBeenCalled()
    expect(hub.getLive()).toBeNull()

    hub.updateSource('safe', { isFocused: true, activity: reader('Safe'), context: { privacy: 'invalid' } as ActivityContext })
    expect(hub.getLive()?.activity).toEqual(reader('Safe'))
    expect(events).not.toHaveBeenCalled()
    currentScope = { activeGroupId: '', policyVersionId: 'policy-a' }
    hub.updateSource('safe', { isFocused: true, activity: { ...reader('Safe'), currentPage: 2 }, context })
    expect(events).not.toHaveBeenCalled()
  })

  it('rejects invalid optional identifiers, generated IDs, and clocks', () => {
    const events = vi.fn()
    const badIds = createActivityHub({ getPolicyScope: () => scope, uuid: () => '', emitEvent: events })
    badIds.updateSource('reader', { isFocused: true, activity: reader('Book'), context })
    expect(events).not.toHaveBeenCalled()
    const badClock = createActivityHub({ getPolicyScope: () => scope, now: () => new Date(Number.NaN), emitEvent: events })
    badClock.updateSource('reader', { isFocused: true, activity: reader('Book'), context })
    expect(events).not.toHaveBeenCalled()
    const hub = createActivityHub({ getPolicyScope: () => scope, emitEvent: events })
    hub.updateSource('', { isFocused: true, activity: reader('Book'), context })
    hub.updateSource('reader', { isFocused: true, activity: reader('Book'), context: { ...context, contentId: '' } })
    hub.updateSource('reader', { isFocused: true, activity: reader('Book'), context: { ...context, language: 'x'.repeat(300) } })
    expect(events).not.toHaveBeenCalled()
  })

  it('uses source ID as a deterministic final tie break', () => {
    const candidates = [
      ['z', { priority: 1, activation: 4 }],
      ['a', { priority: 1, activation: 4 }],
    ] as const
    expect([...candidates].sort(compareActivitySourceCandidates).map(([id]) => id)).toEqual(['a', 'z'])
  })

  it('tracks an explicit flashcard lifecycle without duplicate progress', () => {
    const types: string[] = []
    const hub = createActivityHub({ getPolicyScope: () => scope, emitEvent: event => types.push(event.type) })
    const cards = { isFocused: true, activity: { kind: 'flashcards' } as const, context: { privacy: 'progress-only' as const } }
    hub.updateSource('cards', cards)
    hub.updateSource('cards', { ...cards, activity: { kind: 'flashcards' } })
    hub.updateSource('cards', { ...cards, isFocused: false })
    hub.removeSource('cards')
    expect(types).toEqual(['activity.started', 'activity.stopped'])
  })

  it('never exposes a progress-only title to subscribers or through mutation', () => {
    const observed: string[] = []
    const hub = createActivityHub({ getPolicyScope: () => scope })
    hub.subscribeEvents(event => {
      if ('workName' in event.activity) {
        observed.push(event.activity.workName)
        ;(event.activity as { workName: string }).workName = 'attempted mutation'
      }
    })
    hub.subscribeEvents(event => {
      if ('workName' in event.activity) observed.push(event.activity.workName)
    })
    hub.updateSource('reader', { isFocused: true, activity: reader('Confidential'), context: { privacy: 'progress-only' } })
    expect(observed).toEqual(['', ''])
  })
})
