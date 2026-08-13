import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  defaultProductionBrief,
  productionBriefText,
} from "../../packages/app/src/project-intake";

const desktopRoot = join(import.meta.dir, "../..");
const fixture = JSON.parse(
  readFileSync(
    join(desktopRoot, "tests/fixtures/lm6/lm6-01/intake-matrix.json"),
    "utf8",
  ),
) as {
  version: number;
  paths: Array<{
    id: "inspiration" | "source-import" | "script";
    label: string;
    contentForm: string;
    firstOutcome: string;
  }>;
  briefDefaults: Record<string, string>;
};

test("LM6-01 固化三条首页创建路径与它们的首个用户结果", () => {
  expect(fixture.version).toBe(1);
  expect(fixture.paths.map((path) => path.id)).toEqual([
    "inspiration",
    "source-import",
    "script",
  ]);
  for (const path of fixture.paths) {
    const brief = defaultProductionBrief(path.id);
    expect(productionBriefText(brief)).toContain(
      `内容形态：${path.contentForm}`,
    );
  }
  expect(fixture.briefDefaults).toMatchObject({
    targetPlatform: "短视频平台",
    episodeDuration: "60—90 秒",
    aspectRatio: "9:16 竖屏",
  });
});

test("LM6-01 首页将文件路径接到既有的权益确认预览，而非绕过 capability 边界", () => {
  const appSource = readFileSync(
    join(desktopRoot, "packages/app/src/studio-app.tsx"),
    "utf8",
  );
  for (const path of fixture.paths) {
    expect(appSource).toContain(`title: "${path.label}"`);
    expect(appSource).toContain(path.firstOutcome);
  }
  expect(appSource).toContain("?intake=source");
  expect(appSource).toContain("initialOpen");
  expect(appSource).toContain("rightsConfirmed");
  expect(appSource).toContain("capabilityToken: file.token");
});
