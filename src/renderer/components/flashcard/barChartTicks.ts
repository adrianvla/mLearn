/**
 * Axis label placement policy for canvas bar charts.
 *
 * A dense axis (for example 30 days in a narrow card) cannot show every
 * label. Squeezing them with a `fillText` maxWidth produces an unreadable
 * smear, and simply centring every label makes neighbours overlap. The
 * renderer therefore asks this module which ticks are actually drawable, and
 * `drawBarChart` drops the rest.
 */

/** Largest fraction of a label's slot that the glyphs may occupy. */
const LABEL_FILL_RATIO = 0.95;

export interface BarChartTick {
  /** Index of the bar the label belongs to. */
  index: number;
  /** Text to draw. */
  text: string;
  /**
   * Horizontal anchoring. `left`/`right` pull the first and last labels inward
   * so a centred label would not be clipped by the canvas edge.
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

/**
 * Choose which bar labels to draw.
 *
 * A label is kept when the widest label in the set still fits the distance to
 * its neighbour. When nothing fits, the first and last bars are labelled so
 * the axis still communicates the range it covers.
 *
 * @param labels    Candidate label per bar, in bar order.
 * @param slotWidth Width available to each label, in CSS pixels.
 * @param measure   Natural width of a label, in CSS pixels.
 */
export function selectAxisTicks(
  labels: readonly string[],
  slotWidth: number,
  measure: (text: string) => number
): BarChartTick[] {
  if (labels.length === 0 || slotWidth <= 0) return [];

  const last = labels.length - 1;
  // The first and last labels are anchored inward, so they overhang their own
  // slot by half a slot and must be budgeted for it.
  const widthOf = (index: number): number =>
    measure(labels[index]) + (index === 0 || index === last ? slotWidth / 2 : 0);

  /** Do the given ticks leave at least `slotWidth * gap` between glyphs? */
  const fits = (indices: readonly number[]): boolean =>
    indices.every((index, position) => {
      if (position === 0) return widthOf(index) <= slotWidth * LABEL_FILL_RATIO;
      const previous = indices[position - 1];
      const gap = index - previous;
      const next = indices[position + 1];
      // A middle label shares the free space with both neighbours.
      const neighbours = next === undefined ? 1 : 2;
      return (widthOf(previous) + widthOf(index)) / neighbours <= slotWidth * gap * LABEL_FILL_RATIO;
    });

  if (fits(labels.map((_label, index) => index))) {
    return labels.map((_label, index) => ({
      index,
      text: labels[index],
      align: alignFor(index, last),
    }));
  }

  // Stride down until the retained labels stop colliding.
  for (let stride = 2; stride <= labels.length; stride++) {
    const indices: number[] = [];
    for (let index = 0; index <= last; index += stride) indices.push(index);
    if (indices[indices.length - 1] !== last) indices.push(last);
    if (fits(indices)) {
      return indices.map(index => ({
        index,
        text: labels[index],
        align: alignFor(index, last),
      }));
    }
  }

  // Nothing fits even at full stride: keep only the range endpoints.
  const endpoints = last === 0 ? [0] : [0, last];
  return endpoints.map(index => ({
    index,
    text: labels[index],
    align: alignFor(index, last),
  }));
}
