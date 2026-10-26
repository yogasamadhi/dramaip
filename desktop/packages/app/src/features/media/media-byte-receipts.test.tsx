import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createStudioClient, StudioClientError } from "@dramaip/client";
import {
  MediaByteVerificationSchema,
  type MediaByteVerification,
} from "@dramaip/contracts/media";
import {
  byteReceiptStorageKey,
  matchesByteReceipt,
  MediaByteReceiptView,
} from "./MediaByteReceipts";
const uuid = () => crypto.randomUUID();
const descriptor = {
  recordId: uuid(),
  projectId: uuid(),
  recordVersion: 3,
  kind: "audio",
  mimeType: "audio/wav",
  sizeBytes: 4,
  sha256: "a".repeat(64),
  origin: "managed-archive",
  artifactRef: uuid(),
  verification: "owner-metadata-only",
} as const;
const key = uuid();
function receipt(): MediaByteVerification {
  return {
    id: uuid(),
    version: 0,
    requestKey: key,
    descriptor,
    verifiedAt: "2026-10-07T00:00:00.000Z",
    evidence: "complete-byte-read-at-recorded-time",
    qualityState: "unverified",
    rightsState: "unverified",
    currentBinding: "unchanged-metadata",
  };
}
function client(respond: (request: Request) => Promise<Response>) {
  return createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: uuid(),
    runtimeGeneration: 1,
    fetch: (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
}

test("byte receipt SDK sends only one original POST with exact descriptor, UUID action key and frozen playback If-Match; it does not fetch bytes or infer proof", async () => {
  const calls: Request[] = [],
    value = receipt();
  const sdk = client(async (request) => {
    calls.push(request);
    return Response.json(value);
  });
  expect(await sdk.mediaPlayback.verifyBytes(descriptor, key)).toEqual(value);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("POST");
  expect(new URL(calls[0]!.url).pathname).toBe(
    `/api/v2/media-records/${descriptor.recordId}/byte-verifications`,
  );
  expect(calls[0]!.headers.get("Idempotency-Key")).toBe(key);
  expect(calls[0]!.headers.get("If-Match")).toBe(
    `"playback-3-${descriptor.sha256}"`,
  );
  expect(await calls[0]!.json()).toEqual({ descriptor });
});
test("byte receipt SDK rejects wrong request, owner, record, version, original hash, archive or private fields instead of attaching a different original receipt", async () => {
  const original = receipt();
  for (const value of [
    { ...original, requestKey: uuid() },
    { ...original, descriptor: { ...descriptor, projectId: uuid() } },
    { ...original, descriptor: { ...descriptor, recordId: uuid() } },
    { ...original, descriptor: { ...descriptor, recordVersion: 4 } },
    { ...original, descriptor: { ...descriptor, sha256: "b".repeat(64) } },
    { ...original, descriptor: { ...descriptor, artifactRef: uuid() } },
    { ...original, descriptor: { ...descriptor, path: "/PRIVATE/media.wav" } },
    { ...original, rightsState: "verified" },
  ]) {
    const sdk = client(async () => Response.json(value));
    await expect(
      sdk.mediaPlayback.verifyBytes(descriptor, key),
    ).rejects.toThrow();
  }
});
test("byte receipt original-ID GET and original-key recovery are strict, scoped and read-only; failures never fall back to a latest receipt", async () => {
  const calls: Request[] = [],
    value = receipt();
  const sdk = client(async (request) => {
    calls.push(request);
    return Response.json(value);
  });
  expect(
    await sdk.mediaPlayback.byteVerification(value.id, descriptor.projectId),
  ).toEqual(value);
  expect(
    await sdk.mediaPlayback.recoverByteVerification(
      descriptor.recordId,
      descriptor.projectId,
      key,
    ),
  ).toEqual(value);
  expect(calls.every((request) => request.method === "GET")).toBe(true);
  expect(new URL(calls[1]!.url).pathname).toBe(
    `/api/v2/media-records/${descriptor.recordId}/byte-verifications/requests/${key}`,
  );
  expect(new URL(calls[1]!.url).searchParams.get("projectId")).toBe(
    descriptor.projectId,
  );
  const wrong = client(async () =>
    Response.json({ ...value, id: uuid(), requestKey: uuid() }),
  );
  await expect(
    wrong.mediaPlayback.byteVerification(value.id, descriptor.projectId),
  ).rejects.toBeInstanceOf(StudioClientError);
  await expect(
    wrong.mediaPlayback.recoverByteVerification(
      descriptor.recordId,
      descriptor.projectId,
      key,
    ),
  ).rejects.toBeInstanceOf(StudioClientError);
  const absent = client(async () =>
    Response.json({ code: "NOT_FOUND", title: "Unavailable" }, { status: 404 }),
  );
  await expect(
    absent.mediaPlayback.recoverByteVerification(
      descriptor.recordId,
      descriptor.projectId,
      key,
    ),
  ).rejects.toBeInstanceOf(StudioClientError);
});
test("byte receipt pagination preserves the exact asset/project/version, cursor and unique history without exposing a foreign receipt or hidden prose", async () => {
  const value = {
    recordId: descriptor.recordId,
    projectId: descriptor.projectId,
    recordVersion: 3,
    items: [receipt()],
    nextCursor: uuid(),
  };
  const calls: Request[] = [];
  const sdk = client(async (request) => {
    calls.push(request);
    return Response.json(value);
  });
  expect(
    await sdk.mediaPlayback.byteVerifications(
      descriptor.recordId,
      descriptor.projectId,
      3,
      value.nextCursor,
    ),
  ).toEqual(value);
  expect(new URL(calls[0]!.url).searchParams.get("cursor")).toBe(
    value.nextCursor,
  );
  expect(new URL(calls[0]!.url).searchParams.get("recordVersion")).toBe("3");
  for (const invalid of [
    { ...value, recordId: uuid() },
    { ...value, recordVersion: 4 },
    { ...value, items: [value.items[0], value.items[0]] },
    {
      ...value,
      items: [
        { ...value.items[0], descriptor: { ...descriptor, projectId: uuid() } },
      ],
    },
    { ...value, path: "/PRIVATE" },
  ]) {
    const broken = client(async () => Response.json(invalid));
    await expect(
      broken.mediaPlayback.byteVerifications(
        descriptor.recordId,
        descriptor.projectId,
        3,
      ),
    ).rejects.toThrow();
  }
});
test("byte receipt views distinguish historical complete reads from unchanged metadata, changed metadata and unavailable reads without claiming current quality, authorization or delivery", () => {
  for (const currentBinding of [
    "unchanged-metadata",
    "changed-metadata",
    "unavailable",
  ] as const) {
    const html = renderToStaticMarkup(
      <MediaByteReceiptView items={[{ ...receipt(), currentBinding }]} />,
    );
    expect(html).toContain("只证明记录时间的一次完整读取");
    expect(html).toContain("不证明持续文件完整性、质量、授权、费用或交付通过");
    expect(html).toContain("不是本次完整清单核验或当前文件通过");
    expect(html).toContain(
      currentBinding === "unchanged-metadata"
        ? "实际文件字节未重新读取"
        : currentBinding === "changed-metadata"
          ? "仅保留原读取历史"
          : "不使用缓存补成有效来源",
    );
  }
});
test("byte receipt recovery storage and association are keyed by original project, asset, version, opaque archive and hash; malformed origin never becomes complete proof", () => {
  const value = receipt();
  expect(matchesByteReceipt(value, descriptor, key)).toBe(true);
  for (const changed of [
    { ...descriptor, projectId: uuid() },
    { ...descriptor, recordId: uuid() },
    { ...descriptor, recordVersion: 4 },
    { ...descriptor, artifactRef: uuid() },
    { ...descriptor, sha256: "b".repeat(64) },
  ]) {
    expect(byteReceiptStorageKey(changed)).not.toBe(
      byteReceiptStorageKey(descriptor),
    );
    expect(matchesByteReceipt(value, changed, key)).toBe(false);
  }
  expect(matchesByteReceipt(value, descriptor, uuid())).toBe(false);
  expect(
    MediaByteVerificationSchema.safeParse({
      ...value,
      descriptor: { ...descriptor, origin: "embedded" },
    }).success,
  ).toBe(false);
  expect(
    MediaByteVerificationSchema.safeParse({
      ...value,
      descriptor: { ...descriptor, artifactRef: undefined },
    }).success,
  ).toBe(false);
});
