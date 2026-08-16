import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(join(root, "docs/ui-parity/reference-manifest.json"), "utf8"),
) as {
  source: string;
  viewport: { width: number; height: number };
  maxDiffPixelRatio: number;
  files: Record<string, string>;
};

if (
  manifest.viewport.width !== 1440 ||
  manifest.viewport.height !== 920 ||
  manifest.maxDiffPixelRatio !== 0.015
)
  throw new Error(
    "UI parity viewport or pixel threshold changed without review",
  );

const referenceRoot = join(root, manifest.source);
for (const [name, expected] of Object.entries(manifest.files)) {
  const source = await readFile(join(referenceRoot, name));
  const actual = createHash("sha256").update(source).digest("hex");
  if (actual !== expected)
    throw new Error(`Desktop visual baseline changed without review: ${name}`);
}

const [css, shell, pluginApi, theme, agents, packageJson, vite] =
  await Promise.all([
    readFile(join(root, "apps/studio/src/renderer/src/styles.css"), "utf8"),
    readFile(
      join(root, "apps/studio/src/renderer/src/studio-application.tsx"),
      "utf8",
    ),
    readFile(join(root, "packages/plugin-api/src/index.ts"), "utf8"),
    readFile(join(root, "packages/ui/src/theme.tsx"), "utf8"),
    readFile(join(root, "plugins/agents/src/ui.tsx"), "utf8"),
    readFile(join(root, "packages/ui/package.json"), "utf8"),
    readFile(join(root, "apps/studio/electron.vite.config.ts"), "utf8"),
  ]);

for (const token of [
  "--ui-canvas: #f8f7f4",
  "--ui-surface: #fffdfa",
  "--ui-brand: #ba5a3a",
  "--ui-canvas: #191a19",
  "--font-editor",
  "prefers-reduced-motion",
])
  if (!css.includes(token))
    throw new Error(`required design token missing: ${token}`);

for (const contract of [
  '"shell.assistant"',
  "activePaths?: readonly string[]",
  'section: "main" | "project" | "settings"',
])
  if (!pluginApi.includes(contract))
    throw new Error(`UI contribution contract drift: ${contract}`);

for (const source of [css, shell, agents]) {
  for (const forbidden of ["shell.overlay", "assistant-launcher", "NEXT"])
    if (source.includes(forbidden))
      throw new Error(`legacy Desktop2 chrome remains: ${forbidden}`);
}

for (const required of [
  "DramaIP Studio",
  "更多",
  "智能助手",
  "project-navigation",
  "ThemeProvider",
  "Drawer.Content",
])
  if (!shell.includes(required))
    throw new Error(`Desktop shell parity feature missing: ${required}`);

if (!theme.includes('"dramaip-theme-v1"'))
  throw new Error("theme persistence contract changed");
if (!packageJson.includes('"name": "@dramaip/ui"'))
  throw new Error("Desktop2 independent UI package is missing");
if (!vite.includes("tailwindcss()") || !vite.includes('"@dramaip/ui"'))
  throw new Error("Tailwind or @dramaip/ui is not connected to renderer build");

const corePluginSources = await Promise.all(
  ["workspace", "writing", "knowledge", "agents", "system"].map((plugin) =>
    readFile(join(root, `plugins/${plugin}/package.json`), "utf8"),
  ),
);
if (corePluginSources.some((source) => !source.includes('"@dramaip/ui"')))
  throw new Error("every core UI plugin must depend on @dramaip/ui");
if ([shell, ...corePluginSources].some((source) => source.includes("@sdns/ui")))
  throw new Error("Desktop2 must not depend on Desktop @sdns/ui");

const corePluginUi = await Promise.all(
  ["workspace", "writing", "knowledge", "agents", "system"].map((plugin) =>
    readFile(join(root, `plugins/${plugin}/src/ui.tsx`), "utf8"),
  ),
);
if (corePluginUi.some((source) => />[^<]*(?:NEXT|Next)[^<]*</u.test(source)))
  throw new Error("Desktop2 identity must not be rendered in product UI");

process.stdout.write(
  `UI parity contracts valid; ${Object.keys(manifest.files).length} Desktop references are locked at ${manifest.maxDiffPixelRatio * 100}%\n`,
);
