export type OwnerRead<T> = {
  data?: T;
  status: string;
  error?: unknown;
  isFetchedAfterMount: boolean;
};

// Retaining the last successful snapshot during a later poll is distinct from
// trusting a cache before this mount's actual read or after a read failure.
export function successfulOwnerRead<T>(query: OwnerRead<T>): T | undefined {
  return query.status === "success" && !query.error && query.isFetchedAfterMount
    ? query.data
    : undefined;
}

export function currentOwnerQuery<Query extends OwnerRead<unknown>>(
  query: Query,
) {
  return {
    ...query,
    data: successfulOwnerRead<Query["data"]>(query),
  };
}

export const CURRENT_OWNER_READ_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  retry: false as const,
};

// Object member order is not a source change; array order and every actual
// value remain significant. Optional absent fields are not invented.
export function sameFrozenOwnerSnapshot(
  left: unknown,
  right: unknown,
): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return (
    left !== undefined &&
    right !== undefined &&
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
  );
}

export function exactNavigationError(
  params: URLSearchParams,
  keys: readonly string[],
) {
  return keys.some((key) => {
    const values = params.getAll(key);
    return values.length > 1 || values.some((value) => !value.trim());
  })
    ? "指定链接含空白或重复身份；未改用最近候选或运行。"
    : undefined;
}
