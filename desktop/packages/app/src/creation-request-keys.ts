import { StudioClientError } from "@dramaip/client";

/** Only creation.start's terminal validation/domain rejection permits a fresh key.
 * Transport errors, timeouts and idempotency conflicts do not prove no creation.
 */
export function isDefiniteCreationStartRejection(cause: unknown): boolean {
  return (
    cause instanceof StudioClientError &&
    ((cause.status === 400 && cause.body.code === "VALIDATION_ERROR") ||
      (cause.status === 409 && cause.body.code === "CONFLICT"))
  );
}
