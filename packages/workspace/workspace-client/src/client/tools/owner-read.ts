import { useCallback, useEffect, useRef, useState } from "react";

/** One owner read as a tool shows it. */
export interface OwnerRead<T> {
  /** The answer of a read that settled on this mount; never after a failure. */
  data: T | undefined;
  error: unknown;
  /** No read has settled yet for the current key. */
  loading: boolean;
  /** A read is in flight. */
  fetching: boolean;
  /** Read again now; answers the read's data, or undefined when it failed or no key is set. */
  refetch(): Promise<T | undefined>;
}

/**
 * Read `load` while `key` is set, again every `every` ms after a read
 * settles. Only an answer read on this mount is shown, and none once a read
 * failed, so a cached or failed read never stands in for the owner's
 * current state; a new key starts over.
 */
export function useOwnerRead<T>(
  key: string | undefined,
  load: () => Promise<T>,
  every?: number,
): OwnerRead<T> {
  const [state, setState] = useState<{
    data?: T | undefined;
    error?: unknown;
    fetching: boolean;
    settled: boolean;
  }>({ fetching: false, settled: false });
  const loader = useRef(load);
  loader.current = load;
  const enabled = useRef(key !== undefined);
  enabled.current = key !== undefined;
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const run = useCallback(async (): Promise<T | undefined> => {
    // Without a key there is nothing to read: a refresh then is a no-op.
    if (!enabled.current) return undefined;
    const id = ++generation.current;
    clearTimeout(timer.current);
    setState((current) => ({ ...current, fetching: true }));
    let data: T | undefined;
    try {
      data = await loader.current();
      if (id === generation.current)
        setState({ data, fetching: false, settled: true });
    } catch (error) {
      data = undefined;
      if (id === generation.current)
        setState({ error, fetching: false, settled: true });
    }
    if (id === generation.current && every && enabled.current)
      timer.current = setTimeout(() => void run(), every);
    return data;
  }, [every]);
  useEffect(() => {
    generation.current++;
    clearTimeout(timer.current);
    setState({ fetching: false, settled: false });
    if (key === undefined) return;
    void run();
    return () => {
      generation.current++;
      clearTimeout(timer.current);
    };
  }, [key, run]);
  return {
    data: state.error === undefined ? state.data : undefined,
    error: state.error,
    loading: key !== undefined && !state.settled,
    fetching: state.fetching,
    refetch: run,
  };
}
