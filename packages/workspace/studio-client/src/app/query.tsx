/**
 * The app's read cache: keyed owner reads shared between views, refetched
 * when stale, on an interval, on window focus or when a write invalidates
 * them, and writes that report their own progress. It keeps the subset of
 * the former query library the app used, with the same defaults: reads are
 * fresh for `staleTime`, retried with backoff, kept five minutes after the
 * last view leaves, and an unchanged answer keeps its previous identity.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type QueryKey = readonly unknown[];

type Retry =
  boolean | number | ((failureCount: number, error: Error) => boolean);

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "idle";
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export interface QueryOptions<T, S = T> {
  queryKey: QueryKey;
  queryFn: () => T | Promise<T>;
  enabled?: boolean;
  staleTime?: number;
  retry?: Retry;
  refetchInterval?:
    | number
    | false
    | undefined
    | ((query: { state: QueryState<T> }) => number | false | undefined);
  refetchOnWindowFocus?: boolean;
  refetchOnMount?: boolean | "always";
  select?: (data: T) => S;
  placeholderData?: T | ((previous: T | undefined) => T | undefined);
  initialData?: T | (() => T | undefined);
  meta?: Record<string, unknown>;
  gcTime?: number;
}

interface QueryResultBase {
  isLoading: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
  isFetchedAfterMount: boolean;
}

/** One read as a view sees it; `status` narrows `data` and `error`. */
export type QueryResult<S> = QueryResultBase & {
  refetch(): Promise<QueryOutcome<S>>;
} & QueryOutcome<S>;

export type QueryOutcome<S> =
  | {
      status: "success";
      isSuccess: true;
      isPending: false;
      isError: false;
      data: S;
      error: null;
    }
  | {
      status: "error";
      isSuccess: false;
      isPending: false;
      isError: true;
      data: S | undefined;
      error: Error;
    }
  | {
      status: "pending";
      isSuccess: false;
      isPending: true;
      isError: false;
      data: undefined;
      error: null;
    };

interface Entry {
  key: QueryKey;
  state: QueryState<unknown>;
  stale: boolean;
  observers: Set<() => void>;
  run: (() => Promise<unknown>) | undefined;
  options: QueryOptions<unknown, unknown> | undefined;
  inflight: Promise<unknown> | undefined;
  gc: ReturnType<typeof setTimeout> | undefined;
}

function hashKey(key: QueryKey): string {
  return JSON.stringify(key, (_name, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );
}

function partialMatch(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  )
    return false;
  return Object.keys(expected).every((name) =>
    partialMatch(
      (actual as Record<string, unknown>)[name],
      (expected as Record<string, unknown>)[name],
    ),
  );
}

