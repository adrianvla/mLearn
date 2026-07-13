import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import Policies from "./Policies";

vi.mock("../groups/GroupScopeProvider", () => ({
  useGroupScope: () => ({ status: "ready", selectedGroup: { id: "child", name: "German A" }, can: () => true }),
}));

function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }); }

it("lists named local and inherited policies and only shows rules that were added", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/groups/child/policies")) return json({ local: [{ id: "exam", groupId: "child", groupName: "German A", name: "Exam restrictions", enabled: true, activeVersionId: null, draftHash: "hash" }], inherited: [{ id: "school", groupId: "root", groupName: "School", name: "Student defaults", enabled: true, activeVersionId: "version", draftHash: null }] });
    if (url.endsWith("/policy-registry")) return json([{ key: "readerTextSize", valueType: "number", allowedValues: [] }, { key: "theme", valueType: "select", allowedValues: ["light", "dark"] }]);
    if (url.endsWith("/policies/exam/draft")) return json({ document: { settings: { readerTextSize: { value: 20, locked: true } }, features: {}, llm: { quotas: [] }, governance: {} }, documentHash: "hash" });
    if (url.endsWith("/policies/exam/history")) return json({ items: [] });
    return json({});
  }));
  render(<Policies />);
  expect(await screen.findByRole("heading", { name: "Policies for German A" })).toBeVisible();
  const policyButton = screen.getByRole("button", { name: /Exam restrictions/ });
  expect(policyButton).toBeVisible();
  expect(policyButton).toHaveAttribute("data-slot", "button");
  expect(screen.getByRole("heading", { name: "Policies in this group" }).closest('[data-slot="card"]')).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Exam restrictions" }).closest('[data-slot="card"]')).not.toBeNull();
  expect(screen.getByText("Student defaults")).toBeVisible();
  expect(screen.getByText("School · read only")).toBeVisible();
  expect(await screen.findByLabelText(/Reader text size/i)).toHaveValue("20");
  expect(screen.queryByLabelText("Conversation retention days")).not.toBeInTheDocument();
  expect(screen.getByText("Validate this draft before publishing")).toBeVisible();
  fireEvent.click(screen.getByLabelText("App setting"));
  fireEvent.click(await screen.findByRole("option", { name: "Theme" }));
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  expect(screen.getByText("Save draft before validating or publishing")).toBeVisible();
});
