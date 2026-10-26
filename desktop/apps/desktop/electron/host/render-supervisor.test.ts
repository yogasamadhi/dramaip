import { afterEach, describe, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostTimelineRenderInput } from "@dramaip/desktop-host";
import {
  buildRenderArguments,
  RenderSupervisor,
  stageRenderSources,
} from "./render-supervisor";
import { ManagedMediaReader } from "./managed-media-reader";
import { buildRenderSubtitleFilters } from "./render-subtitles";

const input: HostTimelineRenderInput = {
  jobId: "00000000-0000-4000-8000-000000000001",
  timelineId: "00000000-0000-4000-8000-000000000002",
  durationFrames: 100,
  profile: {
    width: 1080,
    height: 1920,
    frameRate: { numerator: 25, denominator: 1, dropFrame: false },
    audioSampleRate: 48_000,
    channels: 2,
  },
  clips: [
    {
      mediaRef: "00000000-0000-4000-8000-000000000003",
      sha256: "a".repeat(64),
      sizeBytes: 4,
      mimeType: "video/mp4",
      startFrame: 25,
      durationFrames: 50,
      sourceOffsetFrame: 5,
    },
  ],
};

describe("signed FFmpeg render argument builder", () => {
  test("explicit burn requires prepared original font and safe filters after concat; omit never burns", () => {
    const mixed: HostTimelineRenderInput = {
      ...input,
      audioPlan: {
        format: "dramaip-render-audio",
        version: 1,
        policy: "saved-gains-reject-over-unity",
        videoEmbeddedAudio: "mix-if-present",
        clips: [],
      },
      subtitlePlan: {
        format: "dramaip-render-subtitles",
        version: 1,
        mode: "burn-in",
        font: {
          id: randomUUID(),
          packVersion: "0.0.0-test",
          sha256: "b".repeat(64),
        },
        cues: [
          {
            clipId: randomUUID(),
            startFrame: 5,
            durationFrames: 20,
            text: "字幕 %{n}",
          },
        ],
      },
    };
    const plan = mixed.subtitlePlan!;
    if (plan.mode !== "burn-in") throw Error("fixture requires burn-in");
    expect(() =>
      buildRenderArguments(mixed, "out.mp4", () => "source.mp4", "mix.f32le"),
    ).toThrow("no omit fallback");
    const prepared = {
      fontSha256: plan.font.sha256,
      filters: buildRenderSubtitleFilters(plan.cues),
      cues: [],
    };
    const args = buildRenderArguments(
      mixed,
      "out.mp4",
      () => "source.mp4",
      "mix.f32le",
      prepared,
    );
    expect(args.join(" ")).toContain(
      "[vbase]drawtext=fontfile=subtitle-font.ttf",
    );
    expect(args.join(" ")).not.toContain("字幕");
    expect(args.join(" ")).toContain("expansion=none");
    expect(() =>
      buildRenderArguments(mixed, "out.mp4", () => "source.mp4", "mix.f32le", {
        ...prepared,
        fontSha256: "0".repeat(64),
      }),
    ).toThrow("no omit fallback");
    expect(() =>
      buildRenderArguments(mixed, "out.mp4", () => "source.mp4", "mix.f32le", {
        ...prepared,
        filters: ["movie=/private"],
      }),
    ).toThrow("no omit fallback");
    const omit: HostTimelineRenderInput = {
      ...mixed,
      subtitlePlan: {
        format: "dramaip-render-subtitles",
        version: 1,
        mode: "omit",
      },
    };
    expect(
      buildRenderArguments(
        omit,
        "out.mp4",
        () => "source.mp4",
        "mix.f32le",
      ).join(" "),
    ).not.toContain("drawtext");
    expect(() =>
      buildRenderArguments(
        omit,
        "out.mp4",
        () => "source.mp4",
        "mix.f32le",
        prepared,
      ),
    ).toThrow("cannot adopt");
  });
  test("unverified subtitle capability refuses before allocating a queued job, without audio fallback", async () => {
    const supervisor = new RenderSupervisor({
      mediaRoot: "/not-used",
      ffmpegPath: "/not-used",
      rendererVersion: "test",
      probe: async () => {
        throw Error("must not probe");
      },
      probeAudio: async () => {
        throw Error("must not probe");
      },
      probeVideo: async () => {
        throw Error("must not probe");
      },
      audioMixAvailable: true,
      videoProofAvailable: true,
    });
    supervisors.push(supervisor);
    await supervisor.verifySubtitleCapability();
    expect(supervisor.audioMixAvailable).toBe(true);
    expect(supervisor.subtitleBurnInAvailable).toBe(false);
    expect(supervisor.subtitleFonts).toEqual([]);
    expect(() =>
      supervisor.start({
        ...input,
        audioPlan: {
          format: "dramaip-render-audio",
          version: 1,
          policy: "saved-gains-reject-over-unity",
          videoEmbeddedAudio: "mix-if-present",
          clips: [],
        },
        subtitlePlan: {
          format: "dramaip-render-subtitles",
          version: 1,
          mode: "burn-in",
          font: {
            id: randomUUID(),
            packVersion: "0.0.0-test",
            sha256: "b".repeat(64),
          },
          cues: [
            {
              clipId: randomUUID(),
              startFrame: 0,
              durationFrames: 1,
              text: "字幕",
            },
          ],
        },
      }),
    ).toThrow("no omit fallback");
    expect(supervisor.get(input.jobId)).toBeUndefined();
  });
  test("an explicit new policy cannot silently use the legacy silent source or unverified capability", () => {
    const mixed = {
      ...input,
      audioPlan: {
        format: "dramaip-render-audio" as const,
        version: 1 as const,
        policy: "saved-gains-reject-over-unity" as const,
        videoEmbeddedAudio: "mix-if-present" as const,
        clips: [],
      },
    };
    expect(() =>
      buildRenderArguments(mixed, "out.mp4", () => "private.mp4"),
    ).toThrow("no silent fallback");
    const args = buildRenderArguments(
      mixed,
      "out.mp4",
      () => "private.mp4",
      "private.verified.f32le",
    );
    expect(args).toContain("private.verified.f32le");
    expect(args).not.toContain(
      "anullsrc=channel_layout=stereo:sample_rate=48000",
    );
    const supervisor = new RenderSupervisor({
      mediaRoot: "/not-used",
      ffmpegPath: "/not-used",
      rendererVersion: "controlled",
      probe: async () => {
        throw Error("must not probe");
      },
    });
    supervisors.push(supervisor);
    expect(supervisor.audioMixAvailable).toBe(false);
    expect(() => supervisor.start(mixed)).toThrow("no legacy silent fallback");
    expect(supervisor.get(mixed.jobId)).toBeUndefined();
    const audioOnly = new RenderSupervisor({
      mediaRoot: "/not-used",
      ffmpegPath: "/not-used",
      rendererVersion: "controlled",
      probe: async () => {
        throw Error("must not probe");
      },
      probeAudio: async () => {
        throw Error("must not probe");
      },
      audioMixAvailable: true,
    });
    supervisors.push(audioOnly);
    expect(audioOnly.audioMixAvailable).toBe(false);
    expect(() => audioOnly.start(mixed)).toThrow("no legacy silent fallback");
    expect(audioOnly.get(mixed.jobId)).toBeUndefined();
  });
  test("rejects missing/forged archive metadata, paths, excess duration and numeric strings before a process", () => {
    for (const patch of [
      { sha256: undefined },
      { sha256: "not-a-checksum" },
      { sizeBytes: "4" },
      { mediaRef: "../secret" },
      { mimeType: "video/webm" },
      { path: "/private/secret.mp4" },
      { startFrame: 99 },
      { sourceOffsetFrame: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(() =>
        buildRenderArguments(
          {
            ...input,
            clips: [{ ...input.clips[0]!, ...patch }],
          } as HostTimelineRenderInput,
          "output.mp4",
          () => "private.mp4",
        ),
      ).toThrow("exact opaque");
    }
  });
  test("uses argv-only local inputs, black gaps, x264 and AAC", () => {
    const args = buildRenderArguments(
      input,
      "/private/render/output.mp4",
      (mediaRef) => `/private/media/${mediaRef}.mp4`,
    );
    expect(args[0]).toBe("-nostdin");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args).toContain("cfr");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("100");
    expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(args).toContain("color=c=black:s=1080x1920:r=25");
    expect(args.at(-1)).toBe("/private/render/output.mp4");
    expect(args.join(" ")).not.toContain("http://");
    expect(args.join(" ")).not.toContain("https://");
  });

  test("rejects overlapping video clips before starting a process", () => {
    expect(() =>
      buildRenderArguments(
        {
          ...input,
          clips: [
            input.clips[0]!,
            {
              ...input.clips[0]!,
              mediaRef: "00000000-0000-4000-8000-000000000004",
              startFrame: 50,
            },
          ],
        },
        "/private/render/output.mp4",
        (mediaRef) => `/private/media/${mediaRef}.mp4`,
      ),
    ).toThrow("Overlapping");
  });
});

const roots: string[] = [];
const readers: ManagedMediaReader[] = [];
const supervisors: RenderSupervisor[] = [];
afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.dispose();
  for (const reader of readers.splice(0)) await reader.dispose();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), "dramaip-render-source-"));
  roots.push(root);
  const bytes = Buffer.alloc(768 * 1024 + 31, 7);
  const mediaRef = randomUUID();
  const file = join(root, `${mediaRef}.mp4`);
  await writeFile(file, bytes, { mode: 0o600 });
  const value = structuredClone(input);
  value.jobId = randomUUID();
  value.clips = [
    {
      ...value.clips[0]!,
      mediaRef,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  const reader = new ManagedMediaReader(root);
  readers.push(reader);
  const directory = await mkdtemp(join(root, "snapshot-"));
  return { root, file, bytes, value, reader, directory };
}

test("render sources are complete private snapshots; split clips reuse exact bytes, later library edits do not replace them", async () => {
  const f = await sourceFixture();
  f.value.clips = [
    f.value.clips[0]!,
    {
      ...f.value.clips[0]!,
      startFrame: 75,
      durationFrames: 25,
      sourceOffsetFrame: 55,
    },
  ];
  const paths = await stageRenderSources(
    f.value,
    f.directory,
    f.reader,
    new AbortController().signal,
  );
  expect(paths.size).toBe(1);
  expect(await readFile(paths.get(f.value.clips[0]!.mediaRef)!)).toEqual(
    f.bytes,
  );
  await writeFile(f.file, Buffer.alloc(f.bytes.length, 8));
  expect(await readFile(paths.get(f.value.clips[0]!.mediaRef)!)).toEqual(
    f.bytes,
  );
  expect((await readdir(f.directory)).length).toBe(1);
  const args = buildRenderArguments(f.value, "output.mp4", (id) =>
    paths.get(id)!,
  );
  expect(args).not.toContain(f.file);
  expect(
    args.filter((item) => item === paths.get(f.value.clips[0]!.mediaRef)!),
  ).toHaveLength(2);
});

test("snapshot rejects equal-length corruption, symlinks, inconsistent duplicate descriptors and cancellation", async () => {
  for (const mode of ["corrupt", "symlink", "duplicate", "cancel"]) {
    const f = await sourceFixture();
    const abort = new AbortController();
    if (mode === "corrupt")
      await writeFile(f.file, Buffer.alloc(f.bytes.length, 8));
    if (mode === "symlink") {
      const mediaRef = randomUUID();
      await symlink(f.file, join(f.root, `${mediaRef}.mp4`));
      f.value.clips = [{ ...f.value.clips[0]!, mediaRef }];
    }
    if (mode === "duplicate")
      f.value.clips = [
        f.value.clips[0]!,
        {
          ...f.value.clips[0]!,
          startFrame: 75,
          durationFrames: 25,
          sha256: "b".repeat(64),
        },
      ];
    if (mode === "cancel") abort.abort();
    await expect(
      stageRenderSources(f.value, f.directory, f.reader, abort.signal),
    ).rejects.toThrow();
  }
});

test("audio and visual descriptors stage full private snapshots by MIME, reject corruption and do not reuse editable refs", async () => {
  const f = await sourceFixture();
  const mediaRef = randomUUID();
  const audioBytes = Buffer.alloc(128 * 1024 + 17, 9);
  const audioFile = join(f.root, `${mediaRef}.wav`);
  await writeFile(audioFile, audioBytes, { mode: 0o600 });
  f.value.audioPlan = {
    format: "dramaip-render-audio",
    version: 1,
    policy: "saved-gains-reject-over-unity",
    videoEmbeddedAudio: "mix-if-present",
    clips: [
      {
        clipId: randomUUID(),
        mediaRef,
        mimeType: "audio/wav",
        sha256: createHash("sha256").update(audioBytes).digest("hex"),
        sizeBytes: audioBytes.length,
        kind: "dialogue",
        startFrame: 0,
        durationFrames: 25,
        sourceOffsetFrame: 0,
        volume: 0.8,
        fadeInFrames: 0,
        fadeOutFrames: 0,
        duckingGain: 0.55,
      },
    ],
  };
  const paths = await stageRenderSources(
    f.value,
    f.directory,
    f.reader,
    new AbortController().signal,
  );
  expect(paths.size).toBe(2);
  expect(paths.get(mediaRef)!.endsWith(".input.wav")).toBe(true);
  expect(await readFile(paths.get(mediaRef)!)).toEqual(audioBytes);
  await writeFile(audioFile, Buffer.alloc(audioBytes.length, 8));
  expect(await readFile(paths.get(mediaRef)!)).toEqual(audioBytes);
  const another = await mkdtemp(join(f.root, "snapshot-"));
  await expect(
    stageRenderSources(
      f.value,
      another,
      f.reader,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

test("supervisor never probes or starts FFmpeg for corrupt bytes and releases its isolated snapshot", async () => {
  const f = await sourceFixture();
  await writeFile(f.file, Buffer.alloc(f.bytes.length, 8));
  let probes = 0;
  const supervisor = new RenderSupervisor({
    mediaRoot: f.root,
    ffmpegPath: "/not-installed/ffmpeg",
    rendererVersion: "test-signed-v1",
    probe: async () => {
      probes++;
      throw new Error("must not probe");
    },
  });
  supervisors.push(supervisor);
  const first = supervisor.start(f.value);
  expect(first.status).toBe("queued");
  expect(first).not.toHaveProperty("abort");
  expect(() => supervisor.start({ ...f.value, durationFrames: 101 })).toThrow(
    "different frozen input",
  );
  const deadline = Date.now() + 3_000;
  while (
    supervisor.get(f.value.jobId)?.status === "queued" &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(supervisor.get(f.value.jobId)?.status).toBe("failed");
  expect(probes).toBe(0);
  await supervisor.dispose();
  expect(
    (await readdir(f.root)).filter((name) => name.startsWith("render-job-")),
  ).toHaveLength(0);
  expect(await readFile(f.file)).toEqual(Buffer.alloc(f.bytes.length, 8));
});

test("cancel while source probe awaits cannot resurrect running work or publish output; disposal waits for cleanup", async () => {
  const f = await sourceFixture();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const supervisor = new RenderSupervisor({
    mediaRoot: f.root,
    ffmpegPath: "/not-installed/ffmpeg",
    rendererVersion: "test-signed-v1",
    probe: async () => {
      reached();
      await waiting;
      return {
        kind: "video",
        mimeType: "video/mp4",
        extension: ".mp4",
        width: 96,
        height: 64,
        durationFrames: 100,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
      };
    },
  });
  supervisors.push(supervisor);
  supervisor.start(f.value);
  f.value.clips = [
    { ...f.value.clips[0]!, mediaRef: "../caller-mutated-after-queue" },
  ];
  await entered;
  expect(supervisor.cancel(f.value.jobId)?.status).toBe("canceled");
  const done = supervisor.dispose();
  release();
  await done;
  expect(supervisor.get(f.value.jobId)).toMatchObject({
    status: "canceled",
    progress: 0,
  });
  expect(supervisor.get(f.value.jobId)).not.toHaveProperty("output");
  expect(
    (await readdir(f.root)).filter((name) => name.startsWith("render-job-")),
  ).toHaveLength(0);
  expect(() => supervisor.start({ ...f.value, jobId: randomUUID() })).toThrow(
    "disposed",
  );
});

test("source duration overflow fails before starting FFmpeg and leaves the library unchanged", async () => {
  const f = await sourceFixture();
  let probes = 0;
  const supervisor = new RenderSupervisor({
    mediaRoot: f.root,
    ffmpegPath: "/not-installed/ffmpeg",
    rendererVersion: "controlled-v1",
    probe: async () => {
      probes++;
      return {
        kind: "video",
        mimeType: "video/mp4",
        extension: ".mp4",
        width: 96,
        height: 64,
        durationFrames: 25,
        frameRate: { numerator: 25, denominator: 1, dropFrame: false },
      };
    },
  });
  supervisors.push(supervisor);
  supervisor.start(f.value);
  const deadline = Date.now() + 3_000;
  while (
    supervisor.get(f.value.jobId)?.status === "queued" &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(supervisor.get(f.value.jobId)).toMatchObject({
    status: "failed",
    failureCode: "RENDER_FAILED",
  });
  expect(probes).toBe(1);
  await supervisor.dispose();
  expect(
    (await readdir(f.root)).filter((name) => name.startsWith("render-job-")),
  ).toHaveLength(0);
  expect(await readFile(f.file)).toEqual(f.bytes);
});
