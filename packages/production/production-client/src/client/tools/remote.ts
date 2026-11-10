import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/automation-automation/remote";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/writing-writing/remote";

/** The Remote namespaces the production tool bodies call. */
export interface ToolRemotes {
  production: Context["remote"]["production"];
  automation: Context["remote"]["automation"];
  system: Context["remote"]["system"];
  writing: Context["remote"]["writing"];
}

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

/** A Remote failure, with the message the owner gave. */
export class RemoteError extends Error {
  constructor(error: Failure) {
    super(error.message);
    this.name = "RemoteError";
  }
}

/**
 * The value of a Remote answer.
 * @throws RemoteError with the answer's message when it failed.
 */
export async function value<T>(answer: Answer<T>): Promise<T> {
  const result = await answer;
  if (!result.ok) throw new RemoteError(result.error);
  return result.value;
}

/** The message of a failure, as the author reads it. */
export const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * A link names an id twice or blank; nothing nearest stands in for it.
 * @param params - the tool's query.
 * @param keys - the identities the link may name.
 */
export function ambiguousNavigation(
  params: URLSearchParams,
  keys: readonly string[],
): boolean {
  return keys.some((key) => {
    const values = params.getAll(key);
    return values.length > 1 || values.some((item) => !item.trim());
  });
}
