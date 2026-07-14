import { Label, Switch } from "@heroui/react";

export function ConsoleSwitch({ label, isSelected, onChange, isDisabled }: {
  label: string;
  isSelected: boolean;
  onChange(value: boolean): void;
  isDisabled?: boolean;
}) {
  return <Switch isSelected={isSelected} onChange={onChange} isDisabled={isDisabled}>
    <Switch.Content>
      <Switch.Control><Switch.Thumb /></Switch.Control>
      <Label>{label}</Label>
    </Switch.Content>
  </Switch>;
}
