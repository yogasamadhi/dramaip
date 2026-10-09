import { describe, expect, it } from "bun:test";
import type { StudioClient } from "@dramaip/client";
import type { MediaRecord } from "@dramaip/contracts/media";
import { readAssetPreviewRecord } from "./asset-preview-record";

const record: MediaRecord = {
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  kind: "visual-assets",
  domain: "visual-assets",
  title: "实际记录",
  version: 7,
  payload: { 资产版本: "展示标签 v999，不是实际版本" },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const clientReading = (
  read: (id: string, signal?: AbortSignal) => Promise<MediaRecord>,
) => ({ mediaSources: { record: read } }) as Pick<StudioClient, "mediaSources">;

describe("asset center explicit actual record recheck", () => {
  it("reads only the requested owner identity and actual version, forwarding cancellation", async () => {
    const controller = new AbortController();
    const calls: unknown[] = [];
    const client = clientReading(async (id, signal) => {
      calls.push([id, signal]);
      return record;
    });
    expect(
      await readAssetPreviewRecord(
        client,
        record.id,
        record.projectId,
        controller.signal,
      ),
    ).toEqual({ projectId: record.projectId, version: 7 });
    expect(calls).toEqual([[record.id, controller.signal]]);
  });
  it("rejects wrong IDs, projects, malformed versions and owner records without a fallback", async () => {
    for (const value of [
      { ...record, id: crypto.randomUUID() },
      { ...record, projectId: crypto.randomUUID() },
      { ...record, version: -1 },
      { ...record, version: 1.5 },
      { ...record, version: "999" },
      { ...record, kind: "unknown" },
    ])
      await expect(
        readAssetPreviewRecord(
          clientReading(async () => value as MediaRecord),
          record.id,
          record.projectId,
          new AbortController().signal,
        ),
      ).rejects.toThrow("无法核对");
  });
  it("ignores a late success after leaving even when the transport ignores cancellation", async () => {
    let finish!: (value: MediaRecord) => void;
    const pending = new Promise<MediaRecord>((resolve) => {
      finish = resolve;
    });
    const controller = new AbortController();
    const reading = readAssetPreviewRecord(
      clientReading(async () => pending),
      record.id,
      record.projectId,
      controller.signal,
    );
    controller.abort();
    finish(record);
    expect(await reading).toBeUndefined();
  });
  it("propagates owner failures instead of fabricating a reusable old binding", async () => {
    const failure = new Error("owner unavailable");
    await expect(
      readAssetPreviewRecord(
        clientReading(async () => {
          throw failure;
        }),
        record.id,
        record.projectId,
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);
  });
});
