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
  return (onEvent) => {
    let disposed = false;
    let cursor = 0;
    let reconnectAttempt = 0;
    let controller: AbortController | undefined;
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
              onEvent(envelope.event);
            }
          }
          if (receivedFrame) reconnectAttempt = 0;
        } catch (error) {
          if (
            disposed ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            break;
        }
        const base = Math.min(30_000, 500 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    };
    void connect();
    return () => {
      disposed = true;
      controller?.abort();
    };
  };
}
