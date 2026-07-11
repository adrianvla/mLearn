import { useEffect, useMemo, useState } from "react";
import { ApiClient } from "../api/client";
import type { GroupNode, Membership } from "../api/types";
import { CapabilityEditor } from "../components/CapabilityEditor";
import { GroupTree } from "../components/GroupTree";
import { PageToolbar } from "../components/PageToolbar";
import { Link } from "react-router-dom";
import { useGroupScope } from "../groups/GroupScopeProvider";
const api = new ApiClient();
export default function Groups() {
  const scope = useGroupScope();
  const [groups, setGroups] = useState<GroupNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ groups: GroupNode[] }>("/api/groups", {
        signal: controller.signal,
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setGroups(result.groups);
          setSelectedId((current) =>
            current && result.groups.some((group) => group.id === current)
              ? current
              : (result.groups[0]?.id ?? null),
          );
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selectedId) {
      setMemberships([]);
      return;
    }
    const controller = new AbortController();
    api
      .get<{ memberships: Membership[] }>(
        `/api/groups/${encodeURIComponent(selectedId)}/memberships`,
        { signal: controller.signal },
      )
      .then((result) => {
        if (!controller.signal.aborted) setMemberships(result.memberships);
      });
    return () => controller.abort();
  }, [selectedId]);
  const filteredGroups = useMemo(
    () => groups.filter((group) => `${group.name} ${group.slug}`.toLowerCase().includes(search.trim().toLowerCase())),
    [groups, search],
  );
  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const selectedMembership = memberships.find((membership) => membership.id === selectedMembershipId) ?? null;
  const grantable = scope.status === "ready" ? scope.selectedGroup?.capabilities ?? [] : [];
  const updateCapabilities = async (capabilities: Membership["capabilities"]) => {
    if (!selectedId || !selectedMembership) return;
    const updated = await api.get<Membership>(`/api/groups/${encodeURIComponent(selectedId)}/memberships/${encodeURIComponent(selectedMembership.id)}`, { method: "PATCH", body: JSON.stringify({ capabilities }) });
    setMemberships((items) => items.map((item) => item.id === updated.id ? updated : item));
  };
  const canManage = scope.status === 'ready' && scope.can('group.manage');
  const openEditor = (mode: 'create' | 'edit') => {
    setEditor(mode);
    setName(mode === 'edit' ? selected?.name ?? '' : '');
    setSlug(mode === 'edit' ? selected?.slug ?? '' : '');
    setMutationError(null);
  };
  const saveGroup = async () => {
    if (!selected || !editor) return;
    try {
      const group = await api.get<GroupNode>(editor === 'create' ? '/api/groups' : `/api/groups/${encodeURIComponent(selected.id)}`, {
        method: editor === 'create' ? 'POST' : 'PATCH',
        body: JSON.stringify(editor === 'create' ? { parentId: selected.id, name, slug } : { name, slug }),
      });
      setGroups((items) => editor === 'create' ? [...items, group] : items.map((item) => item.id === group.id ? group : item));
      setSelectedId(group.id);
      setEditor(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Group update failed');
    }
  };
  const archiveGroup = async () => {
    if (!selected) return;
    try {
      await api.get(`/api/groups/${encodeURIComponent(selected.id)}/archive`, { method: 'POST' });
      setGroups((items) => items.filter((item) => item.id !== selected.id));
      setSelectedId(selected.parentId);
      setArchiveConfirm(false);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Group archive failed');
    }
  };
  return (
    <div className="resource-page">
      <PageToolbar
        title="Groups"
        description="The authorized school hierarchy, memberships, and delegated authority."
        actions={canManage && selected ? <div className="toolbar-actions"><button className="secondary-action" onClick={() => openEditor('edit')}>Edit group</button><button className="primary-action" onClick={() => openEditor('create')}>Create child group</button></div> : undefined}
      />
      <div className="group-workspace">
        <aside>
          <input aria-label="Search groups" placeholder="Search groups" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
          <GroupTree
            groups={filteredGroups}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
        <section className="group-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <h2>{selected.name}</h2>
                  <p>
                    {selected.slug} · {selected.status}
                  </p>
                </div>
                {canManage && selected.parentId !== null ? <button className="table-link" onClick={() => setArchiveConfirm(true)}>Archive group</button> : null}
              </header>
              {mutationError ? <p role="alert">{mutationError}</p> : null}
              <div className="detail-tabs" role="tablist">
                {[
                  "overview",
                  "members",
                  "permissions",
                  "policy",
                  "analytics",
                ].map((name) => (
                  <button
                    key={name}
                    role="tab"
                    aria-selected={tab === name}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {tab === "overview" && (
                <dl>
                  <div>
                    <dt>Group ID</dt>
                    <dd>{selected.id}</dd>
                  </div>
                  <div>
                    <dt>Parent</dt>
                    <dd>{selected.parentId ?? "School root"}</dd>
                  </div>
                </dl>
              )}
              {tab === "members" && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Status</th>
                        <th>Capabilities</th>
                        <th><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberships.map((membership) => (
                        <tr key={membership.id}>
                          <th>
                            {membership.userId ?? membership.invitedEmail}
                          </th>
                          <td>{membership.status}</td>
                          <td>{membership.capabilities.length}</td>
                          <td><button className="table-link" onClick={() => { setSelectedMembershipId(membership.id); setTab("permissions"); }}>Edit {membership.userId ?? membership.invitedEmail} permissions</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tab === "permissions" && (
                <>
                  <p>
                    {selectedMembership ? `Editing ${selectedMembership.userId ?? selectedMembership.invitedEmail}. ` : "Select a member in the Members tab before changing delegated authority. "}Inherited authority is enforced by the backend.
                  </p>
                  <CapabilityEditor
                    value={selectedMembership?.capabilities ?? []}
                    grantable={selectedMembership ? grantable : []}
                    onChange={(capabilities) => void updateCapabilities(capabilities)}
                  />
                </>
              )}
              {tab === "policy" && <section className="table-state"><p>Review the local draft, inherited constraints, and published history for this group.</p><Link className="table-link" to="/policies">Open policy editor</Link></section>}
              {tab === "analytics" && <section className="table-state"><p>Learning, content, LLM, and policy outcomes use this selected group as their scope.</p><Link className="table-link" to="/analytics">Open scoped analytics</Link></section>}
            </>
          ) : (
            <p>Select a group.</p>
          )}
        </section>
      </div>
      {editor && selected ? <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="group-editor-title" className="console-dialog"><h2 id="group-editor-title">{editor === 'create' ? `Create child of ${selected.name}` : `Edit ${selected.name}`}</h2><label>Group name<input aria-label="Group name" value={name} onChange={(event) => setName(event.currentTarget.value)} /></label><label>Slug<input aria-label="Group slug" value={slug} onChange={(event) => setSlug(event.currentTarget.value)} /></label><footer><button onClick={() => setEditor(null)}>Cancel</button><button disabled={!name.trim() || !slug.trim()} onClick={() => void saveGroup()}>{editor === 'create' ? 'Create group' : 'Save group'}</button></footer></section></div> : null}
      {archiveConfirm && selected ? <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="archive-group-title" className="console-dialog"><h2 id="archive-group-title">Archive {selected.name}?</h2><p>Archived groups and their active memberships stop granting access immediately.</p><footer><button onClick={() => setArchiveConfirm(false)}>Cancel</button><button onClick={() => void archiveGroup()}>Confirm archive</button></footer></section></div> : null}
    </div>
  );
}
