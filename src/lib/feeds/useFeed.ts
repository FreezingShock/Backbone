// Polls a feed endpoint on an interval. Client-side. Keeps the last good data when a poll fails.
import { useEffect, useRef, useState } from 'react';

export const DEFAULT_POLL_MS = 5 * 60_000;

export interface FeedState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  // Epoch ms of the last successful poll.
  lastUpdated: number | null;
}

export function useFeed<T>(url: string, intervalMs: number = DEFAULT_POLL_MS): FeedState<T> {
  const [state, setState] = useState<FeedState<T>>({ data: null, error: null, loading: true, lastUpdated: null });
  const lastUpdatedRef = useRef<number | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;

    const poll = async (): Promise<void> => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as T;
        lastUpdatedRef.current = Date.now();
        setState({ data, error: null, loading: false, lastUpdated: lastUpdatedRef.current });
      } catch (caught) {
        if (controller?.signal.aborted) return;
        // Keep the previous data. Only the error message changes.
        const message = caught instanceof Error ? caught.message : 'request failed';
        setState((prev) => ({ ...prev, error: message, loading: false }));
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), intervalMs);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [url, intervalMs]);

  return state;
}
