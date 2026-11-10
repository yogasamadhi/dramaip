import { useCallback, useEffect, useRef, useState } from "react";

/** A Remote failure. */
interface Failure {
  code?: string;
  message: string;
  details?: unknown;
}

/** A Remote answer. */
type Answer<T> = Promise<
  { ok: true; value: T } | { ok: false; error: Failure }
>;

/** The value of a Remote answer. @throws its failure's message. */
export async function value<T>(answer: Answer<T>): Promise<T> {
  const result = await answer;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** The message of a failure, for a notice. */
export const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** One owner read as a view shows it. */
export interface OwnerRead<T> {
  /** The answer of a read that settled on this mount; never after a failure. */
  data: T | undefined;
  error: unknown;
  /** No read has settled yet for the current key. */
  loading: boolean;
  /** A read is in flight. */
  fetching: boolean;
  /** Read again now, enabled or not. */
  refetch(): Promise<void>;
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
  const run = useCallback(async () => {
    const id = ++generation.current;
    clearTimeout(timer.current);
    setState((current) => ({ ...current, fetching: true }));
    try {
      const data = await loader.current();
      if (id === generation.current)
        setState({ data, fetching: false, settled: true });
    } catch (error) {
      if (id === generation.current)
        setState({ error, fetching: false, settled: true });
    }
    if (id === generation.current && every && enabled.current)
      timer.current = setTimeout(() => void run(), every);
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
