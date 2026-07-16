/** Reset the reader's own scroll container when its visible page changes. */
export function scrollReaderToPageStart(reader: HTMLElement | undefined): void {
  reader?.scrollTo({ top: 0, behavior: 'auto' });
}
