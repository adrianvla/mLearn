import { Label, ListBox, ListBoxItem, Select } from "@heroui/react";

export type ConsoleOption = { key: string; label: string };

export function ConsoleSelect({ label, selectedKey, onSelectionChange, options, isDisabled, placeholder = "Choose an option" }: {
  label: string;
  selectedKey: string;
  onSelectionChange(key: string): void;
  options: readonly ConsoleOption[];
  isDisabled?: boolean;
  placeholder?: string;
}) {
  return <Select selectedKey={selectedKey || null} onSelectionChange={(key) => onSelectionChange(key === null ? "" : String(key))} isDisabled={isDisabled}>
    <Label>{label}</Label>
    <Select.Trigger aria-label={label}><Select.Value>{({ selectedText }) => selectedText || placeholder}</Select.Value><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{options.map((option) => <ListBoxItem id={option.key} key={option.key}>{option.label}</ListBoxItem>)}</ListBox></Select.Popover>
  </Select>;
}
