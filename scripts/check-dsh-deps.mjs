// Option B dependency gate: DramaIP depends on DSH only through the nine
// Cordis framework packages. Every other `@deepseek-ai/*` package (the
// `dsh-*` components, DSH bundles, the `dsh` CLI and `apps/*`) is rejected,
// both as a manifest dependency and as an import specifier in source.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const allowedDshPackages = new Set([
  "@deepseek-ai/cordis",
  "@deepseek-ai/cosmokit",
  "@deepseek-ai/schemastery",
  "@deepseek-ai/cordis-plugin-loader",
  "@deepseek-ai/cordis-plugin-include",
  "@deepseek-ai/cordis-plugin-group",
  "@deepseek-ai/cordis-plugin-timer",
  "@deepseek-ai/cordis-plugin-hmr",
  "@deepseek-ai/cordis-plugin-logger-console",
]);

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const skippedDirectories = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  ".turbo",
  "test-results",
  "artifacts",
]);
const sourcePattern = /\.(?:[cm]?[jt]sx?)$/u;
const specifierPattern =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)/gu;

/** Superseded stacks: use the shared contracts, UI and client infrastructure. */
export const retiredDependencies = new Map([
  ["effect", "Zod contracts"],
  ["lucide-react", "shared UI primitives and icons"],
  ["@tanstack/react-virtual", "unused platform seed"],
  ["@tanstack/react-query", "client stores and Remote client models"],
  ["react-query", "client stores and Remote client models"],
  ["react-router-dom", "the application router"],
  ["zustand", "the shared client store"],
  ["drizzle-orm", "the relational storage backend"],
]);

function manifestViolations(manifest, path) {
  const violations = [];
  for (const field of dependencyFields) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      if (
        dependency.startsWith("@deepseek-ai/") &&
        !allowedDshPackages.has(dependency)
      )
        violations.push(`${path}: ${field} ${dependency}`);
      const replacement = retiredDependencies.get(dependency);
      if (replacement)
        violations.push(
          `${path}: ${field} ${dependency} is retired (${replacement})`,
        );
      if (field === "devDependencies") continue;
      if (
        manifest.name === "@dramaip/desktop-host-process" &&
        dependency === "tsx"
      )
        violations.push(
          `${path}: tsx belongs in devDependencies; the installed Host runs compiled JavaScript`,
        );
      if (
        manifest.dramaip?.client?.platform === "web" &&
        /^(?:react|react-dom|clsx|@tiptap\/[^/]+|tiptap-markdown)$/u.test(
          dependency,
        )
      )
        violations.push(
          `${path}: ${dependency} is bundled for the browser and belongs in devDependencies`,
        );
    }
  }
  return violations;
}

function packageOf(specifier) {
  const [scope, name] = specifier.split("/");
  return scope.startsWith("@") ? `${scope}/${name}` : scope;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const nested = await Promise.all(
    entries
      .filter((entry) => !skippedDirectories.has(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
  );
  return nested.flat();
}

/** Reject forbidden DSH packages, superseded stacks and browser/development dependencies in the Host closure. */
export async function findDshDependencyViolations(base, roots) {
  const violations = [];
  for (const root of roots) {
    for (const path of await walk(join(base, root))) {
      const name = relative(base, path);
      if (path.endsWith("package.json")) {
        const manifest = JSON.parse(await readFile(path, "utf8"));
        violations.push(...manifestViolations(manifest, name));
      } else if (sourcePattern.test(path)) {
        const source = await readFile(path, "utf8");
        for (const match of source.matchAll(specifierPattern)) {
          const dependency = packageOf(match[1]);
          if (
            dependency.startsWith("@deepseek-ai/") &&
            !allowedDshPackages.has(dependency)
          )
            violations.push(`${name}: imports ${dependency}`);
          const replacement = retiredDependencies.get(dependency);
          if (replacement)
            violations.push(
              `${name}: imports retired ${dependency} (${replacement})`,
            );
        }
      }
    }
  }
  return violations;
}

export const checkedRoots = ["package.json", "apps", "packages"];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const violations = [];
  for (const root of checkedRoots) {
    if (root.endsWith(".json")) {
      const manifest = JSON.parse(await readFile(join(base, root), "utf8"));
      violations.push(...manifestViolations(manifest, root));
    } else
      violations.push(...(await findDshDependencyViolations(base, [root])));
  }
  if (violations.length > 0) {
    process.stderr.write(
      `Desktop dependency policy violations:\n${violations
        .map((violation) => `  ${violation}`)
        .join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `DSH dependencies limited to the ${allowedDshPackages.size} Cordis framework packages; retired stacks and Host dependency boundaries verified\n`,
  );
}
