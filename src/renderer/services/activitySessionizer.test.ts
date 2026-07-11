import { describe, expect, it } from 'vitest'
import type { AppActivity, ActivityContext } from '../../shared/plugins/appActivity'
import { createActivitySessionizer, type ActivityPolicyScope } from './activitySessionizer'

const SCOPE: ActivityPolicyScope = { activeGroupId: 'group-1', policyVersionId: 'policy-1' }
const CONTEXT: ActivityContext = { contentId: 'lesson-1', language: 'de', privacy: 'title-and-progress' }

function video(seconds: number, duration = 120): AppActivity {
  return { kind: 'video', workName: 'Private title', currentTimeSeconds: seconds, durationSeconds: duration }
}

describe('activity sessionizer', () => {
  it('emits one start, coalesced progress, and completion with monotonic sequence', () => {
    const events: string[] = []
    const sessionizer = createActivitySessionizer({
      now: () => new Date('2026-07-11T10:00:00.000Z'),
      uuid: (() => { let id = 0; return () => `id-${++id}` })(),
      emit: event => events.push(`${event.type}:${event.sequence}`),
    })

    sessionizer.update({ sourceId: 'video', activity: video(0), context: CONTEXT }, SCOPE)
    sessionizer.update({ sourceId: 'video', activity: video(5), context: CONTEXT }, SCOPE)
    sessionizer.update({ sourceId: 'video', activity: video(16), context: CONTEXT }, SCOPE)
    sessionizer.update({ sourceId: 'video', activity: video(120), context: CONTEXT }, SCOPE)
    sessionizer.update({ sourceId: 'video', activity: video(120), context: CONTEXT }, SCOPE)

    expect(events).toEqual(['activity.started:1', 'activity.progressed:2', 'activity.completed:3'])
  })

  it('does not emit without scope and starts once attribution becomes available', () => {
    const events: string[] = []
    const sessionizer = createActivitySessionizer({ emit: event => events.push(event.type) })
    const activity = { sourceId: 'reader', activity: { kind: 'reader', workName: 'Book', currentPage: 1, totalPages: 5 } as AppActivity, context: CONTEXT }
    sessionizer.update(activity, null)
    expect(events).toEqual([])
    sessionizer.update(activity, SCOPE)
    expect(events).toEqual(['activity.started'])
  })

  it('redacts titles in progress-only events and restarts on scope or content change', () => {
    const emitted: Array<{ type: string; workName?: string; sessionId: string }> = []
    const sessionizer = createActivitySessionizer({
      uuid: (() => { let id = 0; return () => `id-${++id}` })(),
      emit: event => emitted.push({ type: event.type, workName: 'workName' in event.activity ? event.activity.workName : undefined, sessionId: event.sessionId }),
    })
    const hidden = { ...CONTEXT, privacy: 'progress-only' as const }
    sessionizer.update({ sourceId: 'video', activity: video(1), context: hidden }, SCOPE)
    sessionizer.update({ sourceId: 'video', activity: video(1), context: hidden }, { ...SCOPE, activeGroupId: 'group-2' })
    sessionizer.update({ sourceId: 'video', activity: video(1), context: { ...hidden, contentId: 'lesson-2' } }, { ...SCOPE, activeGroupId: 'group-2' })
    expect(emitted.map(event => event.type)).toEqual(['activity.started', 'activity.stopped', 'activity.started', 'activity.stopped', 'activity.started'])
    expect(emitted.every(event => event.workName === '')).toBe(true)
    expect(new Set(emitted.filter(event => event.type === 'activity.started').map(event => event.sessionId)).size).toBe(3)
  })

  it('restarts in stopped-started order when language or privacy changes', () => {
    const events: Array<{ type: string; sequence: number; privacy: string; language?: string }> = []
    const sessionizer = createActivitySessionizer({
      emit: event => events.push({ type: event.type, sequence: event.sequence, privacy: event.context.privacy, language: event.context.language }),
    })
    const projected = { sourceId: 'reader', activity: { kind: 'reader', workName: 'Book', currentPage: 1, totalPages: 4 } as AppActivity, context: CONTEXT }
    sessionizer.update(projected, SCOPE)
    sessionizer.update({ ...projected, context: { ...CONTEXT, language: 'fr' } }, SCOPE)
    sessionizer.update({ ...projected, context: { ...CONTEXT, language: 'fr', privacy: 'progress-only' } }, SCOPE)
    expect(events).toEqual([
      { type: 'activity.started', sequence: 1, privacy: 'title-and-progress', language: 'de' },
      { type: 'activity.stopped', sequence: 2, privacy: 'title-and-progress', language: 'de' },
      { type: 'activity.started', sequence: 1, privacy: 'title-and-progress', language: 'fr' },
      { type: 'activity.stopped', sequence: 2, privacy: 'title-and-progress', language: 'fr' },
      { type: 'activity.started', sequence: 1, privacy: 'progress-only', language: 'fr' },
    ])
  })

  it('normalizes timestamps to a strictly increasing sequence', () => {
    const timestamps: string[] = []
    const times = [
      new Date('2026-07-11T10:00:00.000Z'),
      new Date('2026-07-11T09:59:00.000Z'),
      new Date('2026-07-11T10:00:00.000Z'),
    ]
    const sessionizer = createActivitySessionizer({ now: () => times.shift()!, emit: event => timestamps.push(event.occurredAt) })
    sessionizer.update({ sourceId: 'reader', activity: { kind: 'reader', workName: 'Book', currentPage: 1, totalPages: 3 }, context: CONTEXT }, SCOPE)
    sessionizer.update({ sourceId: 'reader', activity: { kind: 'reader', workName: 'Book', currentPage: 2, totalPages: 3 }, context: CONTEXT }, SCOPE)
    sessionizer.update(null, SCOPE)
    expect(timestamps).toEqual([
      '2026-07-11T10:00:00.000Z',
      '2026-07-11T10:00:00.001Z',
      '2026-07-11T10:00:00.002Z',
    ])
  })

  it('handles reader progress/completion, backward movement, and reopen', () => {
    const types: string[] = []
    const sessionizer = createActivitySessionizer({ emit: event => types.push(event.type) })
    const reader = (page: number) => ({ sourceId: 'reader', activity: { kind: 'reader', workName: 'Book', currentPage: page, totalPages: 3 } as AppActivity, context: CONTEXT })
    sessionizer.update(reader(1), SCOPE)
    sessionizer.update(reader(2), SCOPE)
    sessionizer.update(reader(1), SCOPE)
    sessionizer.update(reader(3), SCOPE)
    sessionizer.update(null, SCOPE)
    sessionizer.update(reader(3), SCOPE)
    expect(types).toEqual(['activity.started', 'activity.progressed', 'activity.progressed', 'activity.completed', 'activity.stopped', 'activity.started', 'activity.completed'])
  })
})
