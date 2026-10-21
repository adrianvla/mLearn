import type { ReactNode } from 'react';
import type { PronunciationContour } from '@mlearn/contracts';

export type TextBounds = { x: number; y: number; width: number; height: number };
export type TextAnchor = TextBounds & {
    measure: (publish: (bounds: TextBounds) => void) => void;
    subscribe?: (onLayout: () => void) => () => void;
    restoreFocus: () => void;
};
export type InspectionMode = 'click' | 'immediate' | 'delayed' | 'modifier';
export type InlineWordProps = {
    readonly text: string;
    /** Presentation only; children must not contain nested controls. */
    readonly children?: ReactNode;
    readonly accessibilityLabel?: string;
    readonly status: string;
    readonly inspectionMode?: InspectionMode;
    readonly variant?: 'subtitle' | 'body';
    readonly onActivate: (anchor: TextAnchor) => void;
};
export type InlineWordContentProps = {
    readonly segments: readonly {
        readonly text: string;
        readonly reading?: { readonly text: string; readonly attribution: string; readonly base?: string | null };
        readonly contour?: PronunciationContour;
    }[];
    readonly variant?: 'subtitle' | 'body' | 'inspectionTitle';
    readonly status?: string;
};
