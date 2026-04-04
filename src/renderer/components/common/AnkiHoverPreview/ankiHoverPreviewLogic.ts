const DAY_MS = 24 * 60 * 60 * 1000;
const SECOND_MS = 1000;
const MIN_REASONABLE_EPOCH_DAY = 10_000;

export interface AnkiCardSchedulingInfo {
  ease?: number | null;
  due?: number | null;
  queue?: number | null;
  type?: number | null;
  interval?: number | null;
  mod?: number | null;
}

export function shouldShowAnkiEase(ease: number | null | undefined): boolean {
  return ease != null && ease > 0;
}

export function isAnkiNewCard(cardInfo: Pick<AnkiCardSchedulingInfo, 'queue' | 'type'> | null | undefined): boolean {
  return cardInfo?.queue === 0 || cardInfo?.type === 0;
}

function resolveReviewDueTimestamp(cardInfo: Pick<AnkiCardSchedulingInfo, 'due' | 'interval' | 'mod'>): number | null {
  if (typeof cardInfo.due === 'number' && Number.isFinite(cardInfo.due) && cardInfo.due >= MIN_REASONABLE_EPOCH_DAY) {
    return cardInfo.due * DAY_MS;
  }

  if (
    typeof cardInfo.mod === 'number'
    && Number.isFinite(cardInfo.mod)
    && typeof cardInfo.interval === 'number'
    && Number.isFinite(cardInfo.interval)
    && cardInfo.interval > 0
  ) {
    return cardInfo.mod * SECOND_MS + cardInfo.interval * DAY_MS;
  }

  return null;
}

export function resolveAnkiDueTimestamp(cardInfo: AnkiCardSchedulingInfo | null | undefined): number | null {
  if (!cardInfo || isAnkiNewCard(cardInfo)) {
    return null;
  }

  if (cardInfo.queue === 2 || cardInfo.type === 2) {
    return resolveReviewDueTimestamp(cardInfo);
  }

  if (cardInfo.queue === 1 || cardInfo.queue === 3 || cardInfo.type === 1 || cardInfo.type === 3) {
    if (typeof cardInfo.due !== 'number' || !Number.isFinite(cardInfo.due) || cardInfo.due <= 0) {
      return null;
    }

    return cardInfo.due > 10_000_000_000 ? cardInfo.due : cardInfo.due * SECOND_MS;
  }

  return null;
}

export function getAnkiDueDisplayValue(
  cardInfo: AnkiCardSchedulingInfo | null | undefined,
  formatDue: (timestamp: number) => string,
  unseenLabel: string,
): string | null {
  if (!cardInfo) {
    return null;
  }

  if (isAnkiNewCard(cardInfo)) {
    return unseenLabel;
  }

  const dueTimestamp = resolveAnkiDueTimestamp(cardInfo);
  return dueTimestamp == null ? null : formatDue(dueTimestamp);
}