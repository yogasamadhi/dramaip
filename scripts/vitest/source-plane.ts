/**
 * Resolve each package's `./client` export to its source entry in tests. The
 * export's `default` names the built browser bundle `lib/client.js`, which
 * only the module system loads; tests and static checks stay on the source
 * plane, as DSH's tsconfig `paths` keep them.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface ConditionalExport {
  readonly types?: string;
  readonly default?: string;
}

function clientSources(desktop: string): Map<string, string> {
  const sources = new Map<string, string>();
  // Every `packages/<group>/<package>`, the domain groups included.
  const packages = join(desktop, "packages");
  const dirs = readdirSync(packages, { withFileTypes: true })
    .filter(
      (group) =>
        group.isDirectory() &&
        !existsSync(join(packages, group.name, "package.json")),
    )
    .flatMap((group) =>
      readdirSync(join(packages, group.name)).map((name) =>
        join(packages, group.name, name),
      ),
    );
  for (const dir of dirs) {
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name: string;
      exports?: Record<string, string | ConditionalExport>;
    };
    const client = manifest.exports?.["./client"];
    if (typeof client !== "object" || client.default !== "./lib/client.js")
      continue;
    if (client.types === undefined || !client.types.startsWith("./src/")) {
      throw new Error(
        `${manifest.name}: ./client must name its source entry under types`,
      );
    }
    sources.set(`${manifest.name}/client`, join(dir, client.types));
  }
  return sources;
}

/**
 * @param desktop - the Desktop workspace root.
 * @returns a pre-resolve Vite plugin for the infra test configuration.
 */
export function sourcePlanePlugin(desktop: string) {
  const sources = clientSources(desktop);
  return {
    name: "dramaip-source-plane",
    enforce: "pre" as const,
    resolveId(source: string) {
      return sources.get(source) ?? null;
    },
  };
}
