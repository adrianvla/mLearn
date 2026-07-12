import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ConsoleSelect, ConsoleSwitch, ConsoleTextField } from "./index";

it("renders HeroUI controls and reports controlled value changes", () => {
  const onTextChange = vi.fn();
  const onSwitchChange = vi.fn();
  const onSelectionChange = vi.fn();
  render(
    <>
      <ConsoleTextField label="Policy name" value="School defaults" onChange={onTextChange} />
      <ConsoleSwitch label="LLM enabled" isSelected={false} onChange={onSwitchChange} />
      <ConsoleSelect
        label="Rule type"
        selectedKey="setting"
        onSelectionChange={onSelectionChange}
        options={[{ key: "setting", label: "Lock app setting" }, { key: "llm", label: "Enable LLM access" }]}
      />
    </>,
  );
  fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "Exam defaults" } });
  fireEvent.click(screen.getByRole("switch", { name: "LLM enabled" }));
  fireEvent.click(screen.getByRole("button", { name: /Rule type/i }));
  fireEvent.click(screen.getByRole("option", { name: "Enable LLM access" }));
  expect(onTextChange).toHaveBeenCalledWith("Exam defaults");
  expect(onSwitchChange).toHaveBeenCalledWith(true);
  expect(onSelectionChange).toHaveBeenCalledWith("llm");
  expect(screen.getByRole("button", { name: /Rule type/i })).toHaveAttribute("data-slot", "select-trigger");
});
