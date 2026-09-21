import { existsSync } from "node:fs";
import type {
  FirstPartyPlugin,
  PluginProfile,
} from "@dramaip/plugin-api/internal";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import type { DatabaseMaintenanceService } from "@dramaip/contracts/foundation";
import type { ExtensionPlatform } from "@dramaip/system";
import { validatePluginGraph } from "@dramaip/kernel";
import manifests from "./plugin-manifests.generated.json" with { type: "json" };

export interface FirstPartyPluginRegistryOptions {
  readonly host?: DesktopHostClient;
  readonly maintenance?: DatabaseMaintenanceService;
  readonly extensionPlatform?: ExtensionPlatform;
}

/** Metadata is generated from plugin declarations. Implementations are loaded only by Cordis. */
export function createFirstPartyPluginRegistry(
  _options: FirstPartyPluginRegistryOptions = {},
): ReadonlyMap<string, FirstPartyPlugin> {
  return new Map(
    manifests.map((manifest) => {
      const js = new URL(
        `../../../plugins/${manifest.id}/src/index.js`,
        import.meta.url,
      );
      const entry = existsSync(js)
        ? js.href
        : new URL(
            `../../../plugins/${manifest.id}/src/index.ts`,
            import.meta.url,
          ).href;
      return [
        manifest.id,
        { ...manifest, entry } as unknown as FirstPartyPlugin,
      ];
    }),
  );
}

export function collectPluginMigrations(
  plugins: ReadonlyMap<string, FirstPartyPlugin>,
  profile: PluginProfile,
): readonly NonNullable<FirstPartyPlugin["migrations"]>[number][] {
  const migrations: NonNullable<FirstPartyPlugin["migrations"]>[number][] = [];
  for (const id of validatePluginGraph(plugins, profile)) {
    const plugin = plugins.get(id)!;
    for (const migration of plugin.migrations ?? []) {
      if (migration.pluginId !== id)
        throw new Error(
          `migration owner mismatch: ${migration.id} declares ${migration.pluginId}, expected ${id}`,
        );
      migrations.push(migration);
    }
  }
  return migrations;
}
