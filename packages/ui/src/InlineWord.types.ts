export type TextBounds = { x: number; y: number; width: number; height: number };
export type TextAnchor = TextBounds & {
    measure: (publish: (bounds: TextBounds) => void) => void;
    restoreFocus: () => void;
};
