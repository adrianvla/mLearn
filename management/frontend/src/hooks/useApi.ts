import { useCallback, useEffect, useState } from 'react';
import { ApiClient, AuthError, type ApiError } from '../api/client';

const client = new ApiClient();

export function useApi<T>(
  fetcher: (api: ApiClient) => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher(client)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if (err instanceof AuthError) setError('Authentication required. Enter your admin token.');
          else if (err instanceof Error && 'status' in err) setError((err as ApiError).message);
          else if (err instanceof Error) setError(err.message);
          else setError('Unknown error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, loading, error, refetch };
}

export { client as api };
