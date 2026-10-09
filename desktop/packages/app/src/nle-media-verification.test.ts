import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { StudioClient } from "@dramaip/client";
import type { MediaPlaybackDescriptor } from "@dramaip/contracts/media";
import type { TimelineDeliveryManifest } from "@dramaip/contracts/timeline";
import { verifyNleDeliveryMedia } from "./nle-media-verification";

function fixture() {
  const assetId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const clipId = crypto.randomUUID();
  const artifactRef = crypto.randomUUID();
  const blob = new Blob(["actual controlled bytes"], { type: "video/mp4" });
  const sha256 = createHash("sha256")
    .update("actual controlled bytes")
    .digest("hex");
  const value: TimelineDeliveryManifest = {
    format: "dramaip-timeline-delivery",
    schemaVersion: 3,
    sourceFingerprint: "a".repeat(64),
    timeline: {
      format: "dramaip-timeline",
      schemaVersion: 2,
      id: crypto.randomUUID(),
      projectId,
      adaptationId: crypto.randomUUID(),
      episodeId: crypto.randomUUID(),
      sourceFingerprint: "original",
      profile: {
        width: 1080,
        height: 1920,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
        audioSampleRate: 48000,
        channels: 2,
      },
      timebase: "frames",
      durationFrames: 25,
      migrationWarnings: [],
      tracks: [],
      version: 2,
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    },
    media: [
      {
        assetId,
        title: "Actual source",
        clipIds: [clipId],
        expectedVersions: [4],
        sourceVersion: 4,
        sourceStatus: "current",
        relativePath: `media/${assetId}.mp4`,
        checksum: sha256,
        mediaStatus: "unattached",
        rightsStatus: "unknown",
        rightsDeclaration: "user-reported-cleared",
        lineage: [assetId],
        archive: {
          artifactRef,
          kind: "video",
          mimeType: "video/mp4",
          extension: ".mp4",
          sizeBytes: blob.size,
          sha256,
          verification: "owner-metadata-only",
        },
      },
    ],
    sourceBlockers: [],
    unsupportedFeatures: ["media-package-copy"],
    warnings: [],
  };
  const descriptor: MediaPlaybackDescriptor = {
    recordId: assetId,
    projectId,
    recordVersion: 4,
    kind: "video",
    mimeType: "video/mp4",
    sizeBytes: blob.size,
    sha256,
    origin: "managed-archive",
    artifactRef,
    verification: "owner-metadata-only",
  };
  let reads = 0;
  let snapshots = 0;
  const client = {
    timeline: {
      deliveryManifest: async () => {
        snapshots++;
        return structuredClone(value);
      },
    },
    mediaPlayback: {
      open: async (id: string, project: string, version: number) => {
        expect([id, project, version]).toEqual([assetId, projectId, 4]);
        reads++;
        return { descriptor, blob };
      },
    },
  } as unknown as StudioClient;
  return {
    value,
    descriptor,
    blob,
    client,
    counts: () => ({ reads, snapshots }),
  };
}
test("NLE verification uses the original exact owner archive/version and hashes complete bytes without changing the manifest", async () => {
  const data = fixture();
  const before = structuredClone(data.value);
  const progress: number[] = [];
  const result = await verifyNleDeliveryMedia(
    data.value,
    data.client,
    new AbortController().signal,
    (count) => progress.push(count),
  );
  expect(result[0]).toMatchObject({
    assetId: data.value.media[0]!.assetId,
    status: "verified",
    sha256: data.descriptor.sha256,
    sizeBytes: data.blob.size,
  });
  expect(data.counts()).toEqual({ reads: 1, snapshots: 2 });
  expect(progress).toEqual([1]);
  expect(data.value).toEqual(before);
  expect(result[0]).not.toHaveProperty("rightsStatus");
});
for (const mode of [
  "bytes",
  "artifact",
  "project",
  "version",
  "embedded",
  "mime",
] as const) {
  test(`NLE verification refuses ${mode} mismatches without fallback or automatic retries`, async () => {
    const data = fixture();
    if (mode === "bytes")
      data.client.mediaPlayback.open = async () => ({
        descriptor: data.descriptor,
        blob: new Blob(["xxxxx controlled bytes"], { type: "video/mp4" }),
      });
    if (mode === "artifact") data.descriptor.artifactRef = crypto.randomUUID();
    if (mode === "project") data.descriptor.projectId = crypto.randomUUID();
    if (mode === "version") data.descriptor.recordVersion++;
    if (mode === "embedded") data.descriptor.origin = "embedded";
    if (mode === "mime") data.descriptor.mimeType = "audio/wav";
    const result = await verifyNleDeliveryMedia(
      data.value,
      data.client,
      new AbortController().signal,
    );
    expect(result[0]!.status).toBe("unavailable");
    expect(result[0]).not.toHaveProperty("sha256");
    expect(data.counts().reads).toBeLessThanOrEqual(1);
  });
}
test("NLE verification does not read placeholder/legacy sources or treat user rights declarations as proof", async () => {
  const data = fixture();
  const item = data.value.media[0]!;
  delete item.archive;
  delete item.checksum;
  delete item.sourceVersion;
  item.sourceStatus = "unverified";
  item.relativePath = `media/${item.assetId}`;
  const result = await verifyNleDeliveryMedia(
    data.value,
    data.client,
    new AbortController().signal,
  );
  expect(result[0]!.status).toBe("unavailable");
  expect(data.counts()).toEqual({ reads: 0, snapshots: 2 });
});
test("NLE verification rejects changed scope/contents before reading and after reading, even with the same claimed fingerprint", async () => {
  for (const before of [true, false]) {
    const data = fixture();
    let count = 0;
    data.client.timeline.deliveryManifest = async () => {
      const output = structuredClone(data.value);
      if (++count === (before ? 1 : 2))
        output.timeline.projectId = crypto.randomUUID();
      return output;
    };
    await expect(
      verifyNleDeliveryMedia(
        data.value,
        data.client,
        new AbortController().signal,
      ),
    ).rejects.toThrow("已变化");
    expect(data.counts().reads).toBe(before ? 0 : 1);
  }
});
test("NLE verification preserves abort before and after an unabortable snapshot or a late media reply", async () => {
  for (const stage of ["before", "snapshot", "media"]) {
    const data = fixture();
    const controller = new AbortController();
    if (stage === "before") controller.abort();
    if (stage === "snapshot")
      data.client.timeline.deliveryManifest = async () => {
        controller.abort();
        return data.value;
      };
    if (stage === "media")
      data.client.mediaPlayback.open = async () => {
        controller.abort();
        return { descriptor: data.descriptor, blob: data.blob };
      };
    await expect(
      verifyNleDeliveryMedia(data.value, data.client, controller.signal),
    ).rejects.toThrow();
  }
});
test("NLE verification bounds work and refuses duplicate identities or forged metadata before any read", async () => {
  for (const mode of [
    "duplicate",
    "checksum",
    "path",
    "too-large",
    "too-many",
  ]) {
    const data = fixture();
    const item = data.value.media[0]!;
    if (mode === "duplicate") data.value.media.push(structuredClone(item));
    if (mode === "checksum") item.checksum = "b".repeat(64);
    if (mode === "path") item.relativePath = `media/${item.assetId}.wav`;
    if (mode === "too-large") item.archive!.sizeBytes = 129 * 1024 * 1024;
    if (mode === "too-many")
      data.value.media = Array.from({ length: 51 }, () => {
        const copy = structuredClone(item);
        copy.assetId = crypto.randomUUID();
        copy.relativePath = `media/${copy.assetId}.mp4`;
        return copy;
      });
    await expect(
      verifyNleDeliveryMedia(
        data.value,
        data.client,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(data.counts()).toEqual({ reads: 0, snapshots: 0 });
  }
});
