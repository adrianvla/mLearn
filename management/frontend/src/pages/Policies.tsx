import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient } from "../api/client";
import { PageToolbar } from "../components/PageToolbar";
import { useGroupScope } from "../groups/GroupScopeProvider";

const api = new ApiClient();
type Json = Record<string, any>;
type Policy = { id:string; groupId:string; groupName:string; name:string; enabled:boolean; activeVersionId:string|null; draftHash:string|null };
type Collection = { local:Policy[]; inherited:Policy[] };
type Draft = { document:Json; documentHash:string };
type Setting = { key:string; valueType:"boolean"|"number"|"string"|"stringOrNull"|"select"; allowedValues:string[] };
const empty = (): Json => ({ settings:{}, features:{}, llm:{ quotas:[] }, governance:{} });

export default function Policies() {
  const scope = useGroupScope();
  const group = scope.status === "ready" ? scope.selectedGroup : undefined;
  const groupId = group?.id;
  const editable = scope.status === "ready" && scope.can("policies.edit");
  const publishable = scope.status === "ready" && scope.can("policies.publish");
  const [collection,setCollection] = useState<Collection>({local:[],inherited:[]});
  const [registry,setRegistry] = useState<Setting[]>([]);
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [draft,setDraft] = useState<Json>(empty());
  const [saved,setSaved] = useState<Json>(empty());
  const [savedHash,setSavedHash] = useState<string|null>(null);
  const [validatedHash,setValidatedHash] = useState<string|null>(null);
  const [newName,setNewName] = useState("");
  const [summary,setSummary] = useState("");
  const [settingKey,setSettingKey] = useState("");
  const [ruleKind,setRuleKind] = useState<"setting"|"llm"|"retention">("setting");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const selected = collection.local.find((policy) => policy.id === selectedId) ?? null;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft,saved]);
  const nextStep = !selected ? "Select a policy" : dirty || !savedHash ? "Save draft before validating or publishing" : validatedHash !== savedHash ? "Validate this draft before publishing" : !summary.trim() ? "Add a publish summary" : null;
  const refresh = async (preserve = true) => {
    if (!groupId) return;
    const result = await api.get<Collection>(`/api/groups/${groupId}/policies`);
    setCollection(result);
    setSelectedId((previous) => preserve && result.local.some((policy) => policy.id === previous) ? previous : result.local[0]?.id ?? null);
  };
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    Promise.all([refresh(false),api.get<Setting[]>("/api/policy-registry")]).then(([,settings]) => { if (!cancelled) setRegistry(settings); }).catch((reason) => !cancelled && setError(text(reason)));
    return () => { cancelled=true; };
  },[groupId]);
  useEffect(() => {
    if (!selectedId) { setDraft(empty()); setSaved(empty()); setSavedHash(null); setValidatedHash(null); return; }
    let cancelled=false;
    api.get<Draft|null>(`/api/policies/${selectedId}/draft`).then((result) => { if (cancelled) return; const document=result?.document ?? empty(); setDraft(document); setSaved(document); setSavedHash(result?.documentHash ?? null); setValidatedHash(null); }).catch((reason) => !cancelled && setError(text(reason)));
    return () => { cancelled=true; };
  },[selectedId]);
  const create = async () => {
    if (!groupId || !newName.trim()) return;
    setBusy(true); setError(null);
    try { const policy=await api.get<Policy>(`/api/groups/${groupId}/policies`,{method:"POST",body:JSON.stringify({name:newName.trim(),description:""})}); setNewName(""); await refresh(false); setSelectedId(policy.id); } catch (reason) { setError(text(reason)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!selected || !editable) return;
    setBusy(true); setError(null);
    try { const result=await api.get<Draft>(`/api/policies/${selected.id}/draft`,{method:"PUT",body:JSON.stringify({document:draft,expectedDocumentHash:savedHash})}); setSaved(result.document); setDraft(result.document); setSavedHash(result.documentHash); setValidatedHash(null); await refresh(); } catch (reason) { setError(text(reason)); } finally { setBusy(false); }
  };
  const validate = async () => {
    if (!selected || dirty || !savedHash) return;
    setBusy(true); setError(null);
    try { const result=await api.get<{documentHash:string}>(`/api/policies/${selected.id}/validate`,{method:"POST"}); setValidatedHash(result.documentHash); } catch (reason) { setError(text(reason)); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!selected || nextStep || !validatedHash) return;
    setBusy(true); setError(null);
    try { await api.get(`/api/policies/${selected.id}/publish`,{method:"POST",body:JSON.stringify({summary,validatedDocumentHash:validatedHash})}); setSummary(""); setValidatedHash(null); await refresh(); } catch (reason) { setError(text(reason)); } finally { setBusy(false); }
  };
  const addRule = () => {
    if (ruleKind === "setting" && settingKey) { const entry=registry.find((setting) => setting.key===settingKey); setDraft((current) => ({...current,settings:{...current.settings,[settingKey]:{value:initial(entry),locked:true}}})); }
    if (ruleKind === "llm") setDraft((current) => ({...current,llm:{...current.llm,enabled:true,quotas:current.llm?.quotas ?? []}}));
    if (ruleKind === "retention") setDraft((current) => ({...current,governance:{...current.governance,activityRetentionDays:30,conversationRetentionDays:30}}));
  };
  const available=registry.filter((entry) => !draft.settings?.[entry.key]);
  return <div className="resource-page"><PageToolbar title={group ? `Policies for ${group.name}` : "Policies"} description="Create named policies, add only the rules you need, then save, validate, and publish." />
    {error && <p role="alert">{error}</p>}
    <div className="policy-workspace"><aside className="policy-list" aria-label="Policies"><h2>Policies in this group</h2>{collection.local.map((policy) => <button type="button" key={policy.id} className={policy.id===selectedId ? "policy-list-item selected" : "policy-list-item"} onClick={() => setSelectedId(policy.id)}><strong>{policy.name}</strong><span>{policy.activeVersionId ? "Published" : policy.draftHash ? "Saved draft" : "Draft"}</span></button>)}<div className="policy-create"><label htmlFor="new-policy-name">New policy name</label><input id="new-policy-name" value={newName} onChange={(event) => setNewName(event.currentTarget.value)} /><button className="secondary-action" disabled={!editable || busy || !newName.trim()} onClick={() => void create()}>Create policy</button></div><h2>Inherited policies</h2>{collection.inherited.length ? collection.inherited.map((policy) => <div className="policy-list-item inherited" key={policy.id}><strong>{policy.name}</strong><span>{policy.groupName} · read only</span></div>) : <p>No inherited policies.</p>}</aside>
      <main className="policy-builder">{!selected ? <p>Select or create a policy to begin.</p> : <><header className="policy-builder-header"><div><h2>{selected.name}</h2><p>{dirty ? "Unsaved changes" : validatedHash===savedHash && savedHash ? "Validated" : selected.activeVersionId ? "Published" : savedHash ? "Saved" : "Draft"}</p></div></header><section className="policy-actions"><button className="secondary-action" disabled={!editable || busy || !dirty} onClick={() => void save()}>Save draft</button><button className="secondary-action" disabled={!editable || busy || dirty || !savedHash} onClick={() => void validate()}>Validate</button><label>Publish summary<input value={summary} onChange={(event) => setSummary(event.currentTarget.value)} placeholder="Describe this change" /></label><button className="primary-action" disabled={!publishable || busy || Boolean(nextStep)} onClick={() => void publish()}>Publish</button>{nextStep && <p className="policy-next-step">{nextStep}</p>}</section><section className="policy-rule-picker"><h3>Add rule</h3><select aria-label="Rule type" value={ruleKind} onChange={(event) => setRuleKind(event.currentTarget.value as typeof ruleKind)}><option value="setting">Lock app setting</option><option value="llm">Enable LLM access</option><option value="retention">Set retention</option></select>{ruleKind==="setting" && <select aria-label="App setting" value={settingKey} onChange={(event) => setSettingKey(event.currentTarget.value)}><option value="">Choose a setting</option>{available.map((entry) => <option key={entry.key} value={entry.key}>{label(entry.key)}</option>)}</select>}<button className="secondary-action" disabled={!editable || (ruleKind==="setting" && !settingKey)} onClick={addRule}>Add rule</button></section><section className="policy-rules"><h3>Rules</h3>{Object.entries(draft.settings ?? {}).map(([key,rule]:[string,any]) => <SettingCard key={key} entry={registry.find((setting) => setting.key===key)} name={key} rule={rule} disabled={!editable} onChange={(value) => setDraft((current) => ({...current,settings:{...current.settings,[key]:{...current.settings[key],value}}}))} onRemove={() => setDraft((current) => { const settings={...current.settings}; delete settings[key]; return {...current,settings}; })} />)}{draft.llm?.enabled!==undefined && <RuleCard title="Enable LLM access" onRemove={() => setDraft((current) => ({...current,llm:{...current.llm,enabled:undefined}}))}><input aria-label="LLM enabled" type="checkbox" checked={Boolean(draft.llm.enabled)} disabled={!editable} onChange={(event) => setDraft((current) => ({...current,llm:{...current.llm,enabled:event.currentTarget.checked}}))} /></RuleCard>}{draft.governance?.activityRetentionDays!==undefined && <RuleCard title="Retention" onRemove={() => setDraft((current) => ({...current,governance:{...current.governance,activityRetentionDays:undefined,conversationRetentionDays:undefined}}))}><label>Activity days<input aria-label="Activity retention days" type="number" min="1" max="90" value={draft.governance.activityRetentionDays} disabled={!editable} onChange={(event) => setDraft((current) => ({...current,governance:{...current.governance,activityRetentionDays:event.currentTarget.valueAsNumber}}))} /></label><label>Conversation days<input aria-label="Conversation retention days" type="number" min="1" max="90" value={draft.governance.conversationRetentionDays} disabled={!editable} onChange={(event) => setDraft((current) => ({...current,governance:{...current.governance,conversationRetentionDays:event.currentTarget.valueAsNumber}}))} /></label></RuleCard>}{!Object.keys(draft.settings ?? {}).length && draft.llm?.enabled===undefined && draft.governance?.activityRetentionDays===undefined && <p>No rules yet. Add a rule to define what this policy enforces.</p>}</section></>}</main></div></div>;
}

