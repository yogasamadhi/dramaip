import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FONT_FIXTURE_ID,
  fontSha,
  signedFontFixture,
} from "./renderer-font.fixture";
import { loadVerifiedRendererFonts } from "./renderer-fonts";
import {
  buildRenderSubtitleFilters,
  prepareRenderSubtitles,
  type RenderSubtitleCue,
} from "./render-subtitles";

// Explicit existing local tool/font; never installed, downloaded, bundled or treated as licensed for distribution.
const ffmpegPath = process.env.DRAMAIP_TEST_FFMPEG_PATH;
const fontPath = process.env.DRAMAIP_TEST_SUBTITLE_FONT_PATH;
assert(
  ffmpegPath && fontPath,
  "Set existing DRAMAIP_TEST_FFMPEG_PATH and DRAMAIP_TEST_SUBTITLE_FONT_PATH for this opt-in isolated test.",
);
const run = (directory: string, filter: string, frames = 12) =>
  execFileSync(
    ffmpegPath,
    [
      "-nostdin",
      "-v",
      "error",
      "-xerror",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1080x1920:r=25",
      "-vf",
      filter,
      "-frames:v",
      String(frames),
      "-threads",
      "1",
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    {
      cwd: directory,
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
const cue = (
  text: string,
  patch: Partial<RenderSubtitleCue> = {},
): RenderSubtitleCue => ({
  clipId: "88888888-8888-4888-8888-888888888888",
  startFrame: 2,
  durationFrames: 5,
  text,
  ...patch,
});
async function fixture<T>(
  fn: (f: {
    root: string;
    directory: string;
    font: Awaited<ReturnType<typeof loadVerifiedRendererFonts>>[number];
    ref: { id: string; packVersion: string; sha256: string };
    prepare(
      cues: RenderSubtitleCue[],
      options?: {
        signal?: AbortSignal;
        observer?(
          child: import("node:child_process").ChildProcess | undefined,
        ): void;
      },
    ): ReturnType<typeof prepareRenderSubtitles>;
  }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "dramaip-subtitle-local-"));
  try {
    assert(fontPath);
    const signed = await signedFontFixture(root, await readFile(fontPath));
    const font = (
      await loadVerifiedRendererFonts({
        root,
        publicKeyPem: signed.publicKeyPem,
      })
    )[0]!;
    const directory = join(root, "job ' ; [with] : punctuation");
    await mkdir(directory);
    const ref = {
      id: FONT_FIXTURE_ID,
      packVersion: font.descriptor.packVersion,
      sha256: font.descriptor.sha256,
    };
    const prepare = (
      cues: RenderSubtitleCue[],
      options?: {
        signal?: AbortSignal;
        observer?(
          child: import("node:child_process").ChildProcess | undefined,
        ): void;
      },
    ) =>
      prepareRenderSubtitles({
        executable: ffmpegPath!,
        directory,
        durationFrames: 12,
        font,
        fontRef: ref,
        cues,
        signal: options?.signal ?? new AbortController().signal,
        observer: options?.observer ?? (() => undefined),
      });
    return await fn({ root, directory, font, ref, prepare });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("actual Unicode font is signed and fully frozen; Chinese literal expansion and half-open output frames are preserved", async () =>
  fixture(async (f) => {
    const value = cue("字幕 %{n}");
    const prepared = await f.prepare([value]);
    assert.equal(prepared.fontSha256, f.font.descriptor.sha256);
    assert.equal(
      prepared.cues[0]!.textSha256,
      fontSha(Buffer.from(value.text)),
    );
    assert(prepared.cues[0]!.width > 0 && prepared.cues[0]!.width <= 888);
    assert.deepEqual(
      await readFile(join(f.directory, "subtitle-0000.txt")),
      Buffer.from(value.text),
    );
    assert.deepEqual(
      await readFile(join(f.directory, "subtitle-font.ttf")),
      f.font.bytes(),
    );
    const actual = run(f.directory, prepared.filters.join(","));
    assert.equal(actual.length, 1080 * 1920 * 12);
    const hashes: string[] = [];
    for (let n = 0; n < 12; n++) {
      const bytes = actual.subarray(n * 1080 * 1920, (n + 1) * 1080 * 1920);
      assert.equal(
        bytes.some((b) => b > 0),
        n >= 2 && n < 7,
      );
      hashes.push(fontSha(bytes));
    }
    assert.equal(
      new Set(hashes.slice(2, 7)).size,
      1,
      "Literal %{n} is unchanged across enabled frames, not expanded into frame numbers.",
    );
    assert.equal(new Set([hashes[0], hashes[1], ...hashes.slice(7)]).size, 1);
    const expanded = run(
      f.directory,
      prepared.filters.join(",").replace("expansion=none", "expansion=normal"),
    );
    assert.notEqual(fontSha(expanded), fontSha(actual));
  }));
test("ASS controls, quotes, semicolons and path-like text remain bytes, never new filters or external reads", async () =>
  fixture(async (f) => {
    const values = [
      cue("{\\an8}\\N;'"),
      cue("movie=/private", {
        clipId: FONT_FIXTURE_ID,
        startFrame: 7,
        durationFrames: 3,
      }),
    ];
    const prepared = await f.prepare(values);
    assert.deepEqual((await readdir(f.directory)).sort(), [
      "subtitle-0000.txt",
      "subtitle-0001.txt",
      "subtitle-font.ttf",
      "subtitle-fontconfig.xml",
    ]);
    assert.deepEqual(
      await readFile(join(f.directory, "subtitle-0000.txt")),
      Buffer.from(values[0]!.text),
    );
    assert(!prepared.filters.join(",").includes("/private"));
    assert.equal(
      run(f.directory, prepared.filters.join(",")).length,
      1080 * 1920 * 12,
    );
  }));
test("actual font geometry refuses over-wide and over-tall text without auto wrap, resize or clipping", async () => {
  for (const text of ["A".repeat(100), Array(15).fill("字幕").join("\n")])
    await fixture(async (f) => {
      await assert.rejects(f.prepare([cue(text)]), /safe area/u);
    });
});
test("missing scalar glyph and version substitution fail before writing any job member", async () =>
  fixture(async (f) => {
    assert.equal(f.font.glyph(0x10ffff), 0);
    await assert.rejects(f.prepare([cue("字幕\u{10ffff}")]), /glyph/u);
    await assert.rejects(
      prepareRenderSubtitles({
        executable: ffmpegPath!,
        directory: f.directory,
        durationFrames: 12,
        font: f.font,
        fontRef: { ...f.ref, packVersion: "0.0.1" },
        cues: [cue("字幕")],
        signal: new AbortController().signal,
        observer: () => undefined,
      }),
      /exact signed font/u,
    );
    assert.deepEqual(await readdir(f.directory), []);
  }));
test("caller changes after starting do not replace frozen text or font descriptor", async () =>
  fixture(async (f) => {
    const values = [cue("字幕 A")],
      ref = { ...f.ref };
    const pending = prepareRenderSubtitles({
      executable: ffmpegPath!,
      directory: f.directory,
      durationFrames: 12,
      font: f.font,
      fontRef: ref,
      cues: values,
      signal: new AbortController().signal,
      observer: () => undefined,
    });
    values[0]!.text = "Changed";
    ref.sha256 = "0".repeat(64);
    const prepared = await pending;
    assert.equal(prepared.cues[0]!.textSha256, fontSha(Buffer.from("字幕 A")));
    assert.deepEqual(
      await readFile(join(f.directory, "subtitle-0000.txt")),
      Buffer.from("字幕 A"),
    );
    assert.equal(
      prepared.filters[0],
      buildRenderSubtitleFilters([cue("字幕 A")])[0],
    );
  }));
test("actual rasterizer cancellation reaps its original PID and does not return a preparation receipt", async () =>
  fixture(async (f) => {
    const controller = new AbortController();
    let pid: number | undefined,
      clear = false;
    await assert.rejects(
      f.prepare([cue("字幕")], {
        signal: controller.signal,
        observer: (child) => {
          if (child) {
            pid = child.pid;
            controller.abort();
          } else clear = true;
        },
      }),
    );
    assert(pid && clear);
    const actualPid = pid;
    assert.throws(
      () => process.kill(actualPid, 0),
      (cause: unknown) =>
        Boolean(
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "ESRCH",
        ),
    );
  }));
test("exclusive private members refuse overwrite rather than adopting a preexisting text or font", async () =>
  fixture(async (f) => {
    await writeFile(join(f.directory, "subtitle-font.ttf"), "preexisting", {
      flag: "wx",
    });
    await assert.rejects(f.prepare([cue("字幕")]), /EEXIST/u);
    assert.equal(
      await readFile(join(f.directory, "subtitle-font.ttf"), "utf8"),
      "preexisting",
    );
  }));
