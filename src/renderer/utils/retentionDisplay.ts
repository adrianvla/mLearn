export type RetentionColor = 'success' | 'warning' | 'error' | 'default';

export interface RetentionDisplay {
  /** "92.4%" or an em-dash when there are no reviews in the window. */
  text: string;
  color: RetentionColor;
}

export const RETENTION_THRESHOLD_GOOD = 90;
export const RETENTION_THRESHOLD_OK = 80;

export function retentionDisplay(rate: number, totalReviews: number): RetentionDisplay {
  if (totalReviews === 0) {
    return { text: '—', color: 'default' };
  }
  return {
    text: `${rate.toFixed(1)}%`,
    color: rate >= RETENTION_THRESHOLD_GOOD ? 'success' : rate >= RETENTION_THRESHOLD_OK ? 'warning' : 'error',
  };
}
