import { useEffect, useRef } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@dramaip/system-system/remote";

/** The `system` Remote namespace, whose event stream the views follow. */
export type SystemRemote = Context["remote"]["system"];

/** One published event: its type and payload. */
export interface PublishedEvent {
  type: string;
  occurredAt?: string;
  payload?: unknown;
}

type Listener = (event: PublishedEvent) => void;

interface Stream {
  listeners: Set<Listener>;
  stop: () => void;
}

/** One stream per Remote, shared by every mounted view. */
const streams = new WeakMap<SystemRemote, Stream>();
/** The last domain cursor seen per Remote, so a reopened stream resumes. */
const cursors = new WeakMap<SystemRemote, number>();

function open(system: SystemRemote): Stream {
  const listeners = new Set<Listener>();
  let cursor = cursors.get(system) ?? 0;
  let stopped = false;
  let handle: ReturnType<SystemRemote["events"]> | undefined;
  const follow = async () => {
    while (!stopped) {
      handle = system.events(cursor);
      try {
        for await (const envelope of handle) {
          if (envelope.kind === "domain") {
            cursor = Math.max(cursor, envelope.cursor);
            cursors.set(system, cursor);
          }
          const event = envelope.event as Partial<PublishedEvent>;
          if (typeof event.type !== "string") continue;
          for (const listener of listeners) listener(event as PublishedEvent);
        }
      } catch {
        // The stream reconnects from the last cursor it saw.
      }
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };
  void follow();
  return {
    listeners,
    stop: () => {
      stopped = true;
      handle?.dispose();
    },
  };
}

/**
 * Follow the published events while mounted. Every view shares one
 * stream; it closes once the last one unmounts.
 * @param system - the `system` Remote namespace.
 * @param listener - called with each event.
 */
export function usePublishedEvents(
  system: SystemRemote,
  listener: Listener,
): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    let stream = streams.get(system);
    if (!stream) {
      stream = open(system);
      streams.set(system, stream);
    }
    const own: Listener = (event) => latest.current(event);
    stream.listeners.add(own);
    return () => {
      stream.listeners.delete(own);
      if (stream.listeners.size === 0) {
        stream.stop();
        streams.delete(system);
      }
    };
  }, [system]);
}
