import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/automation-automation/remote";
import type {} from "@dramaip/production-delivery/remote";
import type {} from "@dramaip/production-media/remote";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/workspace-workspace/remote";
import type {} from "@dramaip/writing-knowledge/remote";
import type {} from "@dramaip/writing-writing/remote";

/** The Remote namespaces the project tool bodies call. */
export interface ToolRemotes {
  workspace: Context["remote"]["workspace"];
  media: Context["remote"]["media"];
  writing: Context["remote"]["writing"];
  knowledge: Context["remote"]["knowledge"];
  system: Context["remote"]["system"];
  automation: Context["remote"]["automation"];
  production: Context["remote"]["production"];
  delivery: Context["remote"]["delivery"];
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

/**
 * A Remote failure with the HTTP status the replaced route answered with,
 * when it carries one.
 */
export class RemoteError extends Error {
  readonly status: number | undefined;
  constructor(error: Failure) {
    super(error.message);
    this.name = "RemoteError";
    const details = error.details as { status?: unknown } | undefined;
    this.status =
      error.code === "compat/problem" && typeof details?.status === "number"
        ? details.status
        : undefined;
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

/** The status a failure carries, if it is a `RemoteError` with one. */
export const statusOf = (cause: unknown): number | undefined =>
  cause instanceof RemoteError ? cause.status : undefined;

/** The message of a failure, as the author reads it. */
export const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
