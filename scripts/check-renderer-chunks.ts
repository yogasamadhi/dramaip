import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const manifestPath = resolve(
    root,
    "apps/desktop/out/renderer/.vite/manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    {
      dynamicImports?: readonly string[];
      imports?: readonly string[];
      isDynamicEntry?: boolean;
      file: string;
    }
  >;
  const domains = [
    "workspace",
    "writing",
    "creative",
    "production",
    "media",
    "review-delivery",
    "insights",
    "automation",
    "settings",
    "agents",
  ];
  const applicationEntry = manifest["index.html"];
  if (!applicationEntry)
    throw new Error("Renderer application entry is missing");
  for (const domain of domains) {
    const source = `src/features/${domain}/index.ts`;
    const entry = manifest[source];
    if (!entry?.isDynamicEntry)
      throw new Error(`Renderer domain is not a dynamic chunk: ${domain}`);
    if (!applicationEntry.dynamicImports?.includes(source))
      throw new Error(
        `Renderer shell does not lazily import domain: ${domain}`,
      );
    const entrySource = await readFile(
      resolve(root, "packages/app", source),
      "utf8",
    );
    if (entrySource.includes("studio-runtime"))
      throw new Error(
        `Renderer domain uses the aggregate runtime barrel: ${domain}`,
      );
  }
  if (
    Object.values(manifest).some(({ file }) => file.includes("studio-runtime"))
  )
    throw new Error("Renderer rebuilt an aggregate studio-runtime chunk");
  const shellSources = ["src/studio-app.tsx", "src/studio-shell.tsx"];
  for (const source of shellSources) {
    const contents = await readFile(
      resolve(root, "packages/app", source),
      "utf8",
    );
    if (contents.includes('from "./studio-runtime"'))
      throw new Error(
        `Renderer shell statically imports the domain runtime: ${source}`,
      );
  }
  process.stdout.write("Renderer feature chunks passed\n");
}

void main();
