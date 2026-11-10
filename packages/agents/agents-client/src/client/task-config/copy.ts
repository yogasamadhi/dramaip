import type { TranslateNS } from "@dramaip/infra-ui-slots";

/** The `agents` copy. */
export type Translate = TranslateNS<"agents">;

const STATUSES = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
]);

/**
 * A task or candidate status in words; one the copy lacks reads as unknown.
 * @param t - the copy.
 * @param status - the status.
 */
export function statusText(t: Translate, status: string | undefined): string {
  return status && STATUSES.has(status)
    ? t(`run.status.${status}` as Parameters<Translate>[0])
    : t("run.status.unknown");
}

/**
 * A run's duration in seconds, or unknown.
 * @param milliseconds - the recorded latency.
 */
export function executionTime(
  t: Translate,
  milliseconds: number | undefined,
): string {
  return milliseconds !== undefined &&
    Number.isFinite(milliseconds) &&
    milliseconds >= 0
    ? t("run.seconds", { value: (milliseconds / 1000).toFixed(1) })
    : t("run.unknown");
}
