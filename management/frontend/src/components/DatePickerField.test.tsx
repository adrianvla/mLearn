import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DatePickerField } from './DatePickerField';

it('uses a HeroUI date picker instead of a native date input', () => {
  const { container } = render(<DatePickerField label="From date" value="2026-07-06" onChange={vi.fn()} />);

  expect(screen.getByLabelText('Choose From date')).toBeVisible();
  expect(container.querySelector('[data-slot="date-picker"]')).not.toBeNull();
  expect(container.querySelector('input[type="date"]')).toHaveAttribute('tabindex', '-1');
  fireEvent.click(screen.getByLabelText('Choose From date'));
  expect(document.querySelector('[data-slot="calendar"]')).not.toBeNull();
});
