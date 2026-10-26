import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import { TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION } from "@dramaip/contracts/timeline";
const id = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const input = {
  timelineProfileVersion: "p0-v1",
  rendererVersion: "controlled-v1",
  sidecarArtifactVersion: "controlled-v1",
  sourceFingerprint: "a".repeat(64),
};
const value = {
  ...input,
  jobId,
  timelineId: id,
  timelineVersion: 4,
  status: "queued" as const,
  progress: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const preflight = {
  timelineId: id,
  timelineVersion: 4,
  timelineEtag: `"timeline:${id}:4"`,
  profileVersion: input.timelineProfileVersion,
  rendererVersion: input.rendererVersion,
  sidecarArtifactVersion: input.sidecarArtifactVersion,
  sourceFingerprint: input.sourceFingerprint,
  ready: true,
  blockers: [],
  warnings: ["本地实验混音，不是正式发行；独立字幕不烧录"],
};
const client = (respond: (request: Request) => Promise<Response>) =>
  createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: id,
    runtimeGeneration: 1,
    fetch: (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });

test("subtitle SDK freezes exact explicit policy and opaque font in query/write/receipt, never text or private paths", async () => {
  const policy = {
    version: 1 as const,
    mode: "burn-in" as const,
    font: { id: jobId, packVersion: "1.0.0", sha256: "b".repeat(64) },
  };
  const currentInput = {
    ...input,
    timelineProfileVersion: TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
    subtitlePolicy: policy,
  };
  const current = { ...value, ...currentInput };
  const native = {
    ...preflight,
    profileVersion: TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
    subtitlePolicy: policy,
    subtitleBurnInAvailable: true,
    subtitleFonts: [
      {
        ...policy.font,
        label: "signed declaration",
        sizeBytes: 100,
        license: "test declaration",
        sourceUrl: "https://example.invalid/font",
      },
    ],
  };
  const calls: Request[] = [],
    sdk = client(async (request) => {
      calls.push(request);
      return Response.json(
        new URL(request.url).pathname.endsWith("preflight") ? native : current,
      );
    });
  expect(await sdk.timelineRenders.preflight(id, 4, undefined, policy)).toEqual(
    native,
  );
  expect(new URL(calls[0]!.url).searchParams.get("subtitleMode")).toBe(
    "burn-in",
  );
  expect(new URL(calls[0]!.url).searchParams.get("fontSha256")).toBe(
    policy.font.sha256,
  );
  expect(
    await sdk.timelineRenders.create(
      id,
      4,
      currentInput,
      "original-policy-key",
    ),
  ).toEqual(current);
  expect(await calls[1]!.json()).toEqual(currentInput);
  expect(
    await sdk.timelineRenders.retry(
      jobId,
      id,
      4,
      currentInput,
      "original-retry-key",
    ),
  ).toEqual(current);
  expect(JSON.stringify(currentInput)).not.toContain("text");
  for (const subtitlePolicy of [
    undefined,
    { version: 1, mode: "omit" },
    { ...policy, font: { ...policy.font, sha256: "c".repeat(64) } },
  ])
    await expect(
      client(async () =>
        Response.json({ ...current, subtitlePolicy }),
      ).timelineRenders.create(id, 4, currentInput, "key"),
    ).rejects.toThrow();
  for (const patch of [
    { subtitleBurnInAvailable: false },
    { subtitleFonts: [] },
    { subtitleFonts: [native.subtitleFonts[0], native.subtitleFonts[0]] },
    {
      subtitleFonts: [
        { ...native.subtitleFonts[0], path: "/private/font.ttf" },
      ],
    },
    { subtitlePolicy: undefined },
  ])
    await expect(
      client(async () =>
        Response.json({ ...native, ...patch }),
      ).timelineRenders.preflight(id, 4, undefined, policy),
    ).rejects.toThrow();
});

test("subtitle SDK distinguishes explicit omit from legacy absence and rejects unproved new-version catalog jobs", async () => {
  const policy = { version: 1 as const, mode: "omit" as const },
    current = {
      ...value,
      timelineProfileVersion: TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
    };
  const native = {
    ...preflight,
    profileVersion: TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
    subtitlePolicy: policy,
    subtitleBurnInAvailable: false,
    subtitleFonts: [],
  };
  const sdk = client(async (request) => {
    expect(new URL(request.url).searchParams.toString()).toBe(
      "subtitleMode=omit",
    );
    return Response.json(native);
  });
  expect(
    (await sdk.timelineRenders.preflight(id, 4, undefined, policy))
      .subtitlePolicy,
  ).toEqual(policy);
  await expect(
    client(async () => Response.json(native)).timelineRenders.preflight(id, 4),
  ).rejects.toThrow();
  await expect(
    client(async () => Response.json(current)).timelineRenders.get(jobId, id),
  ).rejects.toThrow();
  await expect(
    client(async () =>
      Response.json({
        projectId: id,
        episodeId: id,
        timeline: { id, version: 4, etag: preflight.timelineEtag },
        items: [current],
      }),
    ).timelineRenders.list(id, id),
  ).rejects.toThrow();
});

