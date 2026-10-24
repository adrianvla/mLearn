import type { SourceAnchor } from '@mlearn/contracts';

const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum = 512, required = true): value is string =>
  typeof value === 'string' && (!required || value.length > 0) && encoder.encode(value).length <= maximum;
const uint = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295;
const nullable = (value: unknown, guard: (value: unknown) => boolean) => value === null || guard(value);

/** The shared native source boundary used by authored Material and conversation. */
export function isSourceAnchor(value: unknown): value is SourceAnchor {
  if (!object(value) || !text(value.sourceId) || !text(value.contentRevision) || !text(value.packageId)
    || !text(value.packageVersion) || !text(value.text, 32768, false) || !object(value.locator)) return false;
  const locator = value.locator;
  const bytes = encoder.encode(value.text);
  const selection = () => uint(locator.selectionStart) && uint(locator.selectionEnd)
    && locator.selectionStart < locator.selectionEnd && locator.selectionEnd <= bytes.length
    && [locator.selectionStart, locator.selectionEnd].every(offset =>
      offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80);
  if (locator.kind === 'document' || locator.kind === 'image' || locator.kind === 'message') {
    const location = locator.kind === 'document'
      ? text(locator.parserRevision) && text(locator.resource) && text(locator.blockId)
      : locator.kind === 'message'
        ? text(locator.conversationId, 128) && locator.conversationId === value.sourceId
          && text(locator.messageId, 128) && uint(locator.messageRevision) && locator.messageRevision > 0
        : text(locator.resourceId) && nullable(locator.pageIndex, uint) && uint(locator.ocrRevision)
          && locator.ocrRevision > 0 && text(locator.regionId);
    return location && selection() && uint(locator.contextStart) && uint(locator.selectionEnd)
      && locator.contextStart + locator.selectionEnd <= 4294967295;
  }
  const frame = value.text === '' && locator.cueIndex === null
    && locator.selectionStart === 0 && locator.selectionEnd === 0;
  return locator.kind === 'video' && nullable(locator.subtitleRevision, text) && nullable(locator.cueIndex, uint)
    && (frame || selection()) && uint(locator.positionMs)
    && typeof locator.subtitleOffsetMs === 'number' && Number.isInteger(locator.subtitleOffsetMs)
    && Math.abs(locator.subtitleOffsetMs) <= 86400000
    && typeof locator.playbackRate === 'number' && Number.isFinite(locator.playbackRate)
    && locator.playbackRate >= 0.5 && locator.playbackRate <= 2;
}
