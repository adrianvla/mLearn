// ponytail: probe count is capped - raise MAX_MIRROR_PROBES or make it configurable if an operator ever runs more contiguous mirrors.
const MAX_MIRROR_PROBES = 8;

export function getMirrorCandidateUrl(configuredUrl: string, mirrorDomain: string, index: number): string | undefined {
  try {
    const url = new URL(configuredUrl);
    url.host = `mirror${index}.${mirrorDomain}`;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return undefined;
  }
}

// Mirror numbering is contiguous: probing stops at the first unreachable candidate
// and the last successfully fetched catalog wins.
export async function probeMirrorCatalog<T>(
  configuredUrl: string,
  mirrorDomain: string | undefined,
  fetchCatalog: (url: string) => Promise<T>,
): Promise<T | undefined> {
  const domain = mirrorDomain?.trim();
  if (!domain) {
    return undefined;
  }
  let lastGood: T | undefined;
  for (let x = 0; x < MAX_MIRROR_PROBES; x++) {
    const candidate = getMirrorCandidateUrl(configuredUrl, domain, x);
    if (!candidate) {
      return undefined;
    }
    try {
      lastGood = await fetchCatalog(candidate);
    } catch {
      break;
    }
  }
  return lastGood;
}
