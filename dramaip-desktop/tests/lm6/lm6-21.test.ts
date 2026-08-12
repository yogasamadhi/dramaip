import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-21/audio-assembly-contract.json"),
    "utf8",
  ),
) as {
  tracks: string[];
  audioDefaults: { bgmVolume: number; duckingGain: number };
  requiredStates: string[];
  protectedEdits: string[];
  subtitleFormats: string[];
  requiredElectronSpec: string;
};

test("LM6-21 将可审查的自动音频、字幕与人工编辑保护固定为同一契约", () => {
  const schema = readFileSync(
    join(root, "packages/schema/src/index.ts"),
    "utf8",
  );
  const protocol = readFileSync(
    join(root, "packages/protocol/src/index.ts"),
    "utf8",
  );
  const server = readFileSync(
    join(root, "packages/server/src/sidecar.ts"),
    "utf8",
  );
  const serverContract = readFileSync(
    join(root, "packages/server/src/sidecar.node.test.ts"),
    "utf8",
  );
  const app = readFileSync(join(root, "packages/app/src/main.tsx"), "utf8");
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");
  const electron = readFileSync(
    join(root, "tests/electron", fixture.requiredElectronSpec),
    "utf8",
  );

  fixture.tracks.forEach((track) => expect(schema).toContain(`"${track}"`));
  fixture.requiredStates.forEach((state) =>
    expect(schema).toContain(`"${state}"`),
  );
  fixture.protectedEdits.forEach((command) =>
    expect(schema).toContain(`"${command}"`),
  );
  expect(schema).toContain("AudioAssemblyPreview");
  expect(schema).toContain("SubtitleCue");
  expect(protocol).toContain("audio-assembly/preview");
  expect(protocol).toContain("audio-assembly/apply");
  expect(server).toContain("buildAudioAssemblyPreview");
  expect(server).toContain("applyAudioAssembly");
  expect(server).toContain("audioClipSourceFingerprint");
  expect(server).toContain("audioAssemblySubtitleExports");
  expect(server).toContain(String(fixture.audioDefaults.bgmVolume));
  expect(server).toContain(String(fixture.audioDefaults.duckingGain));
  fixture.subtitleFormats.forEach((format) => expect(guide).toContain(format));
  expect(app).toContain("审查自动编排");
  expect(app).toContain("锁定，保护自动编排");
  expect(serverContract).toContain("partialStalePreview");
  expect(electron).toContain("自动音频字幕编排");
  expect(electron).toContain("采用选中的自动编排");
});
