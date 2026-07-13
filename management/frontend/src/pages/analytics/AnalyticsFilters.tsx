import type { AnalyticsGranularity, ComparisonMode } from '../../api/types';
import { DatePickerField } from '../../components/DatePickerField';
import { ConsoleSelect } from '../../components/console';
import { schoolDateInput, schoolDayStart } from '../../utils/schoolTime';

const DAY = 86_400_000;

export interface AnalyticsFilterValue {
  from: number;
  to: number;
  preset: '7' | '30' | '90' | '365' | 'custom';
  comparison: ComparisonMode;
  granularity: AnalyticsGranularity | 'auto';
}

export function analyticsRangeError(value: Pick<AnalyticsFilterValue, 'from' | 'to'>): string | null {
  if (value.from < 0 || value.to < 0 || value.from >= value.to || value.to - value.from > 366 * DAY) return 'Choose a range from one to 366 days.';
  return null;
}

interface AnalyticsFiltersProps {
  value: AnalyticsFilterValue;
  timezone: string | null;
  onChange(value: AnalyticsFilterValue): void;
}

export function AnalyticsFilters({ value, timezone, onChange }: AnalyticsFiltersProps) {
  const rangeError = analyticsRangeError(value);
  const updatePreset = (preset: AnalyticsFilterValue['preset']) => {
    if (preset === 'custom') {
      onChange({ ...value, preset });
      return;
    }
    const now = Date.now();
    const zone = timezone ?? 'UTC';
    const today = schoolDateInput(now, zone);
    const startDate = new Date(`${today}T00:00:00.000Z`);
    startDate.setUTCDate(startDate.getUTCDate() - Number(preset));
    const from = schoolDayStart(startDate.toISOString().slice(0, 10), zone) ?? now;
    onChange({ ...value, preset, from, to: now });
  };
  const updateBoundary = (boundary: 'from' | 'to', date: string) => {
    if (timezone === null) return;
    const start = schoolDayStart(date, timezone);
    if (start === null) return;
    onChange({ ...value, preset: 'custom', [boundary]: boundary === 'from' ? start : start + DAY });
  };

  return <div className="analytics-filters" aria-label="Analytics filters">
    <ConsoleSelect label="Date range" selectedKey={value.preset} onSelectionChange={(key) => updatePreset(key as AnalyticsFilterValue['preset'])} options={[
      { key: '7', label: 'Last 7 days' }, { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }, { key: '365', label: 'Last 365 days' }, { key: 'custom', label: 'Custom range' },
    ]} />
    {value.preset === 'custom' ? <><DatePickerField label="From date" value={toDateInput(value.from, timezone)} onChange={(date) => updateBoundary('from', date)} /><DatePickerField label="To date" value={toDateInput(value.to - DAY, timezone)} onChange={(date) => updateBoundary('to', date)} /></> : null}
    <ConsoleSelect label="Comparison" selectedKey={value.comparison} onSelectionChange={(comparison) => onChange({ ...value, comparison: comparison as ComparisonMode })} options={[
      { key: 'none', label: 'No comparison' }, { key: 'previousPeriod', label: 'Previous period' }, { key: 'previousYear', label: 'Previous year' },
    ]} />
    <ConsoleSelect label="Granularity" selectedKey={value.granularity} onSelectionChange={(granularity) => onChange({ ...value, granularity: granularity as AnalyticsFilterValue['granularity'] })} options={[
      { key: 'auto', label: 'Automatic' }, { key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' },
    ]} />
    {rangeError ? <p className="analytics-filters__error" role="alert">{rangeError}</p> : null}
  </div>;
}

function toDateInput(timestamp: number, timezone: string | null): string {
  return schoolDateInput(timestamp, timezone ?? 'UTC');
}
