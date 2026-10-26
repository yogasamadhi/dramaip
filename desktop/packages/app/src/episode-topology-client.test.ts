import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import type { EpisodeTopologyRevisionSummary } from "@dramaip/contracts/production";

const id = "90000000-0000-4000-8000-000000000001",
  projectId = "90000000-0000-4000-8000-000000000002";
const summary: EpisodeTopologyRevisionSummary = {
  id,
  projectId,
  episodeId: "pilot",
  sourceScript: { id: "90000000-0000-4000-8000-000000000003", version: 1 },
  sourceOutline: { id: "90000000-0000-4000-8000-000000000004", version: 1 },
  document: {
    id: "90000000-0000-4000-8000-000000000005",
    scriptId: "90000000-0000-4000-8000-000000000006",
    version: 2,
  },
  status: "pending",
  stateVersion: 0,
  sourceState: "current",
  staleReasons: [],
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};
function client(reply: unknown, failed = false) {
  const calls: Array<{ path: string; method: string }> = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    openEventStream: async () => new Response(),
    fetch: async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      calls.push({ path: url.pathname + url.search, method: request.method });
      if (failed) throw new Error("PRIVATE original owner unavailable");
      return Response.json(reply);
    },
  });
  return { sdk: sdk.episodeDevelopments, calls };
}
test("topology summary SDK uses exact owner project cursor and rejects foreign duplicated malformed or private-body replies without fallback", async () => {
  const reply = { items: [summary], nextCursor: id },
    good = client(reply);
  expect(await good.sdk.topologyRevisionSummaries(projectId, id)).toEqual(
    reply,
  );
  expect(good.calls).toEqual([
    {
      path: `/api/v2/projects/${projectId}/episode-topology-revision-summaries?cursor=${id}`,
      method: "GET",
    },
  ]);
  for (const raw of [
    { items: [{ ...summary, projectId: id }] },
    { items: [summary, summary] },
    { items: [summary], nextCursor: projectId },
    { items: [{ ...summary, outlineContent: { content: "PRIVATE" } }] },
    { items: [{ ...summary, document: undefined }] },
  ]) {
    const bad = client(raw);
    await expect(
      bad.sdk.topologyRevisionSummaries(projectId),
    ).rejects.toThrow();
    expect(bad.calls).toHaveLength(1);
  }
  const unavailable = client(reply, true);
  await expect(
    unavailable.sdk.topologyRevisionSummaries(projectId),
  ).rejects.toThrow();
  expect(unavailable.calls).toHaveLength(1);
});
test("topology author adoption requires all four literal reviews before any owner write or model operation", async () => {
  const bad = client({});
  await expect(
    bad.sdk.adoptTopologyRevision(
      id,
      0,
      {
        actualDocumentReviewed: true,
        outlineTopologyReviewed: false as unknown as true,
        sceneMappingReviewed: true,
        authorIntentAndSourcesRetained: true,
      },
      "original-key",
    ),
  ).rejects.toThrow();
  expect(bad.calls).toEqual([]);
});
