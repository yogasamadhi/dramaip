import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-25/p2-gate-contract.json"),
    "utf8",
  ),
) as {
  version: number;
  entry: string;
  requiredTimelineTracks: string[];
  requiredDeliveryFormats: string[];
  machineEvidence: string[];
  truthfulLimits: string[];
};

test("LM6-25 将 P2 Gate 的本地、交付、系列与可选云审片证据收束为可复跑矩阵", () => {
  const electron = readFileSync(
    join(root, "tests/electron/lm6-full-journey.spec.ts"),
    "utf8",
  );
  const nodeContract = readFileSync(
    join(root, "packages/server/src/sidecar.node.test.ts"),
    "utf8",
  );
  const userGuide = readFileSync(
    join(root, "docs/product/USER_GUIDE.md"),
    "utf8",
  );
  const desktopReadme = readFileSync(join(root, "README.md"), "utf8");
  const release = readFileSync(
    join(root, "docs/release/RELEASE_CANDIDATE.md"),
    "utf8",
  );

  expect(fixture.version).toBe(1);
  expect(fixture.entry).toBe("script-draft");
  fixture.requiredTimelineTracks.forEach((track) =>
    expect(electron).toContain(`"${track}"`),
  );
  fixture.requiredDeliveryFormats.forEach((format) =>
    expect(electron).toContain(
      format === "重链接清单" ? "导出重链接清单" : `导出 ${format}`,
    ),
  );
  fixture.machineEvidence.forEach((evidence) =>
    expect(desktopReadme).toContain(evidence),
  );
  fixture.truthfulLimits.forEach((limit) => {
    expect(desktopReadme).toContain(limit);
    expect(release).toContain(limit);
  });
  expect(userGuide).toContain("伪造的 MP4");
  expect(userGuide).toContain("不会上传完整 SQLite 数据库");
  expect(nodeContract).toContain("remote-comment-1");
  expect(nodeContract).toContain("remote-decision-1");
  expect(nodeContract).toContain("cloudRevisionPreview");
  expect(nodeContract).toContain("localFeedbackPreserved");
  expect(nodeContract).toContain("changedFork");
  expect(nodeContract).toContain("seriesPackagePreview");
});

test("LM6-25 使用固定 FCPXML、OTIO 与 EDL reference parser，而非文件存在性作为交付证据", () => {
  const result = spawnSync("node", ["scripts/check-timeline-exports.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toMatch(/timeline/i);
});
