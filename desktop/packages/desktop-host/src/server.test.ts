import { afterEach, describe, expect, it } from "vitest";
import { createDesktopHost, type DesktopHostActions } from "./index.js";

const servers: Array<{ close(): void }> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()!.close();
});

describe("Desktop Host server", () => {
  it("new audio policy preserves exact controls while the legacy body remains explicitly absent", async () => {
    const values: unknown[] = [];
    const input = {
      jobId: crypto.randomUUID(),
      timelineId: crypto.randomUUID(),
      durationFrames: 75,
      profile: {
        width: 1080,
        height: 1920,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        audioSampleRate: 48000,
        channels: 2,
      },
      clips: [
        {
          mediaRef: crypto.randomUUID(),
          mimeType: "video/mp4",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          startFrame: 0,
          durationFrames: 75,
          sourceOffsetFrame: 0,
        },
      ],
    };
    const audio = {
      clipId: crypto.randomUUID(),
      mediaRef: crypto.randomUUID(),
      mimeType: "audio/wav",
      sha256: "b".repeat(64),
      sizeBytes: 200,
      kind: "dialogue",
      startFrame: 10,
      durationFrames: 50,
      sourceOffsetFrame: 5,
      volume: -0.8,
      fadeInFrames: 70,
      fadeOutFrames: 60,
      duckingGain: 0.4,
    };
    const mixed = {
      ...input,
      audioPlan: {
        format: "dramaip-render-audio",
        version: 1,
        policy: "saved-gains-reject-over-unity",
        videoEmbeddedAudio: "mix-if-present",
        clips: [audio],
      },
    };
    const host = createDesktopHost({
      accessToken: "audio-contract",
      capabilities: [],
      actions: {
        startTimelineRender: async (value: unknown) => {
          values.push(structuredClone(value));
          return { jobId: input.jobId, status: "queued" };
        },
      } as unknown as DesktopHostActions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const request = (body: unknown, authenticated = true) =>
      fetch(
        `http://${server.hostname}:${server.port}/host/v1/timeline-renders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authenticated
              ? { Authorization: "Bearer audio-contract" }
              : {}),
          },
          body: JSON.stringify(body),
        },
      );
    expect((await request(mixed, false)).status).toBe(401);
    expect(values).toHaveLength(0);
    expect((await request(input)).status).toBe(202);
    expect((await request(mixed)).status).toBe(202);
    expect(
      (
        await request({
          ...mixed,
          audioPlan: { ...mixed.audioPlan, clips: [] },
        })
      ).status,
    ).toBe(202);
    expect(values[0]).toEqual(input);
    expect(values[0]).not.toHaveProperty("audioPlan");
    expect(values[1]).toEqual(mixed);
    expect(values[2]).toEqual({
      ...mixed,
      audioPlan: { ...mixed.audioPlan, clips: [] },
    });
  });
  it("raw audio plans reject unknown policy, coercion, paths, unsupported MIME and unsafe frames without dispatch", async () => {
    let calls = 0;
    const video = {
      mediaRef: crypto.randomUUID(),
      mimeType: "video/mp4",
      sha256: "a".repeat(64),
      sizeBytes: 100,
      startFrame: 0,
      durationFrames: 75,
      sourceOffsetFrame: 0,
    };
    const audio = {
      clipId: crypto.randomUUID(),
      mediaRef: crypto.randomUUID(),
      mimeType: "audio/wav",
      sha256: "b".repeat(64),
      sizeBytes: 200,
      kind: "bgm",
      startFrame: 0,
      durationFrames: 75,
      sourceOffsetFrame: 0,
      volume: 0.8,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      duckingGain: 0.55,
    };
    const plan = {
      format: "dramaip-render-audio",
      version: 1,
      policy: "saved-gains-reject-over-unity",
      videoEmbeddedAudio: "mix-if-present",
      clips: [audio],
    };
    const input = {
      jobId: crypto.randomUUID(),
      timelineId: crypto.randomUUID(),
      durationFrames: 75,
      profile: {
        width: 1080,
        height: 1920,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        audioSampleRate: 48000,
        channels: 2,
      },
      clips: [video],
      audioPlan: plan,
    };
    const host = createDesktopHost({
      accessToken: "bad-audio",
      capabilities: [],
      actions: {
        startTimelineRender: async () => {
          calls++;
          throw Error("must not dispatch");
        },
      } as unknown as DesktopHostActions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const invalid = [
      null,
      {},
      { ...plan, version: 2 },
      { ...plan, version: "1" },
      { ...plan, policy: "silence-on-error" },
      { ...plan, outputPath: "/private" },
      ...[
        { volume: "0.8" },
        { duckingGain: null },
        { sizeBytes: "200" },
        { mimeType: "audio/unsupported" },
        { mediaRef: "../secret" },
        { sha256: undefined },
        { sourceOffsetFrame: Number.MAX_SAFE_INTEGER },
        { startFrame: 75 },
        { fadeInFrames: -1 },
        { path: "/private/voice.wav" },
      ].map((patch) => ({ ...plan, clips: [{ ...audio, ...patch }] })),
      { ...plan, clips: [audio, audio] },
      { ...plan, clips: [{ ...audio, kind: "video" }] },
      { ...plan, clips: [{ ...audio, mediaRef: video.mediaRef }] },
      {
        ...plan,
        clips: [{ ...audio, ...video, kind: "video", sourceOffsetFrame: 1 }],
      },
    ];
    for (const audioPlan of invalid) {
      const response = await fetch(
        `http://${server.hostname}:${server.port}/host/v1/timeline-renders`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer bad-audio",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...input, audioPlan }),
        },
      );
      expect(response.status, JSON.stringify(audioPlan)).toBe(400);
    }
    expect(calls).toBe(0);
  });
  it("timeline render requires authenticated exact opaque file identity and rejects extra paths or unbound bytes", async () => {
    let calls = 0;
    const input = {
      jobId: crypto.randomUUID(),
      timelineId: crypto.randomUUID(),
      durationFrames: 75,
      profile: {
        width: 1080,
        height: 1920,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        audioSampleRate: 48000,
        channels: 2,
      },
      clips: [
        {
          mediaRef: crypto.randomUUID(),
          mimeType: "video/mp4",
          sha256: "a".repeat(64),
          sizeBytes: 100,
          startFrame: 0,
          durationFrames: 75,
          sourceOffsetFrame: 0,
        },
      ],
    };
    const host = createDesktopHost({
      accessToken: "render-source-test",
      capabilities: [],
      actions: {
        startTimelineRender: async (value: unknown) => {
          calls++;
          expect(value).toEqual(input);
          return { jobId: input.jobId, status: "queued" };
        },
      } as unknown as DesktopHostActions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const request = (value: unknown, authenticated = true) =>
      fetch(
        `http://${server.hostname}:${server.port}/host/v1/timeline-renders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authenticated
              ? { Authorization: "Bearer render-source-test" }
              : {}),
          },
          body: JSON.stringify(value),
        },
      );
    expect((await request(input, false)).status).toBe(401);
    for (const patch of [
      { sha256: undefined },
      { sha256: "invalid" },
      { sizeBytes: "100" },
      { sizeBytes: 2 ** 31 + 1 },
      { mediaRef: "../secret" },
      { path: "/private/secret.mp4" },
      { mimeType: "video/webm" },
      { durationFrames: 76 },
      { sourceOffsetFrame: Number.MAX_SAFE_INTEGER },
    ])
      expect(
        (await request({ ...input, clips: [{ ...input.clips[0]!, ...patch }] }))
          .status,
      ).toBe(400);
    expect(
      (await request({ ...input, path: "/private/output.mp4" })).status,
    ).toBe(400);
    expect(calls).toBe(0);
    expect((await request(input)).status).toBe(202);
    expect(calls).toBe(1);
  });
  it("authenticates complete managed reads and rejects paths/extra keys/numeric strings without leaking Host errors", async () => {
    let calls = 0;
    const input = {
      mediaRef: crypto.randomUUID(),
      sha256: "a".repeat(64),
      sizeBytes: 4,
      mimeType: "audio/wav",
    };
    const host = createDesktopHost({
      accessToken: "managed-read-test",
      capabilities: [],
      actions: {
        readManagedMedia: async (value: unknown) => {
          expect(value).toEqual(input);
          calls++;
          if (calls === 2) throw new Error("/private/library.wav");
          return new Response(new Uint8Array([1, 2, 3, 4])).body!;
        },
      } as unknown as DesktopHostActions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const request = (body: unknown, authenticated = true) =>
      fetch(
        `http://${server.hostname}:${server.port}/host/v1/media-library/read`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authenticated
              ? { Authorization: "Bearer managed-read-test" }
              : {}),
          },
          body: JSON.stringify(body),
        },
      );
    expect((await request(input, false)).status).toBe(401);
    for (const invalid of [
      { ...input, mediaRef: "../secret" },
      { ...input, path: "/private/library.wav" },
      { ...input, mimeType: "text/html" },
      { ...input, sizeBytes: "4" },
    ])
      expect((await request(invalid)).status).toBe(400);
    expect(calls).toBe(0);
    const response = await request(input);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      1, 2, 3, 4,
    ]);
    const failed = await request(input);
    expect(failed.status).toBe(503);
    expect(failed.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await failed.text()).not.toContain("/private/");
  });
  it("authenticates ZIP saving, rejects invalid binary input and preserves cancel/opaque receipts", async () => {
    let calls = 0;
    const receipt = {
      saved: true,
      artifactRef: crypto.randomUUID(),
      sha256: "a".repeat(64),
      byteSize: 8,
      savedAt: new Date().toISOString(),
    };
    const actions = {
      saveBinaryFile: async (input: { contentBase64: string }) => {
        calls++;
        expect(
          Buffer.from(input.contentBase64, "base64")
            .subarray(0, 4)
            .toString("hex"),
        ).toBe("504b0304");
        return calls === 1 ? { saved: false } : receipt;
      },
    } as unknown as DesktopHostActions;
    const host = createDesktopHost({
      accessToken: "zip-save-test",
      capabilities: [],
      actions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const url = `http://${server.hostname}:${server.port}/host/v1/files/save-binary`;
    const input = {
      suggestedName: "pilot.zip",
      mimeType: "application/zip",
      contentBase64: Buffer.from("504b030401020304", "hex").toString("base64"),
    };
    const request = (value: unknown, authenticated = true) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authenticated ? { Authorization: "Bearer zip-save-test" } : {}),
        },
        body: JSON.stringify(value),
      });
    expect((await request(input, false)).status).toBe(401);
    for (const invalid of [
      { ...input, mimeType: "text/plain" },
      { ...input, suggestedName: "pilot.exe" },
      { ...input, contentBase64: "%%%=" },
      { ...input, contentBase64: "" },
      { ...input, contentBase64: "YWJjZA==" },
      { ...input, contentBase64: input.contentBase64.slice(0, -1) },
    ]) {
      expect((await request(invalid)).status).toBe(400);
    }
    expect(calls).toBe(0);
    expect(await (await request(input)).json()).toEqual({ saved: false });
    const result = await (await request(input)).json();
    expect(result).toEqual(receipt);
    expect(result).not.toHaveProperty("path");
    expect(calls).toBe(2);
    const unsupported = createDesktopHost({
      accessToken: "zip-save-test",
      capabilities: [],
      actions: {} as DesktopHostActions,
    });
    const other = await unsupported.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(other);
    expect(
      (
        await fetch(
          `http://${other.hostname}:${other.port}/host/v1/files/save-binary`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer zip-save-test",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(input),
          },
        )
      ).status,
    ).toBe(503);
  });
  it("waits for the listening handshake and returns the assigned port", async () => {
    const host = createDesktopHost({
      accessToken: "desktop-host-port-test",
      capabilities: [],
      actions: {} as DesktopHostActions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    expect(server.port).toBeGreaterThan(0);

    const response = await fetch(
      `http://${server.hostname}:${server.port}/host/v1/health`,
      {
        headers: { Authorization: "Bearer desktop-host-port-test" },
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ healthy: true });
  });

  it("returns normalized granted documents without exposing file paths", async () => {
    const actions = {
      readGrantedDocument: async () => ({
        name: "story.docx",
        format: "docx" as const,
        content: "## 第一章\n\n正文",
        size: 128,
      }),
    } as unknown as DesktopHostActions;
    const host = createDesktopHost({
      accessToken: "desktop-host-document-test",
      capabilities: [],
      actions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const response = await fetch(
      `http://${server.hostname}:${server.port}/host/v1/files/grants/grant-1/document`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer desktop-host-document-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ maximumBytes: 1024 }),
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      name: "story.docx",
      format: "docx",
      content: "## 第一章\n\n正文",
    });
    expect(JSON.stringify(body)).not.toContain("path");
  });

  it("keeps public search and webpage reading behind authenticated Host routes", async () => {
    const actions = {
      webSearch: async () => ({
        provider: "exa" as const,
        text: "[Result](https://example.com)",
        coverage: "test",
      }),
      readWebPage: async () => ({
        title: "Example",
        url: "https://example.com/",
        content: "safe text",
        contentType: "text/html",
        retrievedAt: "2026-08-29T00:00:00.000Z",
        truncated: false,
      }),
    } as unknown as DesktopHostActions;
    const host = createDesktopHost({
      accessToken: "desktop-host-web-test",
      capabilities: [],
      actions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    servers.push(server);
    const baseUrl = `http://${server.hostname}:${server.port}`;
    const headers = {
      Authorization: "Bearer desktop-host-web-test",
      "Content-Type": "application/json",
    };

    const search = await fetch(`${baseUrl}/host/v1/web/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "exa",
        query: "DramaIP",
        limit: 8,
        sessionId: "session-1",
      }),
    });
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({ provider: "exa" });

    const read = await fetch(`${baseUrl}/host/v1/web/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "https://example.com",
        maxCharacters: 20_000,
      }),
    });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ content: "safe text" });

    const privateScheme = await fetch(`${baseUrl}/host/v1/web/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: "http://127.0.0.1/private",
        maxCharacters: 20_000,
      }),
    });
    expect(privateScheme.status).toBe(400);
    const unauthorised = await fetch(`${baseUrl}/host/v1/web/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "exa",
        query: "DramaIP",
        limit: 8,
        sessionId: "session-1",
      }),
    });
    expect(unauthorised.status).toBe(401);
  });
});
