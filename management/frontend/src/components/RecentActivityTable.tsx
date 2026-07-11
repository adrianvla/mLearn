import type { LearnerAnalytics } from '../api/types';
import { DataTableShell } from './DataTableShell';

export function RecentActivityTable({ learners, loading, error, onRetry }: { learners: LearnerAnalytics[]; loading?: boolean; error?: string; onRetry?: () => void }) {
  return <DataTableShell label="Recent activity" loading={loading} error={error} onRetry={onRetry} empty="Learning activity will appear after learners begin a session.">
    {learners.length > 0 ? <div className="table-scroll"><table><caption className="sr-only">Recent learner activity</caption><thead><tr><th>Learner</th><th>Last activity</th><th>Sessions</th><th>Watch time</th><th>LLM requests</th></tr></thead><tbody>{learners.map((learner) => <tr key={learner.learnerId}><th>{learner.displayName}</th><td>{new Date(learner.lastActivityAt).toLocaleString()}</td><td>{learner.sessions}</td><td>{Math.round(learner.watchSeconds / 60)} min</td><td>{learner.llmRequests}</td></tr>)}</tbody></table></div> : undefined}
  </DataTableShell>;
}
