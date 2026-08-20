import type { JsonValue } from "@dramaip/contracts";

export interface BundleDefinition {
  readonly id:
    | "core"
    | "automation-suite"
    | "writing-suite"
    | "agents-suite"
    | "production-suite"
    | "analytics-suite";
  readonly plugins: readonly string[];
  readonly requires?: readonly BundleDefinition["id"][];
  readonly defaults?: Readonly<Record<string, JsonValue>>;
}

export const builtInBundles: readonly BundleDefinition[] = Object.freeze([
  { id: "core", plugins: ["foundation", "system", "workspace"] },
  { id: "automation-suite", plugins: ["automation"], requires: ["core"] },
  {
    id: "writing-suite",
    plugins: ["writing", "knowledge", "creative-quality"],
    requires: ["core"],
  },
  { id: "agents-suite", plugins: ["agents"], requires: ["core"] },
  {
    id: "production-suite",
    plugins: ["production", "media", "timeline", "review", "delivery"],
    requires: ["core", "writing-suite"],
  },
  { id: "analytics-suite", plugins: ["insights"], requires: ["core"] },
]);

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
  const plugins: { id: string; config?: JsonValue }[] = [];
  const pluginIds = new Set<string>();
  for (const id of bundles) {
    const bundle = byId.get(id)!;
    for (const plugin of bundle.plugins) {
      if (pluginIds.has(plugin))
        throw new BundleProfileError(
          `plugin appears in more than one effective bundle: ${plugin}`,
        );
      pluginIds.add(plugin);
      plugins.push({ id: plugin, config: bundle.defaults?.[plugin] });
    }
  }
  return { profile: profile.name, bundles, plugins };
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
