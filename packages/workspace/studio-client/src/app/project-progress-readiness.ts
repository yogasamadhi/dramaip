type ProgressRead = { data: unknown; error: unknown };

// Cached data is not a successful current read. Check every required owner
// before deriving a next action; an empty authoritative collection is valid.
export function projectProgressReadiness(
  reads: readonly ProgressRead[],
):
  | { state: "failed"; error: unknown }
  | { state: "loading" }
  | { state: "ready" } {
  const failed = reads.find(
    (read) => read.error !== null && read.error !== undefined,
  );
  if (failed) return { state: "failed", error: failed.error };
  if (reads.some((read) => read.data === undefined || read.data === null))
    return { state: "loading" };
  return { state: "ready" };
}
