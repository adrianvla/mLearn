import type { ActivityPolicyScope } from './activitySessionizer'
import { createActivityHub } from './activityHub'

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
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${kind}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