/** Keep the previous value wherever the new one is structurally equal. */
function shareEqual<T>(previous: unknown, next: T): T {
  if (previous === next) return next;
  if (
    previous === null ||
    next === null ||
    typeof previous !== "object" ||
    typeof next !== "object" ||
    Array.isArray(previous) !== Array.isArray(next) ||
    Object.getPrototypeOf(next) !== Object.getPrototypeOf(previous) ||
    (Object.getPrototypeOf(next) !== Object.prototype && !Array.isArray(next))
  )
    return next;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const names = Object.keys(after);
  let same = names.length === Object.keys(before).length;
  const copy: Record<string, unknown> = Array.isArray(next)
    ? ([] as unknown as Record<string, unknown>)
    : {};
  for (const name of names) {
    const value = shareEqual(before[name], after[name]);
    copy[name] = value;
    if (value !== before[name] || !(name in before)) same = false;
  }
  return (same ? previous : copy) as T;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface InvalidateFilter {
  queryKey?: QueryKey;
  exact?: boolean;
  predicate?(query: {
    queryKey: QueryKey;
    state: QueryState<unknown>;
  }): boolean;
  refetchType?: "active" | "inactive" | "all" | "none";
}

export class QueryClient {
  readonly #entries = new Map<string, Entry>();
  readonly #defaults: { staleTime: number; retry: Retry };

  constructor(
    options: {
      defaultOptions?: { queries?: { staleTime?: number; retry?: Retry } };
    } = {},
  ) {
    this.#defaults = {
      staleTime: options.defaultOptions?.queries?.staleTime ?? 0,
      retry: options.defaultOptions?.queries?.retry ?? 3,
    };
  }

  get defaults() {
    return this.#defaults;
  }

  entry(key: QueryKey): Entry {
    const hash = hashKey(key);
    let entry = this.#entries.get(hash);
    if (!entry) {
      entry = {
        key,
        state: {
          data: undefined,
          error: null,
          status: "pending",
          fetchStatus: "idle",
          dataUpdatedAt: 0,
          errorUpdatedAt: 0,
        },
        stale: true,
        observers: new Set(),
        run: undefined,
        options: undefined,
        inflight: undefined,
        gc: undefined,
      };
      this.#entries.set(hash, entry);
    }
    return entry;
  }

  update(entry: Entry, patch: Partial<QueryState<unknown>>): void {
    entry.state = { ...entry.state, ...patch };
    for (const notify of Array.from(entry.observers)) notify();
  }

  observe(entry: Entry, notify: () => void): () => void {
    if (entry.gc) clearTimeout(entry.gc);
    entry.gc = undefined;
    entry.observers.add(notify);
    return () => {
      entry.observers.delete(notify);
      if (entry.observers.size === 0)
        entry.gc = setTimeout(() => {
          if (entry.observers.size === 0)
            this.#entries.delete(hashKey(entry.key));
        }, entry.options?.gcTime ?? 300_000);
    };
  }

  /**
   * Run the entry's read, sharing one request among callers. A `fresh` read
   * (an invalidation or an explicit refetch) does not join a request already
   * in flight, which may have started before the write it follows; that
   * request's answer is then dropped for the fresh one's.
   */
  load(entry: Entry, fresh = false): Promise<unknown> {
    const options = entry.options;
    if (!options) return Promise.resolve(entry.state.data);
    if (entry.inflight && !fresh) return entry.inflight;
    const retry = options.retry ?? this.#defaults.retry;
    this.update(entry, { fetchStatus: "fetching" });
    const attempt = async (failures: number): Promise<unknown> => {
      try {
        return await options.queryFn();
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const again =
          typeof retry === "function"
            ? retry(failures, error)
            : typeof retry === "number"
              ? failures < retry
              : retry;
        if (!again) throw error;
        await sleep(Math.min(1000 * 2 ** failures, 30_000));
        return attempt(failures + 1);
      }
    };
    const inflight: Promise<unknown> = attempt(0).then(
      (data) => {
        if (entry.inflight !== inflight) return entry.inflight ?? data;
        entry.inflight = undefined;
        entry.stale = false;
        this.update(entry, {
          data: shareEqual(entry.state.data, data),
          error: null,
          status: "success",
          fetchStatus: "idle",
          dataUpdatedAt: Date.now(),
        });
        return data;
      },
      (error: Error) => {
        if (entry.inflight !== inflight) {
          if (entry.inflight) return entry.inflight;
          throw error;
        }
        entry.inflight = undefined;
        this.update(entry, {
          error,
          status: "error",
          fetchStatus: "idle",
          errorUpdatedAt: Date.now(),
        });
        throw error;
      },
    );
    entry.inflight = inflight;
    return inflight;
  }

  getQueryData<T>(key: QueryKey): T | undefined {
    return this.#entries.get(hashKey(key))?.state.data as T | undefined;
  }

  setQueryData<T>(
    key: QueryKey,
    value: T | undefined | ((previous: T | undefined) => T | undefined),
  ): void {
    const entry = this.entry(key);
    const next =
      typeof value === "function"
        ? (value as (previous: T | undefined) => T | undefined)(
            entry.state.data as T | undefined,
          )
        : value;
    if (next === undefined) return;
    entry.stale = false;
    this.update(entry, {
      data: next,
      error: null,
      status: "success",
      dataUpdatedAt: Date.now(),
    });
  }

  /** Mark matching reads stale and refetch the ones on screen. */
  async invalidateQueries(filter: InvalidateFilter = {}): Promise<void> {
    const matches = [...this.#entries.values()].filter((entry) => {
      if (filter.queryKey) {
        if (filter.exact) {
          if (hashKey(entry.key) !== hashKey(filter.queryKey)) return false;
        } else if (
          filter.queryKey.length > entry.key.length ||
          !filter.queryKey.every((part, index) =>
            partialMatch(entry.key[index], part),
          )
        )
          return false;
      }
      return filter.predicate
        ? filter.predicate({ queryKey: entry.key, state: entry.state })
        : true;
    });
    const type = filter.refetchType ?? "active";
    await Promise.all(
      matches.map((entry) => {
        entry.stale = true;
        const active =
          entry.observers.size > 0 && entry.options?.enabled !== false;
        if (
          type === "none" ||
          (type === "active" && !active) ||
          (type === "inactive" && active)
        )
          return undefined;
        return this.load(entry, true).catch(() => undefined);
      }),
    );
  }

  /** Refetch stale reads on screen (window focus). */
  refetchStale(): void {
    for (const entry of this.#entries.values())
      if (
        entry.observers.size > 0 &&
        entry.options?.enabled !== false &&
        entry.options?.refetchOnWindowFocus !== false &&
        this.isStale(entry)
      )
        void this.load(entry).catch(() => undefined);
  }

  isStale(entry: Entry): boolean {
    if (entry.stale || entry.state.status !== "success") return true;
    const staleTime = entry.options?.staleTime ?? this.#defaults.staleTime;
    return Date.now() - entry.state.dataUpdatedAt >= staleTime;
  }
}

