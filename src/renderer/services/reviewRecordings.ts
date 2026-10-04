/** Metadata-only discovery; a missing recording is normal, a failed read is unavailable evidence. */
export async function discoverReviewRecordings(ids: readonly string[], lookup: (id: string) => Promise<string | null>, signal: AbortSignal): Promise<Record<string, boolean>> {
  const unique = [...new Set(ids)];
  const results: Record<string, boolean> = {};
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < unique.length) {
      if (signal.aborted) throw new Error('Review recording discovery cancelled');
      const id = unique[next++];
      try { results[id] = !!await lookup(id); }
      catch (error) { failed = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
  if (signal.aborted) throw new Error('Review recording discovery cancelled');
  return results;
}
