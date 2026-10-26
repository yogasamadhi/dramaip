import { expect, test } from "vitest";
import { createStudioClient, StudioClientError } from "@dramaip/client";
const id = "10000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000002";
const descriptor = {
  recordId: id,
  projectId,
  recordVersion: 4,
  kind: "audio",
  mimeType: "audio/wav",
  sizeBytes: 4,
  sha256: "a".repeat(64),
  origin: "managed-archive",
  artifactRef: "10000000-0000-4000-8000-000000000003",
  verification: "owner-metadata-only",
} as const;
function client(respond: (request: Request) => Promise<Response>) {
  return createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: id,
    runtimeGeneration: 1,
    fetch: (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
}
const response = (
  bytes = new Uint8Array([1, 2, 3, 4]),
  headers?: Record<string, string>,
) =>
  new Response(bytes, {
    headers: { "Content-Type": "audio/wav", "Content-Length": "4", ...headers },
  });
test("SDK 只返回完整 Blob 与 owner 元数据，携带项目／精确版本／If-Match，不返回原始读取 URL", async () => {
  const calls: Request[] = [];
  const sdk = client(async (request) => {
    calls.push(request);
    return new URL(request.url).pathname.endsWith("/content")
      ? response()
      : Response.json(descriptor);
  });
  const result = await sdk.mediaPlayback.open(id, projectId, 4);
  expect(result.descriptor).toEqual(descriptor);
  expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([
    1, 2, 3, 4,
  ]);
  expect(Object.keys(result)).toEqual(["descriptor", "blob"]);
  expect(result.blob.type).toBe("audio/wav");
  expect(calls).toHaveLength(2);
  const url = new URL(calls[1]!.url);
  expect(url.searchParams.get("projectId")).toBe(projectId);
  expect(url.searchParams.get("recordVersion")).toBe("4");
  expect(url.searchParams.get("sha256")).toBe(descriptor.sha256);
  expect(calls[1]!.headers.get("If-Match")).toBe(
    `"playback-4-${descriptor.sha256}"`,
  );
});
test("错误身份、意外公开路径或不完整字节无法产生 Blob", async () => {
  for (const invalid of [
    { ...descriptor, projectId: id },
    { ...descriptor, recordVersion: 5 },
    { ...descriptor, path: "/private/library.wav" },
  ]) {
    let calls = 0;
    const sdk = client(async () => {
      calls++;
      return Response.json(invalid);
    });
    await expect(
      sdk.mediaPlayback.open(id, projectId, 4),
    ).rejects.toBeInstanceOf(StudioClientError);
    expect(calls).toBe(1);
  }
  for (const wrong of [
    response(new Uint8Array([1, 2])),
    response(new Uint8Array([1, 2, 3, 4, 5])),
    response(undefined, { "Content-Type": "text/html" }),
    response(undefined, { "Content-Length": "5" }),
  ]) {
    const sdk = client(async (request) =>
      request.url.includes("/content?") ? wrong : Response.json(descriptor),
    );
    await expect(sdk.mediaPlayback.open(id, projectId, 4)).rejects.toThrow(
      "未完成或已变化",
    );
  }
});
test("错误流、取消和 RFC 7807 失败不会伪造成成功载入", async () => {
  let cancel = 0;
  const abort = new AbortController();
  const sdk = client(async (request) =>
    request.url.includes("/content?")
      ? new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array([1]));
              abort.abort();
            },
            cancel() {
              cancel++;
            },
          }),
          { headers: { "Content-Type": "audio/wav", "Content-Length": "4" } },
        )
      : Response.json(descriptor),
  );
  await expect(
    sdk.mediaPlayback.open(id, projectId, 4, abort.signal),
  ).rejects.toThrow();
  expect(cancel).toBe(1);
  const broken = client(async (request) =>
    request.url.includes("/content?")
      ? new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("private details"));
            },
          }),
          { headers: { "Content-Type": "audio/wav", "Content-Length": "4" } },
        )
      : Response.json(descriptor),
  );
  await expect(broken.mediaPlayback.open(id, projectId, 4)).rejects.toThrow(
    "未完成或已变化",
  );
  const refused = client(async () =>
    Response.json(
      {
        type: "about:blank",
        title: "存档版本已变化",
        status: 412,
        code: "CONFLICT",
        traceId: "trace-playback",
      },
      { status: 412, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
  const error = await refused.mediaPlayback
    .open(id, projectId, 4)
    .catch((error: StudioClientError) => error);
  expect(error).toMatchObject({
    status: 412,
    body: { requestId: "trace-playback" },
  });
});
test("完整 Blob 播放上限在请求字节前拒绝，仍可只读大文件存档元数据", async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return Response.json({ ...descriptor, sizeBytes: 128 * 1024 * 1024 + 1 });
  });
  expect((await sdk.mediaPlayback.describe(id, projectId, 4)).sizeBytes).toBe(
    128 * 1024 * 1024 + 1,
  );
  await expect(sdk.mediaPlayback.open(id, projectId, 4)).rejects.toThrow(
    "最多 128 MiB",
  );
  expect(calls).toBe(2);
});
