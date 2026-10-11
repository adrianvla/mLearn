export interface LapseRateDisplay {
  /** "8.4%" or an em-dash when the window has no review records. */
  text: string;
}

export function lapseRateDisplay(rate: number, totalReviews: number): LapseRateDisplay {
  return { text: totalReviews === 0 ? '—' : `${rate.toFixed(1)}%` };
}