const QueryContext = createContext<QueryClient | undefined>(undefined);

export function QueryClientProvider(props: {
  client: QueryClient;
  children?: ReactNode;
}) {
  useEffect(() => {
    const onFocus = () => props.client.refetchStale();
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [props.client]);
  return (
    <QueryContext.Provider value={props.client}>
      {props.children}
    </QueryContext.Provider>
  );
}

export function useQueryClient(): QueryClient {
  const client = useContext(QueryContext);
  if (!client) throw new Error("缺少读取缓存：请在 QueryClientProvider 内使用");
  return client;
}

export function useQuery<T, S = T>(
  options: QueryOptions<T, S> & { initialData: T | (() => T) },
): QueryResult<S> & {
  data: S;
  refetch(): Promise<QueryOutcome<S> & { data: S }>;
};
export function useQuery<T, S = T>(options: QueryOptions<T, S>): QueryResult<S>;
export function useQuery<T, S = T>(
  options: QueryOptions<T, S>,
): QueryResult<S> {
  const client = useQueryClient();
  const entry = client.entry(options.queryKey);
  entry.options = options as QueryOptions<unknown, unknown>;
  if (
    entry.state.status === "pending" &&
    entry.state.data === undefined &&
    options.initialData !== undefined
  ) {
    const initial =
      typeof options.initialData === "function"
        ? (options.initialData as () => T | undefined)()
        : options.initialData;
    if (initial !== undefined)
      entry.state = {
        ...entry.state,
        data: initial,
        status: "success",
        dataUpdatedAt: Date.now(),
      };
  }
  const enabled = options.enabled !== false;
  const subscribe = useCallback(
    (notify: () => void) => client.observe(entry, notify),
    [client, entry],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => entry.state,
    () => entry.state,
  ) as QueryState<T>;

  // When this view started watching the entry, for `isFetchedAfterMount`.
  const mountedAt = useRef<{ entry: Entry; at: number }>(undefined);
  if (mountedAt.current?.entry !== entry)
    mountedAt.current = {
      entry,
      at: Math.max(entry.state.dataUpdatedAt, entry.state.errorUpdatedAt),
    };
  const onMount = options.refetchOnMount ?? true;
  useEffect(() => {
    if (!enabled || onMount === false) return;
    if (onMount === "always" || client.isStale(entry)) {
      entry.stale = true;
      void client.load(entry).catch(() => undefined);
    }
    // Only a new entry or enabling it starts a read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, entry, enabled]);

  const interval =
    typeof options.refetchInterval === "function"
      ? options.refetchInterval({ state })
      : options.refetchInterval;
  useEffect(() => {
    if (!enabled || !interval) return;
    const timer = setInterval(
      () => void client.load(entry).catch(() => undefined),
      interval,
    );
    return () => clearInterval(timer);
  }, [client, entry, enabled, interval]);

  // The last answer under a previous key, for `placeholderData`.
  const previous = useRef<T | undefined>(undefined);
  if (state.data !== undefined) previous.current = state.data;
  let data = state.data;
  let status = state.status;
  if (data === undefined && options.placeholderData !== undefined) {
    data =
      typeof options.placeholderData === "function"
        ? (options.placeholderData as (p: T | undefined) => T | undefined)(
            previous.current,
          )
        : options.placeholderData;
    if (data !== undefined && status === "pending") status = "success";
  }

  const select = options.select;
  const selected = useRef<{ input: unknown; select: unknown; output: S }>(
    undefined,
  );
  let output: S | undefined;
  if (data === undefined || !select) output = data as S | undefined;
  else if (
    selected.current &&
    selected.current.input === data &&
    selected.current.select === select
  )
    output = selected.current.output;
  else {
    const value = shareEqual(selected.current?.output, select(data));
    selected.current = { input: data, select, output: value };
    output = value;
  }

  const latest = useRef({ select, previous: selected });
  latest.current = { select, previous: selected };
  const refetch = useCallback(async (): Promise<QueryOutcome<S>> => {
    entry.stale = true;
    await client.load(entry, true).catch(() => undefined);
    const current = latest.current.select;
    const raw = entry.state.data as T | undefined;
    return outcome<S>(
      entry.state.status,
      raw === undefined || !current ? (raw as S | undefined) : current(raw),
      entry.state.error,
    );
  }, [client, entry]);
  return {
    ...outcome<S>(status, output, state.error),
    isLoading: status === "pending" && state.fetchStatus === "fetching",
    isFetching: state.fetchStatus === "fetching",
    dataUpdatedAt: state.dataUpdatedAt,
    isFetchedAfterMount:
      Math.max(state.dataUpdatedAt, state.errorUpdatedAt) >
      mountedAt.current.at,
    refetch,
  };
}

function outcome<S>(
  status: QueryState<unknown>["status"],
  data: S | undefined,
  error: Error | null,
): QueryOutcome<S> {
  if (status === "success")
    return {
      status,
      isSuccess: true,
      isPending: false,
      isError: false,
      data: data as S,
      error: null,
    };
  if (status === "error")
    return {
      status,
      isSuccess: false,
      isPending: false,
      isError: true,
      data,
      error: error ?? new Error("read failed"),
    };
  return {
    status,
    isSuccess: false,
    isPending: true,
    isError: false,
    data: undefined,
    error: null,
  };
}

export interface MutationOptions<T, V> {
  mutationFn: (variables: V) => Promise<T>;
  onMutate?(variables: V): unknown;
  onSuccess?(data: T, variables: V): unknown;
  onError?(error: Error, variables: V): unknown;
  onSettled?(data: T | undefined, error: Error | null, variables: V): unknown;
}

export interface MutationResult<T, V> {
  mutate(variables: V): void;
  mutateAsync(variables: V): Promise<T>;
  reset(): void;
  data: T | undefined;
  error: Error | null;
  variables: V | undefined;
  status: "idle" | "pending" | "error" | "success";
  isIdle: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

export function useMutation<T, V = void>(
  options: MutationOptions<T, V>,
): MutationResult<T, V> {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<{
    status: MutationResult<T, V>["status"];
    data: T | undefined;
    error: Error | null;
    variables: V | undefined;
  }>({ status: "idle", data: undefined, error: null, variables: undefined });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const set = (next: typeof state) => {
    if (mounted.current) setState(next);
  };
  const mutateAsync = useCallback(async (variables: V): Promise<T> => {
    const current = latest.current;
    set({ status: "pending", data: undefined, error: null, variables });
    try {
      await current.onMutate?.(variables);
      const data = await current.mutationFn(variables);
      await current.onSuccess?.(data, variables);
      await current.onSettled?.(data, null, variables);
      set({ status: "success", data, error: null, variables });
      return data;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      set({ status: "error", data: undefined, error, variables });
      await current.onError?.(error, variables);
      await current.onSettled?.(undefined, error, variables);
      throw error;
    }
    // `set` only guards unmounted updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mutate = useCallback(
    (variables: V) => void mutateAsync(variables).catch(() => undefined),
    [mutateAsync],
  );
  return {
    ...state,
    mutate,
    mutateAsync,
    reset: () =>
      set({
        status: "idle",
        data: undefined,
        error: null,
        variables: undefined,
      }),
    isIdle: state.status === "idle",
    isPending: state.status === "pending",
    isError: state.status === "error",
    isSuccess: state.status === "success",
  };
}
