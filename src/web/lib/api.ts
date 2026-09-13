import { useCallback, useEffect, useState } from 'react';
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined) || '';
export const apiUrl = (path: string) => `${API_ORIGIN}${path}`;
export const apiFetch = (path: string, init: RequestInit = {}) =>
  fetch(apiUrl(path), { ...init, credentials: 'include' });
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    headers: {
      ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const result: unknown = await response.json();
  if (typeof result !== 'object' || result === null || !('success' in result))
    throw new ApiError('Unexpected server response', 'INVALID_RESPONSE', response.status);
  if (result.success !== true) {
    const error =
      'error' in result && typeof result.error === 'object' && result.error !== null
        ? result.error
        : null;
    throw new ApiError(
      error && 'message' in error ? String(error.message) : 'Request failed',
      error && 'code' in error ? String(error.code) : 'ERROR',
      response.status,
    );
  }
  if (!('data' in result))
    throw new ApiError('Response has no data', 'INVALID_RESPONSE', response.status);
  return result.data as T;
}
export const mutate = <T = unknown>(path: string, body?: unknown, method = 'POST') =>
  api<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export function useResource<T>(path: string | null, interval = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      const value = await api<T>(path);
      setData(value);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load data');
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!path) return;
      try {
        const value = await api<T>(path);
        if (alive) {
          setData(value);
          setError('');
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load data');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    const timer = interval ? setInterval(() => void run(), interval) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, interval]);
  return { data, error, loading, refresh };
}
export const formatMoney = (amount: number, currency = 'BDT') =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    amount / 100,
  );
