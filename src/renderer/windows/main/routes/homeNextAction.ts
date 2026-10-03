/** Home translates the current learning workload into an activity, not another study controller. */
export type HomeNextAction = 'review' | 'practice' | 'assessment' | 'continue' | 'read';
export interface HomeWorkload {
  due: number;
  needsPractice: number;
  unassessed: number;
  assessed: number;
  hasMaterial: boolean;
}
export function homeNextAction(workload: HomeWorkload): HomeNextAction {
  if (workload.due > 0) return 'review';
  if (workload.needsPractice > 0) return 'practice';
  if (workload.unassessed > 0 && workload.assessed === 0) return 'practice';
  // Unmeasured coverage alone does not justify a compulsory diagnostic.
  return workload.hasMaterial ? 'continue' : 'read';
}
