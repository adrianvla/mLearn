import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { HistoricalChart } from './HistoricalChart';
import { StackedActivityChart } from './StackedActivityChart';
import type { ChartSeries } from './chartTypes';

const fixtureSeries: ChartSeries[] = [
  {
    key: 'sessions',
    label: 'Sessions',
    kind: 'primary',
    values: [
      { start: 1_700_000_000_000, end: 1_700_086_400_000, value: 12, coverage: 'complete' },
      { start: 1_700_086_400_000, end: 1_700_172_800_000, value: null, coverage: 'missing' },
    ],
  },
  {
    key: 'sessions',
    label: 'Sessions',
    kind: 'comparison',
    values: [
      { start: 1_699_827_200_000, end: 1_699_913_600_000, value: 8, coverage: 'complete' },
      { start: 1_699_913_600_000, end: 1_700_000_000_000, value: null, coverage: 'rawExpired' },
    ],
  },
];

it('renders primary and comparison values in an accessible table', () => {
  render(<HistoricalChart title="Sessions" series={fixtureSeries} />);

  expect(screen.getByRole('img', { name: 'Sessions history' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('Previous period');
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('Sessions — Current period');
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('Sessions — Previous period');
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent(new Date(fixtureSeries[1].values[0].start).toLocaleDateString());
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('No recorded data');
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('Raw detail expired');
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('No recorded data');
});

it('keeps a gap between recorded values instead of drawing through missing coverage', () => {
  render(<HistoricalChart title="Sessions" series={fixtureSeries} />);

  expect(screen.getByTestId('chart-path-sessions-primary')).toHaveAttribute('d', expect.stringContaining('M'));
  expect(screen.getByTestId('chart-path-sessions-primary')).not.toHaveAttribute('d', expect.stringContaining(' L '));
});

it('uses metric tabs and a HeroUI button to reveal the exact table', () => {
  const additionalMetric: ChartSeries = {
    key: 'completions',
    label: 'Completions',
    kind: 'primary',
    values: [{ start: 1_700_000_000_000, end: 1_700_086_400_000, value: 4, coverage: 'partial' }],
  };
  render(<HistoricalChart title="Learning activity" series={[...fixtureSeries, additionalMetric]} />);

  expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Completions' }));
  expect(screen.getByRole('img', { name: 'Learning activity history' })).toHaveTextContent('Completions');
  expect(screen.getByRole('status')).toHaveTextContent('Partial coverage');
  fireEvent.click(screen.getByRole('button', { name: 'Show exact data' }));
  expect(screen.getByRole('table', { name: 'Learning activity data' })).toBeVisible();
});

it('renders activity categories as stacked segments without converting unavailable values to zero', () => {
  render(<StackedActivityChart title="Activity" series={[
    { key: 'readerPages', label: 'Reader pages', kind: 'primary', values: [{ start: 1_700_000_000_000, end: 1_700_086_400_000, value: 5, coverage: 'complete' }, { start: 1_700_086_400_000, end: 1_700_172_800_000, value: null, coverage: 'missing' }] },
    { key: 'flashcardEvents', label: 'Flashcard events', kind: 'primary', values: [{ start: 1_700_000_000_000, end: 1_700_086_400_000, value: 3, coverage: 'complete' }, { start: 1_700_086_400_000, end: 1_700_172_800_000, value: null, coverage: 'missing' }] },
  ]} />);

  expect(screen.getByRole('img', { name: 'Activity history' })).toBeVisible();
  expect(screen.getByRole('table', { name: 'Activity data' })).toHaveTextContent('No recorded data');
  expect(screen.getByRole('table', { name: 'Activity data' })).toHaveTextContent('Reader pages — Current period');
  expect(screen.getByRole('table', { name: 'Activity data' })).toHaveTextContent('Flashcard events — Current period');
  expect(screen.getByTestId('stacked-bar-1')).toHaveAttribute('data-coverage', 'missing');
  expect(screen.getByRole('status')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('No recorded data');
});

it('renders current and previous activity stacks with the selected comparison label', () => {
  const previousStart = 1_669_913_600_000;
  render(<StackedActivityChart title="Activity" series={[
    { key: 'readerPages', label: 'Reader pages', kind: 'primary', values: [{ start: 1_700_000_000_000, end: 1_700_086_400_000, value: 5, coverage: 'complete' }] },
    { key: 'readerPages', label: 'Reader pages', kind: 'comparison', comparisonLabel: 'Previous year', values: [{ start: previousStart, end: 1_700_000_000_000, value: 4, coverage: 'complete' }] },
  ]} />);

  expect(screen.getByTestId('stacked-bar-0-primary')).toBeVisible();
  expect(screen.getByTestId('stacked-bar-0-comparison')).toBeVisible();
  const table = screen.getByRole('table', { name: 'Activity data' });
  expect(table).toHaveTextContent('Previous year');
  expect(table).toHaveTextContent(new Date(previousStart).toLocaleDateString());
});

it('sizes stacked bars by time bucket so all categories remain within the chart view', () => {
  const buckets = Array.from({ length: 6 }, (_, index) => ({
    start: 1_700_000_000_000 + index * 86_400_000,
    end: 1_700_086_400_000 + index * 86_400_000,
    coverage: 'complete' as const,
  }));
  render(<StackedActivityChart title="Six days" series={[
    { key: 'readerPages', label: 'Reader pages', kind: 'primary', values: buckets.map((bucket, index) => ({ ...bucket, value: index + 1 })) },
    { key: 'flashcardEvents', label: 'Flashcard events', kind: 'primary', values: buckets.map((bucket, index) => ({ ...bucket, value: index + 2 })) },
  ]} />);

  const rectangles = [...document.querySelectorAll<SVGRectElement>('.stacked-activity-chart__segment')];
  expect(rectangles).toHaveLength(12);
  expect(new Set(rectangles.map((rectangle) => rectangle.getAttribute('x'))).size).toBe(6);
  for (const rectangle of rectangles) {
    const x = Number(rectangle.getAttribute('x'));
    const width = Number(rectangle.getAttribute('width'));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(640);
  }
});
