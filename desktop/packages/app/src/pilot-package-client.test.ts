import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import type { PilotPackagePreview } from "@dramaip/contracts/delivery";
import {
  episodeDevelopmentNavigationError,
  matchesExactPilotPackage,
} from "./episode-development-navigation";

const projectId = "70000000-0000-4000-8000-000000000001",
  id = "70000000-0000-4000-8000-000000000002",
  other = "70000000-0000-4000-8000-000000000003";
const ref = { id: other, version: 0 };
const at = "2026-10-03T00:00:00.000Z";
const preview: PilotPackagePreview = {
  id,
  version: 0,
  status: "awaiting-confirmation",
  sourceState: "current",
  sourceIssues: [],
  manifest: {
    schemaVersion: 1,
    purpose: "internal-pilot",
    projectId,
    projectVersion: 0,
    projectTitle: "Contract-only package fixture, not a real production result",
    episodeId: "episode-1",
    episodeTitle: "One episode",
    durationSeconds: 60,
    adopted: {
      authorIntent: ref,
      diagnosis: { ...ref, strategyId: "direction-1" },
      seasonPlan: ref,
      outline: ref,
      script: ref,
      storyboard: ref,
    },
    scriptRecordId: other,
    scriptDocumentVersion: 0,
    productionRecords: [],
    lineage: [],
    preflight: {
      checks: [],
      blockers: [],
      warnings: ["No semantic assurance"],
    },
    qualityEvidence: [
      {
        target: {
          kind: "script",
          id: other,
          version: 0,
          sourceFingerprint: "a".repeat(64),
        },
        state: "unknown",
        requiredDimensions: ["causality", "timeline"],
        reviewedDimensions: ["causality"],
        missingDimensions: ["timeline"],
        reports: [ref],
        blockers: [],
        acceptedRiskCount: 0,
      },
    ],
    missingItems: ["Unverified literature, rights and costs"],
    externalDependencies: [],
    costs: { status: "unknown", explanation: "Not zero" },
    media: { binaryIncluded: false, generatedByExport: false },
    files: [],
    indexFile: "manifest.json",
    createdAt: at,
  },
  archive: {
    fileName: "pilot.zip",
    mimeType: "application/zip",
    sha256: "b".repeat(64),
    byteSize: 1,
  },
  files: [],
  createdAt: at,
  updatedAt: at,
};
function client(reply: unknown, status = 200) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return Response.json(reply, { status });
    },
    openEventStream: async () => new Response(),
  }).pilotPackages;
  return { sdk, calls };
}

test("M1 试制包精确返回保留旧裸链接，显式错误单集、重复身份与混合对象不回退", () => {
  expect(matchesExactPilotPackage(preview, { previewId: id, projectId })).toBe(
    true,
  );
  expect(
    matchesExactPilotPackage(preview, {
      previewId: id,
      projectId,
      episodeId: "episode-1",
    }),
  ).toBe(true);
  for (const requested of [
    { previewId: other, projectId },
    { previewId: id, projectId: other },
    { previewId: id, projectId, episodeId: "episode-2" },
  ])
    expect(matchesExactPilotPackage(preview, requested)).toBe(false);
  for (const search of [
    `?pilotPackageId=${id}`,
    `?pilotPackageId=${id}&episodeId=episode-1&operation=storyboard-package`,
  ])
    expect(
      episodeDevelopmentNavigationError(new URLSearchParams(search)),
    ).toBeUndefined();
  for (const search of [
    "?pilotPackageId=",
    "?pilotPackageId=bad",
    `?pilotPackageId=${id}&pilotPackageId=${id}`,
    `?pilotPackageId=${id}&operation=episode-script`,
    `?pilotPackageId=${id}&resultId=${other}`,
    `?pilotPackageId=${id}&workflowId=${other}`,
    `?pilotPackageId=${id}&sourceRevisionId=${other}`,
  ])
    expect(
      episodeDevelopmentNavigationError(new URLSearchParams(search)),
    ).toBeTruthy();
});

test("pilot SDK reads exact saved-source evidence and historical packages without adding or replacing reports", async () => {
  const { sdk, calls } = client(preview);
  expect(await sdk.get(id)).toEqual(preview);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  const legacy = structuredClone(preview);
  delete legacy.manifest.qualityEvidence;
  expect(await client(legacy).sdk.get(id)).toEqual(legacy);
  for (const invalid of [
    { ...preview, id: other },
    {
      ...preview,
      manifest: {
        ...preview.manifest,
        qualityEvidence: [
          {
            ...preview.manifest.qualityEvidence![0]!,
            target: { kind: "script", id: other, version: 0 },
          },
        ],
      },
    },
  ]) {
    const checked = client(invalid);
    await expect(checked.sdk.get(id)).rejects.toThrow();
    expect(checked.calls).toHaveLength(1);
  }
});

