import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import LlmGateway from "./LlmGateway";
vi.mock("../groups/GroupScopeProvider", () => ({
  useGroupScope: () => ({
    status: "ready",
    selectedGroup: { id: "g", name: "G" },
    can: () => true,
  }),
}));
it("shows the complete governed gateway without exposing stored secrets", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/providers?")
        ? {
            items: [
              {
                id: "p",
                name: "Provider",
                providerKind: "openAiCompatible",
                baseUrl: "https://example.test",
                status: "active",
                hasSecret: true,
              },
            ],
          }
        : url.includes("/models?")
          ? { items: [] }
          : url.includes("/prompt-profiles?")
            ? {
                items: [
                  {
                    id: "profile",
                    groupId: "g",
                    name: "Tutor",
                    systemPrompt: "Help safely",
                    status: "active",
                    createdAt: 1,
                    updatedAt: 1,
                  },
                ],
              }
            : url.includes("/prices?")
              ? {
                  items: [
                    {
                      id: "price",
                      providerId: "p",
                      modelId: null,
                      currency: "USD",
                      unit: "millionTokens",
                      inputCostMicros: 10,
                      outputCostMicros: 20,
                      createdAt: 1700000000,
                    },
                  ],
                }
              : url.includes("/usage?")
                ? {
                    buckets: [
                      {
                        scopeKind: "group",
                        scopeId: "g",
                        metric: "tokens",
                        used: 20,
                        reserved: 5,
                        limit: 100,
                        remaining: 75,
                        warning: false,
                        inherited: false,
                        sourceVisible: true,
                        constraintState: "local",
                        periodStartsAt: 1,
                        periodEndsAt: 2,
                      },
                    ],
                    breakdowns: [],
                    nextCursor: null,
                  }
                : url.includes("/reservations?")
                  ? {
                      items: [
                        {
                          id: "reservation",
                          learnerUserId: "learner",
                          directGroupId: "g",
                          providerId: "p",
                          modelId: "m",
                          status: "open",
                          expiresAt: 1700000100,
                          createdAt: 1700000000,
                        },
                      ],
                    }
                  : url.includes("/api-keys")
                    ? {
                        apiKeys: [
                          {
                            id: "key",
                            groupId: "g",
                            name: "Analytics",
                            capabilities: ["analytics.view"],
                            expiresAt: null,
                            createdAt: 1,
                          },
                        ],
                      }
                    : { items: [] };
      return json(body);
    }),
  );
  render(<LlmGateway />);
  expect(await screen.findByText("Configured")).toBeVisible();
  expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Input 10/)).toBeVisible();
  expect(screen.getByText("Tutor")).toBeVisible();
  expect(screen.getByText(/75 remaining/)).toBeVisible();
  expect(screen.getByText("Analytics")).toBeVisible();
  expect(screen.getByText("learner")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Replace secret" }));
  expect(screen.getByLabelText("New provider secret")).toHaveValue("");
});
it("keeps provider configuration visible when the quota calendar is not configured", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/usage?"))
        return new Response(
          JSON.stringify({ error: "school quota calendar is not configured" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      const body = url.includes("/providers?")
        ? {
            items: [
              {
                id: "p",
                name: "Provider",
                providerKind: "ollama",
                baseUrl: "http://localhost",
                status: "active",
                hasSecret: false,
              },
            ],
          }
        : url.includes("/api-keys")
          ? { apiKeys: [] }
          : { items: [] };
      return json(body);
    }),
  );
  render(<LlmGateway />);
  expect(await screen.findByText("Provider")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Quota summary unavailable",
  );
});
it("creates a write-only provider configuration", async () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/llm/providers") && init?.method === "POST")
        return json({
          id: "new-provider",
          name: "OpenAI",
          providerKind: "openaiCompatible",
          baseUrl: "https://api.openai.com",
          status: "active",
          hasSecret: true,
        });
      const body = url.includes("/usage?")
        ? { buckets: [] }
        : url.includes("/api-keys")
          ? { apiKeys: [] }
          : { items: [] };
      return json(body);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<LlmGateway />);
  fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));
  fireEvent.change(screen.getByLabelText("Provider name"), {
    target: { value: "OpenAI" },
  });
  fireEvent.change(screen.getByLabelText("Provider endpoint"), {
    target: { value: "https://api.openai.com" },
  });
  fireEvent.change(screen.getByLabelText("Provider secret"), {
    target: { value: "write-only-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create provider" }));
  expect(await screen.findByText("OpenAI")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/llm/providers",
    expect.objectContaining({
      method: "POST",
      body: expect.not.stringContaining("hasSecret"),
    }),
  );
  expect(
    screen.queryByDisplayValue("write-only-secret"),
  ).not.toBeInTheDocument();
});
it("exposes model, prompt, price, and API-key workflows to authorized administrators", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return json(
        url.includes("/usage?")
          ? { buckets: [] }
          : url.includes("/api-keys")
            ? { apiKeys: [] }
            : { items: [] },
      );
    }),
  );
  render(<LlmGateway />);
  expect(
    await screen.findByRole("button", { name: "Add model" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Add prompt profile" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Add price version" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Create API key" })).toBeVisible();
});
function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
