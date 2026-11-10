/** Canonical private request material, not a metric or an authorization proof. */
export function canonicalImportRequestJSON(value: unknown): string {
  const normalize = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(normalize)
      : entry && typeof entry === "object"
        ? Object.fromEntries(
            Object.entries(entry)
              .filter(([, child]) => child !== undefined)
              .sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              )
              .map(([key, child]) => [key, normalize(child)]),
          )
        : entry;
  return JSON.stringify(normalize(value));
}
