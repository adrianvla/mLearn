export type AppActivity =
  | { kind: 'idle' }
  | {
      kind: 'reader'
      workName: string
      currentPage: number
      totalPages: number
    }
  | {
      kind: 'video'
      workName: string
      currentTimeSeconds: number
      durationSeconds: number | null
    }
  | { kind: 'flashcards' }

export function isSameAppActivity(
  left: AppActivity,
  right: AppActivity,
): boolean {
  if (left.kind !== right.kind) {
    return false
  }

  switch (left.kind) {
    case 'idle':
    case 'flashcards':
      return true
    case 'reader':
      return right.kind === 'reader'
        && left.workName === right.workName
        && left.currentPage === right.currentPage
        && left.totalPages === right.totalPages
    case 'video':
      return right.kind === 'video'
        && left.workName === right.workName
        && left.currentTimeSeconds === right.currentTimeSeconds
        && left.durationSeconds === right.durationSeconds
  }
}

export function shouldEmitVideoProgressUpdate(
  previousTimeSeconds: number,
  nextTimeSeconds: number,
): boolean {
  return Math.floor(previousTimeSeconds / 15) !== Math.floor(nextTimeSeconds / 15)
}

export function normalizeReaderAppActivity(
  workName: string,
  zeroBasedPage: number,
  totalPages: number,
): AppActivity | null {
  if (!workName || totalPages <= 0) {
    return null
  }

  return {
    kind: 'reader',
    workName,
    currentPage: zeroBasedPage + 1,
    totalPages,
  }
}

export function normalizeVideoAppActivity(
  workName: string,
  currentTimeSeconds: number,
  durationSeconds: number | null,
): AppActivity | null {
  if (!workName || durationSeconds === null) {
    return null
  }

  return {
    kind: 'video',
    workName,
    currentTimeSeconds,
    durationSeconds,
  }
}