test("render catalog uses exact project/episode and real cursor; wrong scope, duplicate IDs, foreign output and forged request receipts fail", async () => {
  const projectId = "10000000-0000-4000-8000-000000000003";
  const episodeId = "10000000-0000-4000-8000-000000000004";
  const catalog = {
    projectId,
    episodeId,
    timeline: { id, version: 4, etag: preflight.timelineEtag },
    items: [value],
    nextCursor: "actual-cursor",
  };
  const calls: Request[] = [];
  const sdk = client(async (request) => {
    calls.push(request);
    return Response.json(catalog);
  });
  expect(
    (
      await sdk.timelineRenders.list(projectId, episodeId, {
        cursor: "actual-cursor",
        limit: 1,
      })
    ).items,
  ).toHaveLength(1);
  expect(calls[0]!.url).toContain(
    `/episodes/${episodeId}/timeline-renders?projectId=${projectId}&limit=1&cursor=actual-cursor`,
  );
  for (const altered of [
    { ...catalog, projectId: id },
    { ...catalog, episodeId: id },
    { ...catalog, timeline: undefined },
    { ...catalog, items: [value, value] },
    { ...catalog, items: [{ ...value, timelineVersion: 5 }] },
    {
      ...catalog,
      items: [
        {
          ...value,
          status: "succeeded",
          outputMediaRef: jobId,
          outputSha256: "a".repeat(64),
          outputRecord: { id: jobId, projectId: id, version: 0 },
        },
      ],
    },
    { ...catalog, privatePath: "/secret" },
  ]) {
    await expect(
      client(async () => Response.json(altered)).timelineRenders.list(
        projectId,
        episodeId,
      ),
    ).rejects.toThrow();
  }
  await expect(
    sdk.timelineRenders.list(projectId, episodeId, {
      requestFingerprint: "b".repeat(64),
    }),
  ).rejects.toThrow();
});

test("render output identity is strict and only available on a proven success; late catalog cancellation rejects", async () => {
  const withOutput = {
    ...value,
    outputRecord: { id: jobId, projectId: id, version: 0 },
  };
  await expect(
    client(async () => Response.json(withOutput)).timelineRenders.get(
      jobId,
      id,
    ),
  ).rejects.toThrow();
  const abort = new AbortController();
  const sdk = client(async () => {
    abort.abort();
    return Response.json({ projectId: id, episodeId: id, items: [] });
  });
  await expect(
    sdk.timelineRenders.list(id, id, {}, abort.signal),
  ).rejects.toThrow();
});

test("render SDK freezes exact preflight fingerprint, version and request key without any Host path or raw URL", async () => {
  const calls: Request[] = [];
  const sdk = client(async (request) => {
    calls.push(request);
    return Response.json(
      request.method === "GET" && request.url.endsWith("preflight")
        ? preflight
        : value,
    );
  });
  expect(await sdk.timelineRenders.preflight(id, 4)).toEqual(preflight);
  expect(
    await sdk.timelineRenders.create(id, 4, input, "same-request"),
  ).toEqual(value);
  expect(calls[1]!.headers.get("If-Match")).toBe(`"timeline:${id}:4"`);
  expect(calls[1]!.headers.get("Idempotency-Key")).toBe("same-request");
  expect(await calls[1]!.json()).toEqual(input);
  expect(await sdk.timelineRenders.get(jobId, id)).toEqual(value);
  expect(await sdk.timelineRenders.cancel(jobId, id)).toEqual(value);
  expect(
    await sdk.timelineRenders.retry(jobId, id, 4, input, "same-retry"),
  ).toEqual(value);
});

test("render SDK refuses wrong identity/version/fingerprint, missing ready proof or unexpected paths", async () => {
  for (const patch of [
    { timelineId: jobId },
    { timelineVersion: 5 },
    { sourceFingerprint: "b".repeat(64) },
    { path: "/private/output.mp4" },
  ]) {
    const sdk = client(async () => Response.json({ ...value, ...patch }));
    await expect(
      sdk.timelineRenders.create(id, 4, input, "key"),
    ).rejects.toThrow();
  }
  for (const patch of [
    { timelineId: jobId },
    { timelineVersion: 5 },
    { sourceFingerprint: undefined },
    { rendererVersion: undefined },
    { path: "/private/input.mp4" },
  ]) {
    const sdk = client(async () => Response.json({ ...preflight, ...patch }));
    await expect(sdk.timelineRenders.preflight(id, 4)).rejects.toThrow();
  }
  const sdk = client(async () => Response.json({ ...value, jobId: id }));
  await expect(sdk.timelineRenders.get(jobId, id)).rejects.toThrow();
});

test("render SDK rejects late results after caller cancellation and preserves protocol failures", async () => {
  const abort = new AbortController();
  const sdk = client(async () => {
    abort.abort();
    return Response.json(value);
  });
  await expect(
    sdk.timelineRenders.get(jobId, id, abort.signal),
  ).rejects.toThrow();
  const refused = client(async () =>
    Response.json(
      {
        type: "about:blank",
        title: "冻结来源已变化",
        status: 409,
        code: "RENDER_SOURCE_CONFLICT",
        traceId: "render-trace",
      },
      { status: 409, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
  await expect(
    refused.timelineRenders.retry(jobId, id, 4, input, "key"),
  ).rejects.toMatchObject({ status: 409 });
});