test("pilot SDK validates the explicitly requested preview and save identity with one write, preserving CAS and idempotency headers", async () => {
  const input = { projectVersion: 0, storyboard: ref, includeNle: false };
  const first = client(preview);
  expect(
    await first.sdk.preview(projectId, input, "exact-preview-key"),
  ).toEqual(preview);
  expect(first.calls).toHaveLength(1);
  expect(first.calls[0]!.method).toBe("POST");
  expect(first.calls[0]!.headers.get("Idempotency-Key")).toBe(
    "exact-preview-key",
  );
  expect(await first.calls[0]!.json()).toEqual(input);
  for (const manifest of [
    { ...preview.manifest, projectId: other },
    { ...preview.manifest, projectVersion: 1 },
    {
      ...preview.manifest,
      adopted: {
        ...preview.manifest.adopted,
        storyboard: { ...ref, version: 1 },
      },
    },
  ]) {
    const checked = client({ ...preview, manifest });
    await expect(
      checked.sdk.preview(projectId, input, "exact-preview-key"),
    ).rejects.toThrow();
    expect(checked.calls).toHaveLength(1);
  }
  const confirmation = {
    version: 0,
    archiveSha256: preview.archive.sha256,
    rights: {
      basis: "original" as const,
      note: "Author rights declaration only",
      confirmed: true as const,
    },
    internalReviewConfirmed: true as const,
    unverifiedChecksAcknowledged: true as const,
  };
  const save = client(preview);
  expect(await save.sdk.save(id, confirmation, "exact-save-key")).toEqual(
    preview,
  );
  expect(save.calls).toHaveLength(1);
  expect(save.calls[0]!.headers.get("If-Match")).toBe('"0"');
  expect(save.calls[0]!.headers.get("Idempotency-Key")).toBe("exact-save-key");
  expect(await save.calls[0]!.json()).toEqual(confirmation);
  const wrong = client({ ...preview, id: other });
  await expect(
    wrong.sdk.save(id, confirmation, "exact-save-key"),
  ).rejects.toThrow();
  expect(wrong.calls).toHaveLength(1);
});

test("pilot SDK carries only the explicitly selected attribution and refuses implicit latest, missing or changed association receipts", async () => {
  const attribution = { id, version: 1 },
    input = {
      projectVersion: 0,
      storyboard: ref,
      includeNle: false,
      shotAttribution: attribution,
    };
  const explicit = {
    ...preview,
    manifest: {
      ...preview.manifest,
      adopted: { ...preview.manifest.adopted, shotAttribution: attribution },
    },
  };
  const selected = client(explicit);
  expect(
    await selected.sdk.preview(
      projectId,
      input,
      "original-association-preview-key",
    ),
  ).toEqual(explicit);
  expect(await selected.calls[0]!.json()).toEqual(input);
  for (const raw of [
    preview,
    {
      ...explicit,
      manifest: {
        ...explicit.manifest,
        adopted: {
          ...explicit.manifest.adopted,
          shotAttribution: { id: other, version: 1 },
        },
      },
    },
    {
      ...explicit,
      manifest: {
        ...explicit.manifest,
        adopted: {
          ...explicit.manifest.adopted,
          shotAttribution: { id, version: 2 },
        },
      },
    },
  ])
    await expect(
      client(raw).sdk.preview(projectId, input, "same-choice-key"),
    ).rejects.toThrow();
  const { shotAttribution: _optional, ...withoutSelection } = input;
  await expect(
    client(explicit).sdk.preview(
      projectId,
      withoutSelection,
      "no-association-key",
    ),
  ).rejects.toThrow();
});

test("pilot SDK rejects foreign or duplicate package pages, impossible cursors and actual read failures instead of returning an empty success", async () => {
  const { sdk, calls } = client({ items: [preview], nextCursor: id });
  expect((await sdk.list(projectId, other, 1)).nextCursor).toBe(id);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain(`cursor=${other}&limit=1`);
  for (const invalid of [
    {
      items: [
        { ...preview, manifest: { ...preview.manifest, projectId: other } },
      ],
    },
    { items: [preview, preview] },
    { items: [preview], nextCursor: other },
    { items: [], nextCursor: id },
  ]) {
    const checked = client(invalid);
    await expect(checked.sdk.list(projectId)).rejects.toThrow();
    expect(checked.calls).toHaveLength(1);
  }
  const unavailable = client(
    {
      type: "https://dramaip.local/problems/unavailable",
      title: "Actual read failure",
      status: 503,
    },
    503,
  );
  await expect(unavailable.sdk.list(projectId)).rejects.toThrow();
  expect(unavailable.calls).toHaveLength(1);
});
