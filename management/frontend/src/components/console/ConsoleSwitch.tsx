import { Switch } from "@heroui/react";

export function ConsoleSwitch({ label, isSelected, onChange, isDisabled }: {
  label: string;
  isSelected: boolean;
  onChange(value: boolean): void;
  isDisabled?: boolean;
}) {
  return <Switch isSelected={isSelected} onChange={onChange} isDisabled={isDisabled} aria-label={label}>
    <Switch.Control><Switch.Thumb /></Switch.Control>
    <Switch.Content>{label}</Switch.Content>
  </Switch>;
}
