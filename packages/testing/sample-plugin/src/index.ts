/**
 * Host face of the test-only sample plugin. It owns the `sample` Remote
 * namespace: `echo` is a unary `@Remote` method, `count` a stream method, and
 * `unmarked` an ordinary method that stays off the wire. Acceptance tests
 * insert it through a profile patch; no bundle ships it.
 * @module @dramaip/test-sample-plugin
 */
import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  RemoteError,
  TypertRemoteService,
} from "@dramaip/infra-typert-protocol";
import type { SampleEcho, SampleTick } from "./types.ts";

export type * from "./types.ts";

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** Host owner of the sample `sample` Remote namespace. */
    sampleController: SampleController;
  }
}

/** Largest `count` limit one call may request. */
const MAX_COUNT = 100;

/** Host service backing the generated `ctx.remote.sample` namespace. */
export class SampleController extends TypertRemoteService {
  /**
   * Register the `sample` namespace.
   * @param ctx - Host context the service mounts on.
   */
  constructor(ctx: Context) {
    super(ctx, "sampleController", { namespace: "sample" });
  }

  /**
   * Answer with the text the caller sent.
   * @param text - text to echo.
   * @returns the same text.
   */
  @Remote
  echo(text: string): SampleEcho {
    return { text };
  }

  /**
   * Stream `limit` numbered frames, then end.
   * @param limit - number of frames, from 1 to 100.
   * @param signal - generation cancellation.
   * @returns frames `1..limit`.
   * @throws RemoteError when `limit` is outside 1..100.
   */
  @Remote({ mode: "stream" })
  async *count(limit: number, signal: AbortSignal): AsyncIterable<SampleTick> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COUNT) {
      throw new RemoteError(
        "gateway/bad-request",
        `sample/count: limit must be an integer from 1 to ${MAX_COUNT}`,
        {},
      );
    }
    for (let n = 1; n <= limit; n += 1) {
      signal.throwIfAborted();
      yield { n };
    }
  }

  /**
   * A Host-only method without `@Remote`: the generator leaves it out of the
   * Client types and the Gateway answers a wire call with a structured error.
   * @returns a constant marker.
   */
  unmarked(): string {
    return "host-only";
  }
}

export default SampleController;
