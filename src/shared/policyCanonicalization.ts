import { canonicalize } from 'json-canonicalize';

export function canonicalizePolicyJson(value: unknown): string {
  return canonicalize(value);
}
