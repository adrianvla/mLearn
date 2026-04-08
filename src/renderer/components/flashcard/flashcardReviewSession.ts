export function getSessionProgress(cardsAnswered: number, cardsRemaining: number): number {
  const answered = Math.max(0, cardsAnswered);
  const remaining = Math.max(0, cardsRemaining);
  const total = answered + remaining;

  if (total === 0) {
    return 100;
  }

  return Math.round((answered / total) * 100);
}