/**
 * Wire types of the operations domain controllers took over from `/api/v2`
 * (P4/P5). Type-only, so Client code imports them as well.
 * @module @dramaip/infra-operations/problem
 */

declare module "@dramaip/infra-typert-protocol" {
  interface RemoteErrorDetailsMap {
    /**
     * A taken-over `/api/v2` handler answered with a problem. The status and
     * code are the ones the route answered, so the existing app can map the
     * failure back.
     */
    "compat/problem": CompatProblem;
  }
}

/** The problem a taken-over handler answered with. */
export interface CompatProblem {
  /** HTTP status the route answered. */
  status: number;
  /** Problem code, e.g. `NOT_FOUND` or `VALIDATION_ERROR`. */
  code: string;
  /** The route's explanation, when it differed from the title. */
  detail?: string;
  /** Field errors, when the route reported them. */
  errors?: { [field: string]: string[] };
}

/** A non-JSON body a taken-over handler answered with (an export, a file). */
export type CompatFile =
  | {
      /** The body's media type. */
      contentType: string;
      /** The download name the route suggested. */
      fileName?: string;
      /** The body as text. */
      text: string;
    }
  | {
      /** The body's media type. */
      contentType: string;
      /** The download name the route suggested. */
      fileName?: string;
      /** The body's bytes, base64-encoded. */
      base64: string;
    };

/**
 * One server-sent event a taken-over streaming handler wrote, as it wrote
 * it, so the existing app's bridge can write it back unchanged.
 */
export interface CompatEvent {
  /** The event's `event:` field (the domain event type). */
  event: string;
  /** The event's `id:` field, when it had one. */
  id?: string;
  /** The event's `data:` field, parsed as JSON. */
  data: unknown;
}
