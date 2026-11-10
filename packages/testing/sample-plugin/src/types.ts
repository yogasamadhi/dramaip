/**
 * Wire types of the sample `sample` Remote namespace.
 * @module @dramaip/test-sample-plugin/types
 */

/** Answer of the unary `sample/echo` method. */
export interface SampleEcho {
  /** The text the caller sent. */
  text: string;
}

/** One frame of the `sample/count` stream. */
export interface SampleTick {
  /** Position of this frame, starting at 1. */
  n: number;
}
