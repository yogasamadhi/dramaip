import { useCallback, useEffect, useRef, useState } from "react";

/** A value read now and again every interval, and a way to read it at once. */
export interface Polled<T> {
  /** The latest successful read; a failed read keeps the previous one. */
  value: T | undefined;
  /** Read again now. */
  refresh: () => void;
}

/**
 * Read a value on mount, every `intervalMs` and whenever `revision` changes.
 * @param read - the read; a rejection leaves the value as it was.
 * @param intervalMs - polling interval.
 * @param revision - any value whose change asks for a read.
 */
export function usePolled<T>(
  read: () => Promise<T>,
  intervalMs: number,
  revision: unknown = undefined,
): Polled<T> {
  const [value, setValue] = useState<T>();
  const [tick, setTick] = useState(0);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    let live = true;
    void latest.current().then(
      (next) => {
        if (live) setValue(next);
      },
      () => undefined,
    );
    const timer = setTimeout(() => setTick((count) => count + 1), intervalMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [intervalMs, revision, tick]);
  const refresh = useCallback(() => setTick((count) => count + 1), []);
  return { value, refresh };
}
