import { describe, expect, it } from 'vitest'

import { opaqueActivityContentId } from './activityHubRuntime'

describe('opaqueActivityContentId', () => {
  it('uses a deterministic collision-resistant digest and never exposes source text', () => {
    const raw = '/Users/learner/private/German Class/My Book.epub'
    const first = opaqueActivityContentId('reader', raw)
    const second = opaqueActivityContentId('reader', raw)
    const other = opaqueActivityContentId('video', raw)

    expect(first).toBe(second)
    expect(first).toMatch(/^reader-[a-f0-9]{64}$/)
    expect(other).toMatch(/^video-[a-f0-9]{64}$/)
    expect(first).not.toContain('German')
    expect(first).not.toContain('Book')
    expect(first).not.toBe(other)
  })

  it('does not produce an identifier without a source identity', () => {
    expect(opaqueActivityContentId('reader', '')).toBeUndefined()
  })
})
