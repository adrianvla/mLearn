import type { ActivityPolicyScope } from './activitySessionizer'
import { createActivityHub } from './activityHub'
import { hashWordSync } from './srsAlgorithm'

let policyScope: ActivityPolicyScope | null = null

/** One hub per renderer JavaScript context (and therefore per app window). */
export const activityHub = createActivityHub({ getPolicyScope: () => policyScope })

export function setActivityPolicyScope(next: ActivityPolicyScope | null): void {
  if (policyScope?.activeGroupId === next?.activeGroupId
    && policyScope?.policyVersionId === next?.policyVersionId) return
  policyScope = next
  activityHub.refreshPolicyScope()
}

/** Produces an opaque, stable local content identifier without exposing a path or title. */
export function opaqueActivityContentId(kind: string, value: string): string | undefined {
  if (!value) return undefined
  return `${kind}-${hashWordSync(`${kind}\0${value}`)}`
}
