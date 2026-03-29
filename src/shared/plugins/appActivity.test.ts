import { describe, expect, it } from 'vitest'

import {
  isSameAppActivity,
  normalizeReaderAppActivity,
  normalizeVideoAppActivity,
  shouldEmitVideoProgressUpdate,
} from '@shared/plugins/appActivity'

describe('isSameAppActivity', () => {
  it('returns true for identical idle activities', () => {
    expect(isSameAppActivity({ kind: 'idle' }, { kind: 'idle' })).toBe(true)
  })

  it('returns true for identical flashcards activities', () => {
    expect(isSameAppActivity({ kind: 'flashcards' }, { kind: 'flashcards' })).toBe(true)
  })

  it('returns false for different activity kinds', () => {
    expect(isSameAppActivity({ kind: 'idle' }, { kind: 'flashcards' })).toBe(false)
  })

  it('returns false for reader activities with different page progress', () => {
    expect(
      isSameAppActivity(
        { kind: 'reader', workName: 'Book', currentPage: 14, totalPages: 20 },
        { kind: 'reader', workName: 'Book', currentPage: 15, totalPages: 20 },
      ),
    ).toBe(false)
  })

  it('returns false for reader activities with different work names', () => {
    expect(
      isSameAppActivity(
        { kind: 'reader', workName: 'Book A', currentPage: 14, totalPages: 20 },
        { kind: 'reader', workName: 'Book B', currentPage: 14, totalPages: 20 },
      ),
    ).toBe(false)
  })

  it('returns false for reader activities with different total pages', () => {
    expect(
      isSameAppActivity(
        { kind: 'reader', workName: 'Book', currentPage: 14, totalPages: 20 },
        { kind: 'reader', workName: 'Book', currentPage: 14, totalPages: 21 },
      ),
    ).toBe(false)
  })

  it('compares video activities with null duration correctly', () => {
    expect(
      isSameAppActivity(
        {
          kind: 'video',
          workName: 'Episode 1',
          currentTimeSeconds: 30,
          durationSeconds: null,
        },
        {
          kind: 'video',
          workName: 'Episode 1',
          currentTimeSeconds: 30,
          durationSeconds: null,
        },
      ),
    ).toBe(true)
  })

  it('returns false for video activities with different durations', () => {
    expect(
      isSameAppActivity(
        {
          kind: 'video',
          workName: 'Episode 1',
          currentTimeSeconds: 30,
          durationSeconds: null,
        },
        {
          kind: 'video',
          workName: 'Episode 1',
          currentTimeSeconds: 30,
          durationSeconds: 120,
        },
      ),
    ).toBe(false)
  })
})

describe('shouldEmitVideoProgressUpdate', () => {
  it('returns false when playback stays in the same 15-second bucket', () => {
    expect(shouldEmitVideoProgressUpdate(14, 14.9)).toBe(false)
  })

  it('returns true when playback enters a new 15-second bucket', () => {
    expect(shouldEmitVideoProgressUpdate(14, 15)).toBe(true)
  })
})

describe('normalizeReaderAppActivity', () => {
  it('normalizes reader progress to a 1-based snapshot', () => {
    expect(normalizeReaderAppActivity('Yotsuba', 2, 20)).toEqual({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    })
  })

  it('returns null when the work name is empty or total pages is not positive', () => {
    expect(normalizeReaderAppActivity('', 2, 20)).toBeNull()
    expect(normalizeReaderAppActivity('Yotsuba', 2, 0)).toBeNull()
  })
})

describe('normalizeVideoAppActivity', () => {
  it('returns null until duration is known', () => {
    expect(normalizeVideoAppActivity('Spirited Away', 12, null)).toBeNull()
  })

  it('returns a video activity when duration is known', () => {
    expect(normalizeVideoAppActivity('Spirited Away', 12, 300)).toEqual({
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 12,
      durationSeconds: 300,
    })
  })
})
