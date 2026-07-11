import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Users from "./Users";
vi.mock("../groups/GroupScopeProvider", () => ({
  useGroupScope: () => ({
    status: "ready",
    selectedGroup: {
      id: "german-a",
      name: "German A",
      capabilities: ["members.view", "members.manage"],
    },
    can: (capability: string) =>
      ["members.view", "members.manage"].includes(capability),
  }),
}));
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/preview"))
        return json({
          validRows: 0,
          errors: [{ row: 2, message: "invalid email" }],
        });
      return json({
        users: [
          {
            id: "u",
            email: "learner@test",
            displayName: "Learner",
            identityType: "learner",
            status: "active",
            groupIds: ["german-a"],
          },
        ],
      });
    }),
  ),
);
it("lists and filters scoped users and reports CSV errors by row before import", async () => {
  render(<Users />);
  expect(await screen.findByText("learner@test")).toBeVisible();
  expect(screen.getByLabelText("Identity type filter")).toBeVisible();
  expect(screen.getByLabelText("Status filter")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Row 2: invalid email")).toBeVisible();
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("german-a"),
    expect.anything(),
  );
});
it("creates a user, issues a secure invitation, and manages scoped sessions", async () => {
  const mockedFetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/users/u?"))
        return json({
          user: {
            id: "u",
            email: "learner@test",
            displayName: "Learner",
            identityType: "learner",
            status: "active",
            groupIds: ["german-a"],
          },
          memberships: [
            {
              id: "m",
              groupId: "german-a",
              groupName: "German A",
              status: "active",
            },
          ],
          devices: [
            {
              id: "d",
              name: "Browser",
              platform: "web",
              createdAt: 1,
              lastSeenAt: 2,
            },
          ],
          sessions: [
            {
              id: "s",
              expiresAt: 9999999999,
              revokedAt: null,
              createdAt: 1,
              lastSeenAt: 2,
              activeGroupId: "german-a",
            },
          ],
        });
      if (url.includes("/analytics/learners"))
        return json({ items: [{ learnerId: "u", sessions: 4, totalTokens: 120, costMicros: 5000, policyBlocks: 1 }] });
      if (url.includes("/llm/usage"))
        return json({ buckets: [{ scopeKind: "user", scopeId: "u", remaining: 80 }] });
      if (url.includes("/provisioning/invitations"))
        return json({
          id: "invite",
          groupId: "german-a",
          expiresAt: 9999999999,
          secret: "invite-secret",
        });
      if (init?.method === "POST" && url.endsWith("/api/users"))
        return json({
          id: "new-user",
          email: "new@test",
          displayName: "New Learner",
          identityType: "learner",
          status: "active",
          groupIds: ["german-a"],
        });
      if (init?.method === "DELETE")
        return Promise.resolve(new Response(null, { status: 204 }));
      if (init?.method === "PATCH")
        return json({
          id: "u",
          email: "learner@test",
          displayName: "Learner",
          identityType: "learner",
          status: "suspended",
          groupIds: ["german-a"],
        });
      return json({
        users: [
          {
            id: "u",
            email: "learner@test",
            displayName: "Learner",
            identityType: "learner",
            status: "active",
            groupIds: ["german-a"],
          },
        ],
      });
    },
  );
  vi.stubGlobal("fetch", mockedFetch);
  render(<Users />);
  fireEvent.click(await screen.findByRole("button", { name: "Open Learner" }));
  expect(await screen.findByText("Browser · web")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Usage summary" })).toBeVisible();
  expect(screen.getByText("80 remaining")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Revoke session s" }));
  expect(mockedFetch).toHaveBeenCalledWith(
    expect.stringContaining("/sessions/s?"),
    expect.objectContaining({ method: "DELETE" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
  expect(mockedFetch).toHaveBeenCalledWith(
    expect.stringContaining("/status?"),
    expect.objectContaining({ method: "PATCH" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Create user" }));
  fireEvent.change(screen.getByLabelText("User email"), {
    target: { value: "new@test" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "New Learner" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(mockedFetch).toHaveBeenCalledWith(
    "/api/users",
    expect.objectContaining({ method: "POST" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Invite user" }));
  fireEvent.change(screen.getByLabelText("Invitation email"), {
    target: { value: "invite@test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText("invite-secret")).toBeVisible();
  expect(mockedFetch).toHaveBeenCalledWith(
    expect.stringContaining("/provisioning/invitations"),
    expect.objectContaining({ method: "POST" }),
  );
});
function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
