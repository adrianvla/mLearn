import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ConsoleDialog, ConsoleSelect, ConsoleSwitch, ConsoleTextField } from "./index";

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
  expect(screen.getByRole("button", { name: /Rule type/i })).toHaveTextContent("Lock app setting");
  fireEvent.click(screen.getByRole("button", { name: /Rule type/i }));
  fireEvent.click(screen.getByRole("option", { name: "Enable LLM access" }));
  expect(onTextChange).toHaveBeenCalledWith("Exam defaults");
  expect(onSwitchChange).toHaveBeenCalledWith(true);
  expect(onSelectionChange).toHaveBeenCalledWith("llm");
  expect(screen.getByLabelText("Policy name")).toHaveClass("input--secondary");
  expect(screen.getByRole("button", { name: /Rule type/i })).toHaveAttribute("data-slot", "select-trigger");
  screen.getByRole("switch", { name: "LLM enabled" });
  const switchContent = document.querySelector('[data-slot="switch-content"]');
  expect(switchContent).not.toBeNull();
  expect(switchContent?.querySelector('[data-slot="switch-control"]')).not.toBeNull();
});

it("renders an open HeroUI dialog", () => {
  render(<ConsoleDialog open onOpenChange={vi.fn()} title="Archive group" footer={<button>Confirm</button>}><p>Archived groups lose access.</p></ConsoleDialog>);
  expect(screen.getByRole("dialog", { name: "Archive group" })).toBeVisible();
});
