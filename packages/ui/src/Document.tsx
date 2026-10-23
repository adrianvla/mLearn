// The native DOM runtime has no native Unistyles registry. Its shared controls
// consume accepted display values; importing themed widgets here would boot a
// second presentation runtime before those values arrive.
export { DocumentWord, DocumentFigure, InlineDocumentBlock } from './InlineWordDocument';
export { DocumentWordContent as InlineWordContent } from './InlineWordElement.web';
export type { InlineDocumentFlow, TextAnchor, TextBounds } from './InlineWord.types';
