import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClient } from '../api/client';
import { PageToolbar } from '../components/PageToolbar';
import { useGroupScope } from '../groups/GroupScopeProvider';

type GovernanceSummary = {
  policies: Array<{ name: string; status: string; href: string }>;
  usage: Array<{ label: string; detail: string; href: string }>;
  activity: Array<{ action: string; timestamp: number; href: string }>;
};

const api = new ApiClient();

export default function Governance() {
  const scope = useGroupScope();
  const group = scope.status === 'ready' ? scope.selectedGroup : null;
  const [summary, setSummary] = useState<GovernanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    void api.get<GovernanceSummary>(`/api/governance/summary?groupId=${encodeURIComponent(group.id)}`)
      .then((result) => { if (!cancelled) { setSummary(result); setError(null); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load governance'); });
    return () => { cancelled = true; };
  }, [group?.id]);
  return <div className="resource-page governance-page">
    <PageToolbar title="Governance" description={group ? `Canonical policy, usage, and activity for ${group.name}.` : 'Canonical policy, usage, and activity.'} />
    {error ? <p role="alert">{error}</p> : null}
    <GovernanceSection title="Policies">
      {summary?.policies.length ? summary.policies.map((item) => <Link className="governance-row" key={item.name} to={item.href}><strong>{item.name}</strong><span>{item.status}</span></Link>) : <p>No policies are available in this scope.</p>}
    </GovernanceSection>
    <GovernanceSection title="Usage and limits">
      {summary?.usage.length ? summary.usage.map((item) => <Link className="governance-row" key={`${item.label}:${item.detail}`} to={item.href}><strong>{item.label}</strong><span>{item.detail}</span></Link>) : <p>No usage limits are available in this scope.</p>}
    </GovernanceSection>
    <GovernanceSection title="Recent governance activity">
      {summary?.activity.length ? summary.activity.map((item) => <Link className="governance-row" key={`${item.timestamp}:${item.action}`} to={item.href}><strong>{item.action}</strong><span>{new Date(item.timestamp * 1000).toLocaleString()}</span></Link>) : <p>No governance activity is available in this scope.</p>}
    </GovernanceSection>
  </div>;
}

function GovernanceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="governance-section" aria-labelledby={`governance-${title.replaceAll(' ', '-').toLowerCase()}`}>
    <h2 id={`governance-${title.replaceAll(' ', '-').toLowerCase()}`}>{title}</h2>
    <div>{children}</div>
  </section>;
}
