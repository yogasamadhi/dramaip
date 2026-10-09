import {
  EventStreamEnvelopeSchema,
  type DomainEvent,
  type RealtimeEvent,
} from "@dramaip/contracts";
import type { RuntimeTransport } from "@dramaip/server-connection";
import { asApiError, StudioClientError } from "./errors.js";
import { openGeneratedEventStream } from "./openapi-client.js";

export function createEventSubscription(
  transport: RuntimeTransport,
): (onEvent: (event: DomainEvent | RealtimeEvent) => void) => () => void {
  // One HTTP/1 event stream per SDK, not per mounted task card. Independent
  // streams can occupy every browser connection and indefinitely queue writes.
  const subscribers = new Set<{
    onEvent: (event: DomainEvent | RealtimeEvent) => void;
  }>();
  let stopConnection: (() => void) | undefined;
  const startConnection = (): (() => void) => {
    let disposed = false;
    let cursor = 0;
    let reconnectAttempt = 0;
    let controller: AbortController | undefined;
    let cancelDelay: (() => void) | undefined;
    const delivered = new Set<string>();
    const connect = async (): Promise<void> => {
      while (!disposed) {
        controller = new AbortController();
        try {
          const response = await openGeneratedEventStream(
            transport,
            cursor,
            controller.signal,
          );
          if (!response.ok || !response.body)
            throw new StudioClientError(
              response.status,
              asApiError(await response.json()),
            );
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let receivedFrame = false;
          try {
            while (!disposed) {
              const next = await reader.read();
              if (next.done) break;
              buffer += decoder.decode(next.value, { stream: true });
              const frames = buffer.split("\n\n");
              buffer = frames.pop() ?? "";
              for (const frame of frames) {
                const data = frame
                  .split("\n")
                  .find((line) => line.startsWith("data: "))
                  ?.slice(6);
                if (!data) continue;
                const parsed = EventStreamEnvelopeSchema.safeParse(
                  JSON.parse(data),
                );
                if (!parsed.success)
                  throw new Error("Runtime event envelope is invalid");
                const envelope = parsed.data;
                receivedFrame = true;
                if (envelope.kind === "domain")
                  cursor = Math.max(cursor, envelope.cursor);
                const identity =
                  envelope.kind === "domain"
                    ? `domain:${envelope.event.eventId}`
                    : `realtime:${envelope.event.id}`;
                if (delivered.has(identity)) continue;
                delivered.add(identity);
                if (delivered.size > 1_000)
                  delivered.delete(delivered.values().next().value!);
                // Snapshot: a listener added during dispatch starts at the next
                // frame, even if another listener mutates this Set synchronously.
                // oxlint-disable-next-line unicorn/no-useless-spread
                for (const subscriber of [...subscribers]) {
                  if (disposed || !subscribers.has(subscriber)) continue;
                  try {
                    subscriber.onEvent(envelope.event);
                  } catch (error) {
                    // Report a callback failure without reconnecting the shared
                    // transport or preventing the other listeners from receiving.
                    globalThis.reportError?.(error);
                  }
                }
              }
            }
          } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
          if (receivedFrame) reconnectAttempt = 0;
        } catch (error) {
          if (
            disposed ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            break;
        }
        if (disposed) break;
        const base = Math.min(30_000, 500 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            cancelDelay = undefined;
            resolve();
          }, delay);
          cancelDelay = () => {
            clearTimeout(timer);
            cancelDelay = undefined;
            resolve();
          };
        });
      }
    };
    void connect();
    return () => {
      disposed = true;
      controller?.abort();
      cancelDelay?.();
    };
  };
  return (onEvent) => {
    const subscriber = { onEvent };
    subscribers.add(subscriber);
    stopConnection ??= startConnection();
    return () => {
      if (!subscribers.delete(subscriber)) return;
      if (subscribers.size === 0) {
        stopConnection?.();
        stopConnection = undefined;
      }
    };
  };
}
