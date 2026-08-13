import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("LM7 desktop UI architecture", () => {
  test("theme initializes before React render and the entry stays startup-only", () => {
    const source = read("./main.tsx");
    expect(source.indexOf("initializeTheme();")).toBeGreaterThan(-1);
    expect(source.indexOf("initializeTheme();")).toBeLessThan(
      source.indexOf(".render("),
    );
    expect(source.split("\n").length).toBeLessThan(500);
  });

  test("business UI has no raw buttons, class-fragment overrides or arbitrary colors", () => {
    const source = [
      read("./studio-app.tsx"),
      read("./app-shell.tsx"),
      read("./features/novel/NovelChapterWorkspace.tsx"),
      read("./features/novel/NovelProjectSections.tsx"),
    ].join("\n");
    expect(source).not.toContain("<button");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toMatch(/className=.*#[0-9a-f]{3,8}/i);
    expect(read("./styles.css")).not.toContain('class*="');
  });

  test("navigation and design-token limits remain stable", () => {
    const shell = read("./app-shell.tsx");
    expect(shell).toContain('["/", "项目"]');
    expect(shell).toContain('["/write", "小说写作"]');
    expect(shell.indexOf('["/", "项目"]')).toBeLessThan(
      shell.indexOf('["/write", "小说写作"]'),
    );

    const sources = [
      read("./studio-app.tsx"),
      read("./app-shell.tsx"),
      read("./ui-showcase.tsx"),
      read("./features/novel/NovelChapterWorkspace.tsx"),
      read("./features/novel/NovelProjectSections.tsx"),
      read("../../ui/src/primitives.tsx"),
      read("../../ui/src/overlays.tsx"),
    ].join("\n");
    const radii = new Set(
      [...sources.matchAll(/\brounded-(md|lg|xl|full)\b/g)].map(
        (match) => match[1],
      ),
    );
    const shadows = new Set(
      [...sources.matchAll(/\bshadow-(control|card|float)\b/g)].map(
        (match) => match[1],
      ),
    );
    expect(radii.size).toBeLessThanOrEqual(4);
    expect(shadows.size).toBeLessThanOrEqual(3);
  });
});
