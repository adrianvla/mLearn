import { Input, Label, NumberField, TextArea, TextField } from "@heroui/react";

type SharedProps = {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  isDisabled?: boolean;
  type?: "email" | "password" | "search" | "text" | "url";
  autoComplete?: string;
};

export function ConsoleTextField({ label, value, onChange, placeholder, isDisabled, type = "text", autoComplete }: SharedProps) {
  return <TextField value={value} onChange={onChange} isDisabled={isDisabled}>
    <Label>{label}</Label>
    <Input aria-label={label} placeholder={placeholder} type={type} autoComplete={autoComplete} />
  </TextField>;
}

export function ConsoleTextArea({ label, value, onChange, placeholder, isDisabled }: Omit<SharedProps, "type" | "autoComplete">) {
  return <TextField value={value} onChange={onChange} isDisabled={isDisabled}>
    <Label>{label}</Label>
    <TextArea aria-label={label} placeholder={placeholder} />
  </TextField>;
}

export function ConsoleNumberField({ label, value, onChange, min, max, isDisabled }: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  isDisabled?: boolean;
}) {
  return <NumberField value={value} onChange={onChange} minValue={min} maxValue={max} isDisabled={isDisabled}>
    <Label>{label}</Label>
    <NumberField.Group><NumberField.Input aria-label={label} /></NumberField.Group>
  </NumberField>;
}
