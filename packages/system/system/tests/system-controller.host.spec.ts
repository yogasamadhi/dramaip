import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { remoteErrorOf, remoteMethods } from "@dramaip/infra-typert-protocol";
import SystemController from "../src/index.ts";
import type { SystemEventEnvelope } from "../src/types.ts";

interface DomainEvent {
  cursor: number;
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

interface RealtimeEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

/** The slice of the domain event runtime the controller reads, in memory. */
class MemoryEvents {
  readonly log: DomainEvent[] = [];
  readonly replayLimits: number[] = [];
  private readonly domain = new Set<(event: DomainEvent) => void>();
  private readonly live = new Set<(event: RealtimeEvent) => void>();

  append(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const event: DomainEvent = {
        cursor: this.log.length + 1,
        id: `event-${this.log.length + 1}`,
        type: "workspace.project-created",
        payload: { n: this.log.length + 1 },
        occurredAt: "2026-10-28T00:00:00.000Z",
      };
      this.log.push(event);
      for (const listener of this.domain) listener(event);
    }
  }

  publishLive(type: string): void {
    const event = {
      id: `live-${type}`,
      type,
      payload: {},
      occurredAt: "2026-10-28T00:00:00.000Z",
    };
    for (const listener of this.live) listener(event);
  }

  get listeners(): number {
    return this.domain.size + this.live.size;
  }

  subscribeDomain(listener: (event: DomainEvent) => void): () => void {
    this.domain.add(listener);
    return () => this.domain.delete(listener);
  }

  subscribeLive(listener: (event: RealtimeEvent) => void): () => void {
    this.live.add(listener);
    return () => this.live.delete(listener);
  }

  replay(afterCursor: number, limit = 500): DomainEvent[] {
    this.replayLimits.push(limit);
    return this.log
      .filter((event) => event.cursor > afterCursor)
      .slice(0, limit);
  }

  diagnostics(): unknown[] {
    return [{ id: "consumer", checkpoint: this.log.length }];
  }
}

async function boot(host?: Record<string, unknown>) {
  const ctx = new Context();
  const events = new MemoryEvents();
  ctx.provide("compatRuntime", {
    runtimeId: "runtime-1",
    startedAt: "2026-10-28T00:00:00.000Z",
    profile: "desktop",
    graphRevision: "graph-1",
    plugins: () => [
      { id: "system", status: "active", version: "1.0.0", kind: "core" },
    ],
    ui: { contributions: () => [] },
  });
  ctx.provide("domainEvents", events);
  ctx.provide("diagnostics", () => ({
    services: [
      {
        id: "storage",
        databasePath: "/Users/someone/Library/dramaip.sqlite",
        note: "apiKey=sk-leaked Bearer abc.def",
      },
    ],
  }));
  ctx.provide("relationalStorage", {
    applied: () => [],
    declarations: () => [],
  });
  if (host) ctx.provide("desktopHost", host);
  await ctx.plugin(SystemController);
  return { controller: ctx.systemController, events };
}

/** Read `count` frames, then end the subscription. */
async function take(
  stream: AsyncIterable<SystemEventEnvelope>,
  count: number,
  between?: (index: number) => void,
): Promise<SystemEventEnvelope[]> {
  const frames: SystemEventEnvelope[] = [];
  const iterator = stream[Symbol.asyncIterator]();
  while (frames.length < count) {
    between?.(frames.length);
    const next = await iterator.next();
    if (next.done) break;
    frames.push(next.value);
  }
  await iterator.return?.();
  return frames;
}

const cursors = (frames: SystemEventEnvelope[]) =>
  frames.map((frame) => (frame.kind === "domain" ? frame.cursor : frame.kind));

