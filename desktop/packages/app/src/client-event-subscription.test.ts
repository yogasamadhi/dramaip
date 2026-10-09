import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
import type { EventStreamEnvelope } from "@dramaip/contracts";

function event(cursor: number): EventStreamEnvelope {
  return {
    kind: "domain",
    cursor,
    event: {
      cursor,
      eventId: `10000000-0000-4000-8000-${String(cursor).padStart(12, "0")}`,
      type: "automation.creation-updated.v1",
      pluginId: "automation",
      aggregateType: "creation",
      aggregateId: "actual-workflow",
      aggregateVersion: cursor,
      payload: { id: "actual-workflow" },
      occurredAt: "2026-10-02T00:00:00.000Z",
    },
  };
}

function fixture() {
  const requests: Request[] = [];
  const streams: Array<{
    cursor: number;
    signal: AbortSignal;
    controller: ReadableStreamDefaultController<Uint8Array>;
  }> = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: "10000000-0000-4000-8000-000000000001",
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      // Model the finite browser connection pool, not a business response.
      expect(
        streams.filter((stream) => !stream.signal.aborted).length,
      ).toBeLessThan(6);
      requests.push(new Request(input, init));
      return Response.json({ ok: true });
    },
    openEventStream: async (cursor, signal) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push({ cursor, signal, controller });
            signal.addEventListener(
              "abort",
              () =>
                controller.error(new DOMException("Disposed", "AbortError")),
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  });
  const emit = (index: number, value: EventStreamEnvelope) =>
    streams[index]!.controller.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`),
    );
  return { sdk, streams, emit, requests };
}

async function eventually(assertion: () => void) {
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await Bun.sleep(5);
    }
  }
}

test("one SDK shares a single cancellable event stream across eight task cards, leaving ordinary requests available", async () => {
  const { sdk, streams, emit, requests } = fixture();
  const received = Array.from({ length: 8 }, () => [] as number[]);
  const dispose = received.map((values) =>
    sdk.events.subscribe((value) => {
      if ("cursor" in value) values.push(value.cursor);
    }),
  );
  try {
    expect(streams).toHaveLength(1);
    await sdk.changePreviews.commit(
      "10000000-0000-4000-8000-000000000002",
      "explicit-adoption-key",
    );
    expect(
      requests.map((request) => [
        request.method,
        new URL(request.url).pathname,
      ]),
    ).toEqual([
      [
        "POST",
        "/api/v2/change-previews/10000000-0000-4000-8000-000000000002/commit",
      ],
    ]);
    expect(requests[0]!.headers.get("Idempotency-Key")).toBe(
      "explicit-adoption-key",
    );
    emit(0, event(1));
    emit(0, event(1));
    await eventually(() =>
      expect(received.map((values) => [...values])).toEqual(
        received.map(() => [1]),
      ),
    );
    dispose[0]!();
    expect(streams[0]!.signal.aborted).toBe(false);
    emit(0, event(2));
    await eventually(() => expect(received[1]).toEqual([1, 2]));
    expect(received[0]).toEqual([1]);
  } finally {
    dispose.forEach((stop) => stop());
  }
  expect(streams[0]!.signal.aborted).toBe(true);
});

test("shared events reconnect from the actual domain cursor, deduplicate replay and exclude listeners that left", async () => {
  const { sdk, streams, emit } = fixture();
  const first: number[] = [],
    second: number[] = [];
  const stopFirst = sdk.events.subscribe((value) => {
    if ("cursor" in value) first.push(value.cursor);
  });
  let stopSecond: (() => void) | undefined;
  try {
    emit(0, event(7));
    await eventually(() => expect(first).toEqual([7]));
    stopSecond = sdk.events.subscribe((value) => {
      if ("cursor" in value) second.push(value.cursor);
    });
    expect(streams).toHaveLength(1);
    streams[0]!.controller.close();
    await eventually(() => expect(streams).toHaveLength(2));
    expect(streams[1]!.cursor).toBe(7);
    emit(1, event(7));
    emit(1, event(8));
    await eventually(() => expect(second).toEqual([8]));
    expect(first).toEqual([7, 8]);
    stopFirst();
    emit(1, event(9));
    await eventually(() => expect(second).toEqual([8, 9]));
    expect(first).toEqual([7, 8]);
  } finally {
    stopFirst();
    stopSecond?.();
  }
  expect(streams[1]!.signal.aborted).toBe(true);
});

test("all-listener disposal cancels backoff; fresh subscriptions and distinct SDKs have independent replay lifetimes", async () => {
  const a = fixture(),
    b = fixture();
  const callback = () => undefined;
  const stopA = a.sdk.events.subscribe(callback);
  const stopDuplicate = a.sdk.events.subscribe(callback);
  const stopB = b.sdk.events.subscribe(callback);
  expect(a.streams).toHaveLength(1);
  expect(b.streams).toHaveLength(1);
  a.streams[0]!.controller.close();
  await Bun.sleep(10);
  stopA();
  expect(a.streams[0]!.signal.aborted).toBe(false);
  stopDuplicate();
  stopDuplicate();
  expect(a.streams[0]!.signal.aborted).toBe(true);
  expect(b.streams[0]!.signal.aborted).toBe(false);
  await Bun.sleep(650);
  expect(a.streams).toHaveLength(1);
  const stopFresh = a.sdk.events.subscribe(callback);
  expect(a.streams).toHaveLength(2);
  expect(a.streams[1]!.cursor).toBe(0);
  stopFresh();
  stopB();
  expect(a.streams[1]!.signal.aborted).toBe(true);
  expect(b.streams[0]!.signal.aborted).toBe(true);
});

test("listener failure or synchronous disposal cannot tear down the stream or starve other task cards", async () => {
  const { sdk, streams, emit } = fixture();
  const reported: unknown[] = [],
    received: number[] = [];
  const priorReportError = globalThis.reportError;
  globalThis.reportError = (error: unknown) => reported.push(error);
  const failure = new Error("controlled subscriber failure");
  const stopBad = sdk.events.subscribe(() => {
    throw failure;
  });
  let stopRemoved: (() => void) | undefined;
  const stopRemoving = sdk.events.subscribe(() => stopRemoved?.());
  stopRemoved = sdk.events.subscribe(() => {
    throw new Error("disposed listener must not run");
  });
  const stopGood = sdk.events.subscribe((value) => {
    if ("cursor" in value) received.push(value.cursor);
  });
  try {
    emit(0, event(1));
    emit(0, event(2));
    await eventually(() => expect(received).toEqual([1, 2]));
    expect(reported).toEqual([failure, failure]);
    expect(streams).toHaveLength(1);
  } finally {
    stopBad();
    stopRemoving();
    stopRemoved();
    stopGood();
    globalThis.reportError = priorReportError;
  }
  expect(streams[0]!.signal.aborted).toBe(true);
});
