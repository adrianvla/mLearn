import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { PageToolbar } from '../components/PageToolbar';
import Config from './Config';

export default function Settings() {
  const auth = useAuth();
  return <div className="resource-page">
    <PageToolbar title="Settings" description="School identity, deployment endpoints, retention, security, and backup guidance." actions={auth.status === 'authenticated' && auth.user.isRoot ? <Link className="secondary-action" to="/settings/diagnostics">Open Diagnostics</Link> : undefined} />
    <section className="gateway-grid" aria-label="School settings">
      <article className="dashboard-panel"><h2>School identity</h2><p>The root group is the canonical school identity. Rename it and manage its hierarchy from Groups.</p><Link className="table-link" to="/groups">Manage school group</Link></article>
      <article className="dashboard-panel"><h2>Timezone and term calendar</h2><p>Quota periods use the root-group timezone and term boundaries. Configure calendar-backed limits in the policy quota editor.</p><Link className="table-link" to="/policies">Manage policies</Link></article>
      <article className="dashboard-panel"><h2>Retention and security</h2><p>Conversation retention, analytics retention, exports, model access, and hard-deny settings inherit through signed policies.</p><Link className="table-link" to="/policies">Review retention controls</Link></article>
      <article className="dashboard-panel"><h2>Endpoint guidance</h2><p>Expose the console only through TLS, keep the management token out of browser storage, and use desktop approval for local clients.</p></article>
      <article className="dashboard-panel"><h2>Backups</h2><p>Back up the management database, policy signing key, secret-encryption key, and configured storage volumes together. Test restoration before each term.</p>{auth.status === 'authenticated' && auth.user.isRoot ? <Link className="table-link" to="/settings/diagnostics">Inspect storage</Link> : null}</article>
    </section>
    <Config />
  </div>;
}
