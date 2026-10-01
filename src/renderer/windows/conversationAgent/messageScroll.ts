export interface MessageScrollMetrics { top: number; height: number; viewport: number }

/** Content hydration and composer resizing are not a request to read history. */
export function followsTailAfterScroll(following: boolean, previous: MessageScrollMetrics | undefined, current: MessageScrollMetrics): boolean {
  if (previous && (previous.height !== current.height || previous.viewport !== current.viewport)) return following;
  return current.height - current.viewport - current.top < 80;
}
