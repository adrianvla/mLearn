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
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('No recorded data');
  expect(screen.getByRole('table', { name: 'Sessions data' })).toHaveTextContent('Raw detail expired');
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
  expect(screen.getByTestId('stacked-bar-1')).toHaveAttribute('data-coverage', 'missing');
});
