import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import {
  applyEntryPatches,
  entryListSchema,
  type PatchOptions,
} from "@deepseek-ai/cordis-plugin-include";
import type { EntryOptions } from "@deepseek-ai/cordis-plugin-loader";
import type { JsonValue } from "@dramaip/contracts";

export interface BundleDefinition {
  readonly id:
    | "core"
    | "automation-suite"
    | "writing-suite"
    | "agents-suite"
    | "production-suite"
    | "analytics-suite";
  readonly patch: URL;
  readonly plugins: readonly string[];
  readonly requires?: readonly BundleDefinition["id"][];
  readonly defaults?: Readonly<Record<string, JsonValue>>;
}

const bundle = (
  id: BundleDefinition["id"],
  requires: BundleDefinition["id"][] = [],
): BundleDefinition => {
  const patch = new URL(
    `../../../bundles/${id}/cordis.patch.yml`,
    import.meta.url,
  );
  return {
    id,
    requires,
    patch,
    get plugins() {
      return flattenEntries(
        applyEntryPatches([], readPatches(patch), warn),
      ).map((entry) => entry.id);
    },
  };
};
export const builtInBundles: readonly BundleDefinition[] = Object.freeze([
  bundle("core"),
  bundle("automation-suite", ["core"]),
  bundle("writing-suite", ["core"]),
  bundle("agents-suite", ["core"]),
  bundle("production-suite", ["core", "writing-suite"]),
  bundle("analytics-suite", ["core"]),
]);
function warn(message: string, ...args: unknown[]) {
  console.warn(message, ...args);
}
export function readPatches(path: URL): PatchOptions[] {
  const result: unknown = load(readFileSync(path, "utf8"), {
    schema: entryListSchema,
  });
  if (
    !Array.isArray(result) ||
    result.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new BundleProfileError(`invalid patch list: ${fileURLToPath(path)}`);
  return result;
}
export function flattenEntries(
  entries: readonly EntryOptions[],
): EntryOptions[] {
  const result: EntryOptions[] = [];
  for (const entry of entries) {
    if (entry.disabled) continue;
    if (entry.group) {
      if (entry.name !== "cordis:group" || !Array.isArray(entry.config))
        throw new BundleProfileError(`invalid first-party group: ${entry.id}`);
      result.push(...flattenEntries(entry.config));
    } else result.push(entry);
  }
  return result;
}
export interface CordisAssembly {
  readonly root: string;
  readonly patches: PatchOptions[];
  readonly files: readonly string[];
  readonly entries: EntryOptions[];
}

export type ProfileName = "studio" | "server" | "safe" | "test" | "e2e";

export interface ProfileDefinition {
  readonly name: ProfileName;
  readonly bundles: readonly BundleDefinition["id"][];
  readonly config?: JsonValue;
}

export interface EffectiveRuntimeGraph {
  readonly profile: ProfileName;
  readonly bundles: readonly BundleDefinition["id"][];
  readonly plugins: readonly { id: string; config?: JsonValue }[];
  readonly assembly: CordisAssembly;
}

export class BundleProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleProfileError";
  }
}

export function resolveEffectiveGraph(
  profile: ProfileDefinition,
  registry: readonly BundleDefinition[] = builtInBundles,
): EffectiveRuntimeGraph {
  const byId = new Map(registry.map((bundle) => [bundle.id, bundle]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const bundles: BundleDefinition["id"][] = [];
  const visit = (
    id: BundleDefinition["id"],
    trail: readonly string[],
  ): void => {
    if (visited.has(id)) return;
    if (visiting.has(id))
      throw new BundleProfileError(
        `bundle dependency cycle: ${[...trail, id].join(" -> ")}`,
      );
    const bundle = byId.get(id);
    if (!bundle) throw new BundleProfileError(`unknown bundle: ${id}`);
    visiting.add(id);
    for (const dependency of bundle.requires ?? [])
      visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
    bundles.push(id);
  };
  for (const id of profile.bundles) visit(id, []);
  const root = new URL("../../../cordis.yml", import.meta.url);
  const rootEntries: unknown = load(readFileSync(root, "utf8"), {
    schema: entryListSchema,
  });
  if (!Array.isArray(rootEntries) || rootEntries.length)
    throw new BundleProfileError("Cordis root must be an empty entry list");
  const profilePatch = new URL(
    `../../../profiles/${profile.name}/cordis.patch.yml`,
    import.meta.url,
  );
  const files = [
    root,
    ...bundles.map((id) => byId.get(id)!.patch),
    profilePatch,
  ];
  const patches = files.slice(1).flatMap(readPatches);
  // Native Include mutates inserted entries. Parse a separate preflight tree so
  // Loader receives the original patch layers, including YAML expression values.
  const entries = applyEntryPatches(
    [],
    files.slice(1).flatMap(readPatches),
    warn,
  );
  const plugins = flattenEntries(entries).map((entry) => {
    if (!entry.id || entry.name !== `@dramaip/${entry.id}`)
      throw new BundleProfileError(
        `invalid first-party module entry: ${entry.id}`,
      );
    return { id: entry.id, config: entry.config as JsonValue };
  });
  if (new Set(plugins.map((entry) => entry.id)).size !== plugins.length)
    throw new BundleProfileError("duplicate plugin in effective patch tree");
  return {
    profile: profile.name,
    bundles,
    plugins,
    assembly: {
      root: root.href,
      patches,
      entries,
      files: files.map((file) => fileURLToPath(file)),
    },
  };
}

export function parseProfileDefinition(text: string): ProfileDefinition {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BundleProfileError("profile must be an object");
  const record = value as {
    name?: unknown;
    bundles?: unknown;
    plugins?: unknown;
    config?: unknown;
  };
  if (record.plugins !== undefined)
    throw new BundleProfileError("profile must reference bundles, not plugins");
  if (
    !(["studio", "server", "safe", "test", "e2e"] as const).includes(
      record.name as ProfileName,
    )
  )
    throw new BundleProfileError("profile name is invalid");
  if (
    !Array.isArray(record.bundles) ||
    record.bundles.some((id) => typeof id !== "string")
  )
    throw new BundleProfileError("profile bundles are invalid");
  return {
    name: record.name as ProfileName,
    bundles: record.bundles as BundleDefinition["id"][],
    ...(record.config === undefined
      ? {}
      : { config: record.config as JsonValue }),
  };
}
