/**
 * Axis label placement policy for canvas and DOM bar charts.
 *
 * A dense axis (for example 30 days in a narrow card) cannot show every
 * label. Squeezing them with a `fillText` maxWidth produces an unreadable
 * smear, and simply centring every label makes neighbours overlap. Both
 * renderers therefore ask this module which ticks are actually drawable and
 * drop the rest.
 */

/** Largest fraction of the gap between ticks that the glyphs may occupy. */
const LABEL_FILL_RATIO = 0.95;

export interface BarChartTick {
  /** Index of the bar the label belongs to. */
  index: number;
  /** Text to draw. */
  text: string;
  /**
   * Horizontal anchoring. `left`/`right` pull the first and last labels inward
   * so a centred label would not be clipped by the chart's edge.
   */
  align: 'center' | 'left' | 'right';
}

/** Anchor the edge ticks inward so their glyphs stay inside the chart. */
function alignFor(index: number, last: number): BarChartTick['align'] {
  if (last === 0) return 'center';
  if (index === 0) return 'left';
  if (index === last) return 'right';
  return 'center';
}

const toTicks = (labels: readonly string[], indices: readonly number[]): BarChartTick[] => {
  const last = labels.length - 1;
  return indices.map(index => ({
    index,
    text: labels[index],
    align: alignFor(index, last),
  }));
};

/**
 * Choose which bar labels to draw.
 *
 * A label is kept when it and its retained neighbour leave at least
 * `slotWidth * gap` between their glyphs. When nothing fits, the first and
 * last bars are labelled so the axis still communicates its range.
 *
 * @param labels    Candidate label per bar, in bar order.
 * @param slotWidth Width available to each bar, in CSS pixels.
 * @param measure   Natural width of a label, in CSS pixels.
 */
export function selectAxisTicks(
  labels: readonly string[],
  slotWidth: number,
  measure: (text: string) => number
): BarChartTick[] {
  if (labels.length === 0 || slotWidth <= 0) return [];

  const last = labels.length - 1;
  const widthOf = (index: number): number => measure(labels[index]);

  /** Do the given ticks leave room for their glyphs in the gaps they span? */
  const fits = (indices: readonly number[]): boolean => {
    for (let position = 1; position < indices.length; position++) {
      const previous = indices[position - 1];
      const index = indices[position];
      const gap = (index - previous) * slotWidth * LABEL_FILL_RATIO;
      if (widthOf(previous) + widthOf(index) > gap) return false;
    }
    return true;
  };

  const every = labels.map((_label, index) => index);
  if (fits(every)) return toTicks(labels, every);

  // Stride down until the retained labels stop colliding.
  for (let stride = 2; stride <= last; stride++) {
    const indices: number[] = [];
    for (let index = 0; index <= last; index += stride) indices.push(index);
    if (indices[indices.length - 1] !== last) indices.push(last);
    if (fits(indices)) return toTicks(labels, indices);
  }

  // Nothing fits even at full stride: keep only the range endpoints.
  return toTicks(labels, last === 0 ? [0] : [0, last]);
}
