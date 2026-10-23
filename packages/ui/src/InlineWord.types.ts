import type { ReactNode } from 'react';
import type { PronunciationContour } from '@mlearn/contracts';

export type TextBounds = { x: number; y: number; width: number; height: number };
export type TextAnchor = TextBounds & {
    measure: (publish: (bounds: TextBounds) => void) => void;
    subscribe?: (onLayout: () => void) => () => void;
    restoreFocus: () => void;
};
export type InspectionMode = 'click' | 'immediate' | 'delayed' | 'modifier';
/** Accepted display values for a document/WebView, not a second theme owner. */
export type InlineDocumentFlow = {
    readonly color: string;
    readonly knownColor: string;
    readonly selectionColor?: string;
};
export type InlineWordProps = {
    readonly text: string;
    /** Presentation only; children must not contain nested controls. */
    readonly children?: ReactNode;
    readonly accessibilityLabel?: string;
    readonly status: string;
    readonly inspectionMode?: InspectionMode;
    readonly variant?: 'subtitle' | 'body';
    readonly onActivate: (anchor: TextAnchor) => void;
    readonly documentFlow?: InlineDocumentFlow;
};
export type InlineWordContentProps = {
    readonly segments: readonly {
        readonly text: string;
        readonly reading?: { readonly text: string; readonly attribution: string; readonly base?: string | null };
        readonly contour?: PronunciationContour;
        /** Authored ruby can span several independently actionable occurrences. */
        readonly content?: ReactNode;
    }[];
    readonly variant?: 'subtitle' | 'body' | 'inspectionTitle';
    readonly status?: string;
    readonly documentFlow?: InlineDocumentFlow;
    readonly sourceStart?: number;
    readonly highlighted?: boolean;
};
