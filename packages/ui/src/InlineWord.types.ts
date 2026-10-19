export type TextBounds = { x: number; y: number; width: number; height: number };
export type TextAnchor = TextBounds & {
    measure: (publish: (bounds: TextBounds) => void) => void;
    restoreFocus: () => void;
};
export type InspectionMode = 'click' | 'immediate' | 'delayed' | 'modifier';
export type InlineWordProps = {
    readonly text: string;
    readonly status: string;
    readonly inspectionMode?: InspectionMode;
    readonly variant?: 'subtitle' | 'body';
    readonly onActivate: (anchor: TextAnchor) => void;
};