function SettingCard({entry,name,rule,disabled,onChange,onRemove}:{entry?:Setting;name:string;rule:any;disabled:boolean;onChange(value:unknown):void;onRemove():void}) { const title=label(name); return <RuleCard title={`Lock ${title}`} onRemove={onRemove}><label>{title}{entry?.valueType==="boolean" ? <input aria-label={title} type="checkbox" checked={Boolean(rule.value)} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} /> : entry?.valueType==="select" ? <select aria-label={title} value={String(rule.value)} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}>{entry.allowedValues.map((value) => <option key={value}>{value}</option>)}</select> : <input aria-label={title} type={entry?.valueType==="number" ? "number" : "text"} value={String(rule.value ?? "")} disabled={disabled} onChange={(event) => onChange(entry?.valueType==="number" ? event.currentTarget.valueAsNumber : event.currentTarget.value)} />}</label><label><input type="checkbox" checked disabled /> Lock this setting</label></RuleCard>; }
function RuleCard({title,children,onRemove}:{title:string;children:ReactNode;onRemove():void}) { return <article className="policy-rule-card"><header><strong>{title}</strong><button type="button" className="text-action" onClick={onRemove}>Remove</button></header>{children}</article>; }
function initial(entry?:Setting):unknown { if (entry?.valueType==="boolean") return false; if (entry?.valueType==="number") return 0; if (entry?.valueType==="select") return entry.allowedValues[0] ?? ""; return ""; }
function label(value:string) { return value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]/g," ").replace(/^./,(letter) => letter.toUpperCase()); }
function text(reason:unknown) { return reason instanceof Error ? reason.message : "Policy request failed"; }
