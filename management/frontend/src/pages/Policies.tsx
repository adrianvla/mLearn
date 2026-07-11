import { useEffect, useMemo, useState } from "react";
import { ApiClient } from "../api/client";
import { PageToolbar } from "../components/PageToolbar";
import { PolicyDiffDialog } from "../components/PolicyDiffDialog";
import { PolicySettingRow } from "../components/PolicySettingRow";
import { QuotaEditor, type DraftQuota } from "../components/QuotaEditor";
import { useGroupScope } from "../groups/GroupScopeProvider";
const api = new ApiClient();
type Json = Record<string, any>;
export default function Policies() {
  const scope = useGroupScope();
  const groupId = scope.status === "ready" ? scope.selectedGroup?.id : null;
  const [effective, setEffective] = useState<Json | null>(null);
  const [draft, setDraft] = useState<Json>({
    settings: {},
    features: {},
    llm: { quotas: [] },
    governance: {},
  });
  const [validation, setValidation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [summary, setSummary] = useState("");
  useEffect(() => {
    if (!groupId) return;
    const controller = new AbortController();
    Promise.all([
      api.get<Json>(`/api/groups/${groupId}/policy/effective`, {
        signal: controller.signal,
      }),
      api.get<{ document: Json } | null>(
        `/api/groups/${groupId}/policy/draft`,
        { signal: controller.signal },
      ),
    ])
      .then(([compiled, local]) => {
        if (!controller.signal.aborted) {
          setEffective(compiled);
          setDraft(
            local?.document ?? {
              settings: {},
              features: {},
              llm: { quotas: [] },
              governance: {},
            },
          );
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Policy could not be loaded",
          );
      });
    return () => controller.abort();
  }, [groupId]);
  const document = effective?.document ?? effective;
  const ancestry = useMemo(
    () =>
      new Map<string, string>(
        (document?.ancestry ?? []).map((item: any) => [item.id, item.name]),
      ),
    [document],
  );
  const editable = scope.status === "ready" && scope.can("policies.edit");
  const publishable = scope.status === "ready" && scope.can("policies.publish");
  const save = async () => {
    if (!groupId) return;
    await api.get(`/api/groups/${groupId}/policy/draft`, {
      method: "PUT",
      body: JSON.stringify(draft),
    });
    const result = await api.get<{ valid: boolean }>(
      `/api/groups/${groupId}/policy/validate`,
      { method: "POST" },
    );
    setValidation(result.valid);
  };
  const publish = async () => {
    if (!groupId) return;
    await api.get(`/api/groups/${groupId}/policy/publish`, {
      method: "POST",
      body: JSON.stringify({ summary }),
    });
    setDiffOpen(false);
    setSummary("");
    setValidation(false);
  };
  return (
    <div className="resource-page">
      <PageToolbar
        title="Policies"
        description="Local rules inherit root-to-leaf and cannot weaken hard ancestor controls."
        actions={
          <>
            <button
              className="secondary-action"
              disabled={!editable}
              onClick={() => void save()}
            >
              Save draft
            </button>
            <button
              className="primary-action"
              disabled={!publishable || !validation}
              onClick={() => setDiffOpen(true)}
            >
              Publish
            </button>
          </>
        }
      />
      {error && <p role="alert">{error}</p>}
      {document && (
        <div className="policy-editor">
          <section>
            <h2>App settings and language profile</h2>
            {Object.entries(document.settings ?? {}).map(
              ([key, rule]: [string, any]) => (
                <PolicySettingRow
                  key={key}
                  label={key}
                  source={
                    rule.sourceGroupId === groupId
                      ? undefined
                      : (ancestry.get(rule.sourceGroupId) ??
                        rule.sourceGroupName)
                  }
                  constrained={rule.locked}
                  disabled={rule.locked && rule.sourceGroupId !== groupId}
                >
                  <input
                    value={String(draft.settings?.[key]?.value ?? rule.value)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        settings: {
                          ...draft.settings,
                          [key]: {
                            value: event.currentTarget.value,
                            locked: rule.locked,
                          },
                        },
                      })
                    }
                  />
                </PolicySettingRow>
              ),
            )}
          </section>
          <section>
            <h2>Features</h2>
            {Object.entries(document.features ?? {}).map(
              ([key, rule]: [string, any]) => (
                <PolicySettingRow
                  key={key}
                  label={key}
                  source={
                    rule.sourceGroupId === groupId
                      ? undefined
                      : ancestry.get(rule.sourceGroupId)
                  }
                  constrained={rule.hard}
                  disabled={rule.hard && rule.sourceGroupId !== groupId}
                >
                  <input
                    type="checkbox"
                    checked={draft.features?.[key]?.enabled ?? rule.enabled}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        features: {
                          ...draft.features,
                          [key]: {
                            enabled: event.currentTarget.checked,
                            hard: false,
                          },
                        },
                      })
                    }
                  />
                </PolicySettingRow>
              ),
            )}
          </section>
          <section>
            <h2>AI and model routing</h2>
            <PolicySettingRow label="LLM enabled">
              <input
                aria-label="LLM enabled"
                type="checkbox"
                disabled={!editable}
                checked={draft.llm?.enabled ?? document.llm.enabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    llm: {
                      ...draft.llm,
                      enabled: event.currentTarget.checked,
                      quotas: draft.llm?.quotas ?? [],
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Requests per minute">
              <input
                aria-label="Requests per minute"
                type="number"
                min="1"
                disabled={!editable}
                value={
                  draft.llm?.requestsPerMinute ?? document.llm.requestsPerMinute
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    llm: {
                      ...draft.llm,
                      requestsPerMinute: event.currentTarget.valueAsNumber,
                      quotas: draft.llm?.quotas ?? [],
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Concurrent streams">
              <input
                aria-label="Concurrent streams"
                type="number"
                min="1"
                disabled={!editable}
                value={
                  draft.llm?.maxConcurrentStreams ??
                  document.llm.maxConcurrentStreams
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    llm: {
                      ...draft.llm,
                      maxConcurrentStreams: event.currentTarget.valueAsNumber,
                      quotas: draft.llm?.quotas ?? [],
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Allowed providers">
              <input
                aria-label="Allowed providers"
                disabled={!editable}
                value={(
                  draft.llm?.allowedProviders ??
                  document.llm.allowedProviders ??
                  []
                ).join(", ")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    llm: {
                      ...draft.llm,
                      allowedProviders: csv(event.currentTarget.value),
                      quotas: draft.llm?.quotas ?? [],
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Allowed models">
              <input
                aria-label="Allowed models"
                disabled={!editable}
                value={(
                  draft.llm?.allowedModels ??
                  document.llm.allowedModels ??
                  []
                ).join(", ")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    llm: {
                      ...draft.llm,
                      allowedModels: csv(event.currentTarget.value),
                      quotas: draft.llm?.quotas ?? [],
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Prompt profile">
              <input
                aria-label="Prompt profile"
                disabled={!editable}
                value={
                  draft.llm?.promptProfileId ??
                  document.llm.promptProfileId ??
                  ""
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    llm: {
                      ...draft.llm,
                      promptProfileId: event.currentTarget.value || null,
                      quotas: draft.llm?.quotas ?? [],
                    },
                  })
                }
              />
            </PolicySettingRow>
          </section>
          <section>
            <h2>Retention and exports</h2>
            <PolicySettingRow label="Activity retention">
              <input
                aria-label="Activity retention days"
                type="number"
                min="1"
                max={document.governance.activityRetentionDays}
                value={
                  draft.governance?.activityRetentionDays ??
                  document.governance.activityRetentionDays
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    governance: {
                      ...draft.governance,
                      activityRetentionDays: event.currentTarget.valueAsNumber,
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Conversation retention">
              <input
                aria-label="Conversation retention days"
                type="number"
                min="1"
                max={document.governance.conversationRetentionDays}
                value={
                  draft.governance?.conversationRetentionDays ??
                  document.governance.conversationRetentionDays
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    governance: {
                      ...draft.governance,
                      conversationRetentionDays:
                        event.currentTarget.valueAsNumber,
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Teacher analytics export">
              <input
                aria-label="Teacher analytics export"
                type="checkbox"
                checked={
                  draft.governance?.teacherAnalyticsExport ??
                  document.governance.teacherAnalyticsExport
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    governance: {
                      ...draft.governance,
                      teacherAnalyticsExport: event.currentTarget.checked,
                    },
                  })
                }
              />
            </PolicySettingRow>
            <PolicySettingRow label="Teacher conversation export">
              <input
                aria-label="Teacher conversation export"
                type="checkbox"
                checked={
                  draft.governance?.teacherConversationExport ??
                  document.governance.teacherConversationExport
                }
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    governance: {
                      ...draft.governance,
                      teacherConversationExport: event.currentTarget.checked,
                    },
                  })
                }
              />
            </PolicySettingRow>
          </section>
          <section>
            <QuotaEditor
              quotas={(draft.llm?.quotas ?? []) as DraftQuota[]}
              ancestor={document.llm.quotas}
              disabled={!editable}
              onChange={(quotas) =>
                setDraft({ ...draft, llm: { ...draft.llm, quotas } })
              }
            />
          </section>
        </div>
      )}
      <PolicyDiffDialog
        open={diffOpen}
        before={effective?.document ?? {}}
        after={draft}
        warnings={validation ? [] : ["Validate the draft before publishing."]}
        summary={summary}
        onSummaryChange={setSummary}
        onCancel={() => setDiffOpen(false)}
        onPublish={() => void publish()}
      />
    </div>
  );
}

function csv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
