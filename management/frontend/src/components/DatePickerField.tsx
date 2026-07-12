import { parseDate } from '@internationalized/date';
import { Calendar } from '@heroui/react/calendar';
import { DateInputGroup } from '@heroui/react/date-input-group';
import { DatePicker } from '@heroui/react/date-picker';

interface DatePickerFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
}

export function DatePickerField({ label, value, onChange }: DatePickerFieldProps) {
  return <DatePicker
    aria-label={label}
    value={value ? parseDate(value) : null}
    onChange={(date) => onChange(date?.toString() ?? '')}
  >
    <DateInputGroup fullWidth>
      <DateInputGroup.Input>
        {(segment) => <DateInputGroup.Segment segment={segment} />}
      </DateInputGroup.Input>
      <DatePicker.Trigger aria-label={`Choose ${label}`}>
        <DatePicker.TriggerIndicator />
      </DatePicker.Trigger>
    </DateInputGroup>
    <DatePicker.Popover>
      <Calendar>
        <Calendar.Header>
          <Calendar.NavButton slot="previous" />
          <Calendar.Heading />
          <Calendar.NavButton slot="next" />
        </Calendar.Header>
        <Calendar.Grid>
          <Calendar.GridHeader>
            {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
          </Calendar.GridHeader>
          <Calendar.GridBody>
            {(date) => <Calendar.Cell date={date} />}
          </Calendar.GridBody>
        </Calendar.Grid>
      </Calendar>
    </DatePicker.Popover>
  </DatePicker>;
}