describe("the system Remote namespace", () => {
  it("publishes every replaced system operation under one namespace", async () => {
    const { controller } = await boot();
    expect(controller.typertRemote.namespace).toBe("system");
    expect(remoteMethods(controller).map(({ method }) => method)).toEqual([
      "health",
      "version",
      "capabilities",
      "runtime",
      "diagnostics",
      "events",
      "pickFiles",
      "saveTextFile",
      "openExternal",
      "revealGrant",
      "revealArtifact",
      "credentialStatus",
      "createCredentialUnlockSession",
      "createCredentialCaptureSession",
      "credentialSession",
      "removeCredential",
      "setWindowTheme",
      "localModelRuntimes",
      "activateLocalModelRuntime",
      "deactivateLocalModelRuntime",
      "localModels",
      "checkLocalModelRuntime",
    ]);
  });

  it("reports health, versions and the server capability set without a Host", async () => {
    const { controller } = await boot();
    expect(controller.health()).toMatchObject({ healthy: true });
    expect(controller.version()).toHaveProperty("pluginApiVersion");
    expect(controller.capabilities()).toEqual({
      desktopHost: false,
      fileGrant: false,
      credentials: false,
      localEngines: false,
    });
    const runtime = await controller.runtime();
    expect(runtime).toMatchObject({
      runtimeId: "runtime-1",
      mode: "server",
      plugins: [{ id: "system", status: "active" }],
    });
  });

  it("redacts paths and secrets from diagnostics", async () => {
    const { controller } = await boot();
    const report = await controller.diagnostics();
    const text = JSON.stringify(report);
    expect(report.traceId).toEqual(expect.any(String));
    expect(text).not.toContain("/Users/someone");
    expect(text).not.toContain("sk-leaked");
    expect(text).not.toContain("abc.def");
    expect(report).toMatchObject({
      host: { healthy: false, unavailable: "server" },
    });
  });

  it("names the missing Host instead of failing opaquely", async () => {
    const { controller } = await boot();
    for (const call of [
      () => controller.pickFiles({}),
      () => controller.credentialStatus(),
      () => controller.openExternal("https://example.com"),
      () => controller.localModelRuntimes(),
    ]) {
      const failure = await call().catch((error: unknown) => error);
      expect(remoteErrorOf(failure)).toMatchObject({
        code: "system/host-unavailable",
      });
    }
  });

  it("forwards Host actions and reports only the credential reference", async () => {
    const { controller } = await boot({
      pickFiles: async () => [
        {
          grantId: "grant-1",
          kind: "file",
          displayName: "draft.md",
          expiresAt: "2026-10-29T00:00:00.000Z",
          generation: 1,
        },
      ],
      credentialStorageStatus: async () => ({
        available: true,
        storage: "os_safe_storage",
        backend: "keychain",
        locked: false,
        migrationState: "none",
      }),
      credentialCaptureStatus: async (id: string) => ({
        captureSessionId: id,
        status: "completed",
        credentialRef: "credential:openai",
        expiresAt: "2026-10-29T00:00:00.000Z",
      }),
      health: async () => ({ healthy: true }),
    });
    expect(controller.capabilities()).toMatchObject({ desktopHost: true });
    expect(await controller.pickFiles({ multiple: false })).toHaveLength(1);
    expect(await controller.credentialStatus()).toMatchObject({
      available: true,
    });
    expect(await controller.credentialSession("capture-1")).toEqual({
      captureSessionId: "capture-1",
      status: "completed",
      credentialRef: "credential:openai",
      expiresAt: "2026-10-29T00:00:00.000Z",
    });
  });
});

describe("the system event stream", () => {
  const signal = () => new AbortController().signal;

  it("replays the whole log from cursor 0 as a baseline, page by page", async () => {
    const { controller, events } = await boot();
    events.append(1_203);
    const frames = await take(controller.events(0, signal()), 1_203);
    expect(cursors(frames)).toEqual(
      Array.from({ length: 1_203 }, (_, index) => index + 1),
    );
    expect(events.replayLimits.every((limit) => limit === 500)).toBe(true);
  });

  it("replays only what follows the given cursor, then streams new events", async () => {
    const { controller, events } = await boot();
    events.append(3);
    const frames = await take(controller.events(2, signal()), 3, (index) => {
      if (index === 1) {
        events.append(1);
        events.publishLive("agent.progress");
      }
    });
    expect(cursors(frames)).toEqual([3, 4, "realtime"]);
  });

  it("resumes from the last cursor seen after a reconnect, without duplicates", async () => {
    const { controller, events } = await boot();
    events.append(2);
    const first = await take(controller.events(0, signal()), 2);
    expect(events.listeners).toBe(0);
    events.append(2);
    const last = first.at(-1);
    const resumeAt = last?.kind === "domain" ? last.cursor : 0;
    const second = await take(controller.events(resumeAt, signal()), 2);
    expect(cursors(second)).toEqual([3, 4]);
  });

  it("ends with one overflow event when the subscriber falls too far behind", async () => {
    const { controller, events } = await boot();
    const iterator = controller.events(0, signal())[Symbol.asyncIterator]();
    const pending = iterator.next();
    events.publishLive("first");
    await pending;
    for (let index = 0; index < 1_001; index += 1) events.publishLive("flood");
    const rest: SystemEventEnvelope[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      rest.push(next.value);
    }
    // The queued backlog is dropped: the subscriber replays it on reconnect.
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({
      kind: "realtime",
      event: { type: "system.stream-overflow", payload: { reconnect: true } },
    });
    expect(events.listeners).toBe(0);
  });

  it("stops and unsubscribes when the caller aborts", async () => {
    const { controller, events } = await boot();
    const abort = new AbortController();
    const iterator = controller.events(0, abort.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    abort.abort();
    expect(await pending).toMatchObject({ done: true });
    expect(events.listeners).toBe(0);
  });

  it("rejects a cursor that is not a non-negative integer", async () => {
    const { controller } = await boot();
    const failure = await take(controller.events(-1, signal()), 1).catch(
      (error: unknown) => error,
    );
    expect(remoteErrorOf(failure)).toMatchObject({
      code: "gateway/bad-request",
    });
  });
});
