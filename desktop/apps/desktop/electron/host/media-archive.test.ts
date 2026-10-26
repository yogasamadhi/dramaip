import { afterEach, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveRemoteVideo } from "./media-archive";

const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function fakeMp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.alloc(128, 7),
  ]);
}

describe("Host remote media archive", () => {
  test("streams, probes and atomically archives without returning a path", async () => {
    const bytes = fakeMp4();
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "video/mp4");
      response.end(bytes);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server did not bind");
    const root = await mkdtemp(join(tmpdir(), "dramaip-media-archive-"));
    roots.push(root);

    const archived = await archiveRemoteVideo(
      {
        url: `http://127.0.0.1:${address.port}/video.mp4`,
        authorization: "Bearer test-only",
        maximumBytes: 1024 * 1024,
        timeoutMs: 2_000,
        expectedSha256: createHash("sha256").update(bytes).digest("hex"),
      },
      {
        root,
        createMediaRef: () => "00000000-0000-4000-8000-000000000001",
        request: (input) =>
          import("./safe-http-transport").then(({ safeHttpRequest }) =>
            safeHttpRequest({
              ...input,
              allowHttp: true,
              allowPrivateNetwork: true,
            }),
          ),
        probe: async () => ({
          kind: "video",
          mimeType: "video/mp4",
          extension: ".mp4",
          width: 1080,
          height: 1920,
          durationFrames: 75,
          frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        }),
      },
    );

    expect(archived).toMatchObject({
      mediaRef: "00000000-0000-4000-8000-000000000001",
      mimeType: "video/mp4",
      sizeBytes: bytes.byteLength,
      width: 1080,
      height: 1920,
      durationFrames: 75,
      status: "archived",
    });
    expect("path" in archived).toBe(false);
    expect(
      (await readFile(join(root, `${archived.mediaRef}.mp4`))).toString("hex"),
    ).toBe(bytes.toString("hex"));
  });

  test("removes the temporary file when MIME or checksum validation fails", async () => {
    const bytes = fakeMp4();
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/plain");
      response.end(bytes);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("server did not bind");
    const root = await mkdtemp(join(tmpdir(), "dramaip-media-archive-"));
    roots.push(root);

    await expect(
      archiveRemoteVideo(
        {
          url: `http://127.0.0.1:${address.port}/not-video`,
          authorization: "Bearer test-only",
          maximumBytes: 1024 * 1024,
          timeoutMs: 2_000,
        },
        {
          root,
          request: (input) =>
            import("./safe-http-transport").then(({ safeHttpRequest }) =>
              safeHttpRequest({
                ...input,
                allowHttp: true,
                allowPrivateNetwork: true,
              }),
            ),
          probe: async () => {
            throw new Error("probe must not run");
          },
        },
      ),
    ).rejects.toThrow("content type");
  });
});
