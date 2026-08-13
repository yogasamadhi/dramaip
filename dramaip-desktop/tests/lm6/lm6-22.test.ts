import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(root, "tests/fixtures/lm6/lm6-22/timeline-delivery-fixture.json"),
    "utf8",
  ),
) as { frameRate: number; expected: { clip: { mediaPath: string } } };

test("LM6-22 将 canonical timeline 的确定性交付与参考解析门禁固定为契约", () => {
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
  const app = readFileSync(
    join(root, "packages/app/src/studio-app.tsx"),
    "utf8",
  );
  const serverContract = readFileSync(
    join(root, "packages/server/src/sidecar.node.test.ts"),
    "utf8",
  );
  const guide = readFileSync(join(root, "docs/product/USER_GUIDE.md"), "utf8");
  const electron = readFileSync(
    join(root, "tests/electron/lm6-22.spec.ts"),
    "utf8",
  );

  expect(schema).toContain("TimelineDeliveryManifest");
  for (const format of ["fcpxml", "otio", "edl", "srt", "vtt", "relink"])
    expect(schema).toContain(`"${format}"`);
  expect(protocol).toContain("timeline-delivery/manifest");
  expect(protocol).toContain("timeline-delivery/export/:format");
  expect(server).toContain("buildTimelineDelivery");
  expect(server).toContain("timelineDeliveryFcpxml");
  expect(server).toContain("timelineDeliveryOtio");
  expect(server).toContain("timelineDeliveryEdl");
  expect(server).toContain("timelineDeliverySubtitleDocument");
  expect(server).toContain("timelineDeliveryRelativePath");
  expect(server).toContain('createHash("sha256")');
  expect(serverContract).toContain("exportedTimelineDocuments");
  expect(app).toContain("已验证 NLE 交付");
  expect(app).toContain("timeline_render");
  expect(guide).toContain("OTIO");
  expect(electron).toContain("已验证 NLE 交付");
  expect(fixture.frameRate).toBe(25);
  expect(fixture.expected.clip.mediaPath).toStartWith("media/");
});
