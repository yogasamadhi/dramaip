import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/automation-automation/remote";
import type {} from "@dramaip/production-delivery/remote";
import type {} from "@dramaip/production-media/remote";
import type {} from "@dramaip/production-production/remote";
import type {} from "@dramaip/production-review/remote";
import type {} from "@dramaip/production-timeline/remote";
import type {} from "@dramaip/system-system/remote";
import type {} from "@dramaip/writing-quality/remote";

/** The `review` Remote namespace: compliance, the editor, cloud and media review. */
export type ReviewRemote = Context["remote"]["review"];
/** The `delivery` Remote namespace: platform delivery and localization. */
export type DeliveryRemote = Context["remote"]["delivery"];
/** The `media` Remote namespace: the project assets a cover names. */
export type MediaRemote = Context["remote"]["media"];
/** The `timeline` Remote namespace: the exchange files of an episode's cut. */
export type TimelineRemote = Context["remote"]["timeline"];
/** The `automation` Remote namespace: the episode workflows. */
export type AutomationRemote = Context["remote"]["automation"];
/** The `production` Remote namespace: the scripts a revision targets. */
export type ProductionRemote = Context["remote"]["production"];
/** The `quality` Remote namespace: the quality records of an episode. */
export type QualityRemote = Context["remote"]["quality"];
/** The `system` Remote namespace: files, saving and credentials. */
export type SystemRemote = Context["remote"]["system"];

/** Every Remote namespace a review stage reads or writes. */
export interface StageRemotes {
  review: ReviewRemote;
  delivery: DeliveryRemote;
  media: MediaRemote;
  timeline: TimelineRemote;
  automation: AutomationRemote;
  production: ProductionRemote;
  quality: QualityRemote;
  system: SystemRemote;
}

/** A Remote answer: the value, or the failure. */
type Answer =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

/**
 * A Remote failure with the HTTP status the replaced route answered with:
 * a route problem keeps its own status, an argument the Gateway refused is
 * a 400, anything else carries none.
 */
export class RemoteError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  constructor(error: { code: string; message: string; details?: unknown }) {
    super(error.message);
    this.name = "RemoteError";
    this.code = error.code;
    const details = error.details as { status?: unknown } | undefined;
    this.status =
      error.code === "compat/problem" && typeof details?.status === "number"
        ? details.status
        : error.code === "gateway/bad-request" ||
            error.code === "gateway/input-invalid"
          ? 400
          : undefined;
  }
}

/**
 * The value of a Remote answer, or its failure thrown as a `RemoteError`.
 * @param answer - one Remote call.
 */
export async function value<T>(answer: Promise<Answer>): Promise<T> {
  const result = await answer;
  if (!result.ok) throw new RemoteError(result.error);
  return result.value as T;
}

/** The status a failure carries, if it is a `RemoteError` with one. */
export const statusOf = (cause: unknown): number | undefined =>
  cause instanceof RemoteError ? cause.status : undefined;

/** The message of any failure. */
export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** A text document a Remote method answers for the author to save. */
export interface TextDocument {
  fileName: string;
  content: string;
}

/**
 * Offer one document to the author's save dialog.
 * @param system - the `system` Remote namespace.
 * @param document - the document to save.
 * @returns whether the author saved it.
 */
export async function saveDocument(
  system: SystemRemote,
  document: TextDocument,
): Promise<boolean> {
  const result = await value<{ saved: boolean }>(
    system.saveTextFile({
      suggestedName: document.fileName,
      content: document.content,
    }),
  );
  return result.saved;
}
