interface SemanticVersion {
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease: string[];
}

const SEMANTIC_VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/;

function parseSemanticVersion(value: string): SemanticVersion | undefined {
  const match = SEMANTIC_VERSION_PATTERN.exec(value.trim());
  if (!match) return undefined;

  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((identifier) => NUMERIC_IDENTIFIER_PATTERN.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    return undefined;
  }

  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease,
  };
}

function comparePrereleaseIdentifiers(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftIdentifier);
    const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) > BigInt(rightIdentifier) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

export function compareSemanticVersions(left: string, right: string): number | undefined {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (!leftVersion || !rightVersion) return undefined;

  for (const field of ['major', 'minor', 'patch'] as const) {
    if (leftVersion[field] > rightVersion[field]) return 1;
    if (leftVersion[field] < rightVersion[field]) return -1;
  }

  return comparePrereleaseIdentifiers(leftVersion.prerelease, rightVersion.prerelease);
}

export function satisfiesMinimumAppVersion(currentVersion: string, minimumVersion: string): boolean {
  const comparison = compareSemanticVersions(currentVersion, minimumVersion);
  return comparison !== undefined && comparison >= 0;
}
