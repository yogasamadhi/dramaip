import { useCallback, useEffect, useRef, useState } from "react";

/** One read the stage shows: its value, its failure and a way to read again. */
export interface Load<T> {
  data: T | undefined;
  error: unknown;
  /** Read again; settles once that read has. */
  reload: () => Promise<void>;
}

/**
 * Read once per key and again on `reload`; a later read wins over an
 * earlier one still in flight, and an empty key reads nothing.
 * @param key - what the read depends on; `undefined` skips it.
 * @param read - the read.
 */
export function useLoad<T>(
  key: string | undefined,
  read: () => Promise<T>,
): Load<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [revision, setRevision] = useState(0);
  const current = useRef(read);
  current.current = read;
  const waiting = useRef<Array<() => void>>([]);
  const settle = () => {
    for (const resolve of waiting.current.splice(0)) resolve();
  };
  useEffect(() => {
    if (key === undefined) {
      setData(undefined);
      setError(undefined);
      settle();
      return;
    }
    let live = true;
    current.current().then(
      (value) => {
        if (!live) return;
        setData(value);
        setError(undefined);
        settle();
      },
      (cause: unknown) => {
        if (!live) return;
        setError(cause ?? new Error(String(cause)));
        settle();
      },
    );
    return () => {
      live = false;
    };
  }, [key, revision]);
  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setRevision((value) => value + 1);
      }),
    [],
  );
  return { data, error, reload };
}
