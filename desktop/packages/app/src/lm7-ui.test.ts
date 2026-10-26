import { describe, expect, test } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const scanTsxSources = (): string[] =>
  globSync("**/*.tsx", {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
  })
    .filter((file) => !file.includes("node_modules"))
    .sort();

const featureSources = [
  "./studio-shared.tsx",
  "./features/studio-widgets.tsx",
  "./features/workspace/impl.tsx",
  "./features/writing/impl.tsx",
  "./features/creative/impl.tsx",
  "./features/automation/impl.tsx",
  "./features/production/impl.tsx",
  "./features/media/impl.tsx",
  "./features/review-delivery/impl.tsx",
  "./features/insights/impl.tsx",
  "./features/settings/impl.tsx",
  "./features/agents/impl.tsx",
].map(read);

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
      ...featureSources,
      read("./app-shell.tsx"),
      read("./features/novel/NovelChapterWorkspace.tsx"),
      read("./features/novel/NovelProjectSections.tsx"),
    ].join("\n");
    expect(source).not.toContain("<button");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toMatch(/className=.*#[0-9a-f]{3,8}/i);
    expect(read("./styles.css")).not.toContain('class*="');
  });

  test("renderer UI uses semantic color tokens and a 12px minimum text size", () => {
    const offenders: string[] = [];
    for (const file of scanTsxSources()) {
      const source = read(`./${file}`);
      if (
        /(?<![\w-])(?:bg|text|border|ring|from|to)-(?:amber|red|orange|yellow|emerald|green|rose)-\d+/.test(
          source,
        ) ||
        /text-\[(?:[0-9]|1[01])px\]/.test(source)
      )
        offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("renderer selects use the shared NativeSelect primitive", () => {
    const offenders: string[] = [];
    for (const file of scanTsxSources())
      if (/<select[\s>]/.test(read(`./${file}`))) offenders.push(file);
    expect(offenders).toEqual([]);
  });

  test("navigation and design-token limits remain stable", () => {
    const shell = read("./app-shell.tsx");
    const studio = read("./studio-shell.tsx");
    const workspace = read("../../../plugins/workspace/src/index.ts");
    const writing = read("../../../plugins/writing/src/index.ts");
    expect(shell).toContain("props.navigation");
    expect(studio).toContain("contributionsOfKind(");
    expect(studio).toContain('"navigation",');
    expect(workspace).toContain(
      'metadata: { section: "main", order: 10, label: "项目", to: "/" }',
    );
    expect(writing).toContain(
      'metadata: { section: "main", order: 20, label: "故事", to: "/write" }',
    );

    const sources = [
      ...featureSources,
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
