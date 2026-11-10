/**
 * How one Remote method's arguments map onto the `/api/v2` operation it
 * replaced. A domain package exports its table from `./legacy` (pure data,
 * Client-safe); the controller builds the in-process call from it, and the
 * existing app's bridge turns the old HTTP request back into the method's
 * arguments. Type-only.
 * @module @dramaip/infra-operations/legacy-routes
 */

/**
 * Where one positional argument of the Remote method travels over HTTP.
 * `name` is the method's parameter name, which a path parameter shares with
 * its template.
 */
export type LegacyArg =
  /** A path parameter. */
  | { readonly from: "param"; readonly name: string }
  /**
   * The query parameters, as one object; the fields named in `numbers` are
   * numbers on the Remote side and decimal text on the wire.
   */
  | {
      readonly from: "query";
      readonly name: string;
      readonly numbers?: readonly string[];
    }
  /** The JSON request body. */
  | { readonly from: "body"; readonly name: string }
  /** The `If-Match` header. */
  | { readonly from: "ifMatch"; readonly name: string }
  /** The `Idempotency-Key` header. */
  | { readonly from: "idempotencyKey"; readonly name: string }
  /**
   * The last event cursor a stream's caller saw: the `Last-Event-ID` header,
   * else the `cursor` query parameter; a number, 0 for the whole log.
   */
  | { readonly from: "cursor"; readonly name: string };

/** One replaced operation and the Remote method that answers it. */
export interface LegacyRoute<Method extends string = string> {
  /** The replaced `/api/v2` operation. */
  readonly operationId: string;
  /** Its HTTP method. */
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Its path template, e.g. `/api/v2/projects/{id}/feedback`. */
  readonly path: `/api/v2/${string}`;
  /** The status the route answered on success. */
  readonly status: 200 | 201 | 202 | 204;
  /** The Remote method, in the domain's namespace. */
  readonly remote: Method;
  /** The method's positional arguments, in order. */
  readonly args: readonly LegacyArg[];
  /**
   * The route answered server-sent events; its method is a stream of
   * `CompatEvent`s and takes the call's signal after `args`.
   */
  readonly stream?: true;
}

/** A domain's table: its Remote namespace and the operations it replaced. */
export interface LegacyRouteTable<Method extends string = string> {
  /** The Remote namespace, e.g. `insights`. */
  readonly namespace: string;
  readonly routes: readonly LegacyRoute<Method>[];
}
